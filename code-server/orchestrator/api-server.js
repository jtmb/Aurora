/**
 * orchestrator/api-server.js — Orchestrator HTTP API Server
 *
 * Express server that exposes the orchestrator as a REST API.
 * The Aurora frontend calls this to start jobs, stream output, and stop jobs.
 *
 * Routes:
 *   POST   /api/jobs              Start a new job
 *   GET    /api/jobs              List all jobs
 *   GET    /api/jobs/:id          Get job status
 *   GET    /api/jobs/:id/tail     SSE stream of job output
 *   POST   /api/jobs/:id/stop    Stop a running job
 *   GET    /api/health            Health check
 */

import express from "express";
import {
  startJob,
  stopJob,
  getJob,
  listJobs,
  getEventBus,
  cleanupStaleJobs,
  scheduleDisconnectStop,
  cancelDisconnectStop,
} from "./job-manager.js";
import fs from "fs";
import path from "path";
import os from "os";

const PORT = parseInt(process.env.CODE_SERVER_API_PORT || "3001", 10);
const CORS_ORIGIN = process.env.ORCHESTRATOR_CORS_ORIGIN || "*";

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: "1mb" }));

// CORS — allow frontend to call API directly
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    if (req.url !== "/api/health") {
      console.log(`[api] ${req.method} ${req.url} → ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  const jobs = listJobs();
  const active = jobs.filter((j) => j.status === "running").length;
  res.json({
    status: "ok",
    uptime: process.uptime(),
    activeJobs: active,
    totalJobs: jobs.length,
  });
});

// Update Cline auth for the current user (called by proxy on user switch)
app.post("/api/auth/update", (req, res) => {
  try {
    const { userId, apiKey } = req.body;
    if (!userId || !apiKey) {
      return res.status(400).json({ error: "userId and apiKey are required" });
    }

    const homeDir = os.homedir();
    const clineDataDir = path.join(homeDir, '.cline', 'data');
    const secretsFile = path.join(clineDataDir, 'secrets.json');

    // Read existing secrets
    let secrets = {};
    if (fs.existsSync(secretsFile)) {
      try { secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf-8')); } catch {}
    }

    // Update auth keys for the current user
    secrets.deepSeekApiKey = apiKey;
    secrets.lmStudioApiKey = apiKey;
    secrets.openAiApiKey = apiKey;
    secrets.apiKey = apiKey;

    fs.mkdirSync(clineDataDir, { recursive: true });
    fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));

    console.log(`[api] Updated Cline auth for user: ${userId}`);
    res.json({ status: 'ok', userId });
  } catch (err) {
    console.error(`[api] POST /api/auth/update error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start a new job
app.post("/api/jobs", (req, res) => {
  try {
    const { task, workspaceId, model, provider } = req.body;

    if (!task || typeof task !== "string" || task.trim().length === 0) {
      return res.status(400).json({ error: "task is required (non-empty string)" });
    }
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId is required" });
    }

    const result = startJob(task.trim(), workspaceId, model, provider);
    console.log(`[api] Job started: ${result.jobId} (workspace: ${workspaceId}, model: ${model || 'default'}, provider: ${provider || 'default'})`);
    res.status(201).json(result);
  } catch (err) {
    console.error(`[api] POST /api/jobs error:`, err.message);
    if (err.message.includes("already has an active job")) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// List all jobs
app.get("/api/jobs", (req, res) => {
  res.json({ jobs: listJobs() });
});

// Get a single job
app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "job not found" });
  }
  res.json(job);
});

// SSE tail — stream job output in real-time
app.get("/api/jobs/:id/tail", (req, res) => {
  const jobId = req.params.id;

  // Check job exists
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx buffering
    "Access-Control-Allow-Origin": CORS_ORIGIN,
  });

  // Send initial state
  res.write(
    `event: status\ndata: ${JSON.stringify({ jobId, status: job.status, startedAt: job.startedAt })}\n\n`
  );

  // Replay recent output lines so late subscribers get context
  if (job.lastOutput) {
    for (const line of job.lastOutput.slice(-50)) {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  }

  // If job is already done, send done event and close
  if (job.status !== "running") {
    res.write(
      `event: done\ndata: ${JSON.stringify({ jobId, status: job.status, exitCode: job.exitCode })}\n\n`
    );
    res.end();
    return;
  }

  // Subscribe to live events
  const bus = getEventBus();
  const onOutput = (entry) => {
    if (entry.jobId !== jobId) return;

    if (entry.type === "done") {
      const data = JSON.stringify({
        jobId,
        status: entry.stopped ? "stopped" : entry.exitCode === 0 ? "complete" : "error",
        exitCode: entry.exitCode,
        state: entry.state
          ? { iterations: entry.state.iterations }
          : null,
      });
      try {
        res.write(`event: done\ndata: ${data}\n\n`);
        res.end();
      } catch {
        // socket already closed
      }
      bus.off("output", onOutput);
    } else if (entry.type === "output") {
      try {
        res.write(`data: ${JSON.stringify({ line: entry.line })}\n\n`);
      } catch {
        bus.off("output", onOutput);
      }
    }
  };

  bus.on("output", onOutput);

  // Cancel any pending disconnect timer (reconnect)
  cancelDisconnectStop(jobId);

  // Clean up on client disconnect — schedule auto-stop after grace period
  req.on("close", () => {
    bus.off("output", onOutput);
    console.log(`[api] SSE client disconnected from job ${jobId}, scheduling auto-stop in 5s`);
    scheduleDisconnectStop(jobId, 30000);
  });
});

// Stop a running job
app.post("/api/jobs/:id/stop", (req, res) => {
  const result = stopJob(req.params.id);
  if (result.stopped) {
    console.log(`[api] Job stopped: ${req.params.id}`);
    res.json(result);
  } else {
    res.status(result.reason === "not_found" ? 404 : 409).json(result);
  }
});

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});

// ── Startup ─────────────────────────────────────────────────────────────────

cleanupStaleJobs();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔌 Orchestrator API listening on :${PORT}`);
  console.log(`   CORS origin: ${CORS_ORIGIN}`);
  console.log(`   Workspaces:  ${process.env.WORKSPACES_ROOT || "/workspaces"}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[api] SIGTERM received — shutting down gracefully");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[api] SIGINT received — shutting down gracefully");
  server.close(() => process.exit(0));
});
