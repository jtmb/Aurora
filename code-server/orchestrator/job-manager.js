/**
 * orchestrator/job-manager.js — Job Lifecycle Manager
 *
 * Manages orchestrator job lifecycle for the API server:
 *   - Spawns task-runner.js as a child process
 *   - Captures stdout line-by-line, emits SSE events
 *   - Enforces one-job-per-workspace
 *   - Persists state to /tmp/jobs/{jobId}/
 *   - Supports concurrent jobs across different workspaces
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ── Configuration ──────────────────────────────────────────────────────────

const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || "/workspaces";
const JOBS_DIR = process.env.JOBS_DIR || "/tmp/jobs";

// ── Event Bus ──────────────────────────────────────────────────────────────

/** Global event emitter for SSE subscribers. Each job's output is emitted as:
 *  { jobId, type: 'output'|'error'|'plan'|'done'|'status', line?, text?, exitCode?, state? }
 */
const bus = new EventEmitter();
bus.setMaxListeners(500);

// ── In-Memory Registry ─────────────────────────────────────────────────────

/** Map<jobId, { id, workspaceId, status, startedAt, process, outputLines }> */
const jobs = new Map();

// ── Disconnect timeout registry ────────────────────────────────────────────
// When the last SSE client disconnects, we start a 5s timer.
// If a new client reconnects before it fires, we cancel it.
// If it fires, we stop the job to prevent runaway LLM calls.
const disconnectTimers = new Map(); // jobId → setTimeout handle

// ── Helpers ─────────────────────────────────────────────────────────────────

function jobDir(jobId) {
  return join(JOBS_DIR, jobId);
}

function ensureJobDir(jobId) {
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Parse the orchestrator state JSON file */
function readJobState(jobId) {
  try {
    const statePath = join(jobDir(jobId), "orchestrator-state.json");
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    }
  } catch { /* not yet written */ }
  return null;
}

/** Find active job for a workspace */
function activeJobForWorkspace(workspaceId) {
  for (const [id, job] of jobs) {
    if (job.workspaceId === workspaceId && job.status === "running") {
      return id;
    }
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Start a new orchestrator job.
 * @param {string} task - The task description
 * @param {string} workspaceId - Workspace UUID
 * @param {string} [model] - Model ID to use
 * @param {string} [provider] - Provider type (openai, anthropic, deepseek, ollama, lmstudio)
 * @returns {{ jobId: string, workspaceId: string }}
 */
export function startJob(task, workspaceId, model, provider) {
  // Auto-stop any existing job for this workspace (handles page reload where
  // frontend loses track of activeJobId but orchestrator still has the job)
  const existingId = activeJobForWorkspace(workspaceId);
  if (existingId) {
    console.log(`[job-manager] Auto-stopping existing job ${existingId} for workspace ${workspaceId}`);
    stopJob(existingId);
  }

  const jobId = randomUUID();
  const dir = ensureJobDir(jobId);
  const workspaceDir = resolve(join(WORKSPACES_ROOT, workspaceId));

  // Create workspace dir if it doesn't exist
  mkdirSync(workspaceDir, { recursive: true });

  const job = {
    id: jobId,
    workspaceId,
    status: "running",
    startedAt: new Date().toISOString(),
    process: null,
    outputLines: [],
  };

  // ── Spawn task-runner.js ─────────────────────────────────────────────
  const env = {
    ...process.env,
    TASK: task,
    WORKSPACE_DIR: workspaceDir,
    STATE_DIR: dir,
    STOP_FILE: join(dir, "stop"),
    ORCH_MODEL: model || "",
    ORCH_PROVIDER: provider || "",
  };

  const child = spawn(
    "node",
    ["/opt/aurora/orchestrator/task-runner.js"],
    {
      cwd: workspaceDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  job.process = child;
  jobs.set(jobId, job);

  // ── Line-by-line stdout → SSE events ────────────────────────────────
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const entry = { jobId, type: "output", line, timestamp: Date.now() };
        job.outputLines.push(entry);
        // Keep last 5000 lines in memory
        if (job.outputLines.length > 5000) {
          job.outputLines.shift();
        }
        bus.emit("output", entry);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const entry = { jobId, type: "error", line, timestamp: Date.now() };
        bus.emit("output", entry);
      }
    }
  });

  // ── Completion handler ──────────────────────────────────────────────
  child.on("close", (exitCode) => {
    // Don't overwrite status if already stopped/complete (e.g. by stopJob)
    if (job.status === "running" || !job.status) {
      job.status = exitCode === 0 ? "complete" : "error";
    }
    job.exitCode = exitCode;
    job.finishedAt = new Date().toISOString();

    // Read final state
    const state = readJobState(jobId);
    job.state = state;

    bus.emit("output", {
      jobId,
      type: "done",
      exitCode,
      state,
      timestamp: Date.now(),
    });
  });

  child.on("error", (err) => {
    job.status = "error";
    job.error = err.message;
    job.finishedAt = new Date().toISOString();

    bus.emit("output", {
      jobId,
      type: "done",
      exitCode: 1,
      error: err.message,
      timestamp: Date.now(),
    });
  });

  return { jobId, workspaceId };
}

/**
 * Stop a running job.
 * @param {string} jobId
 * @returns {{ stopped: boolean }}
 */
export function stopJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    return { stopped: false, reason: "not_found" };
  }

  if (job.status !== "running") {
    return { stopped: false, reason: `already ${job.status}` };
  }

  // Write stop file — task-runner.js polls this
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stop"), "stopped-by-api");

  // Send SIGTERM to the process
  if (job.process && !job.process.killed) {
    job.process.kill("SIGTERM");
  }

  job.status = "stopped";
  job.finishedAt = new Date().toISOString();

  bus.emit("output", {
    jobId,
    type: "done",
    exitCode: null,
    stopped: true,
    timestamp: Date.now(),
  });

  return { stopped: true };
}

/**
 * Get a single job's status + metadata.
 * @param {string} jobId
 */
export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  const state = readJobState(jobId);
  const lastOutput = job.outputLines.slice(-100);

  return {
    id: job.id,
    workspaceId: job.workspaceId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    exitCode: job.exitCode ?? null,
    error: job.error || null,
    state: state ? { iterations: state.iterations, plan: state.plan?.slice(0, 500) } : null,
    outputLines: lastOutput.length,
    lastOutput: lastOutput.slice(-20).map((e) => e.line),
  };
}

/**
 * List all jobs.
 */
export function listJobs() {
  const result = [];
  for (const [id, job] of jobs) {
    result.push({
      id,
      workspaceId: job.workspaceId,
      status: job.status,
      startedAt: job.startedAt,
    });
  }
  return result.sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
  );
}

/**
 * Get the SSE event bus for tail subscriptions.
 */
export function getEventBus() {
  return bus;
}

/**
 * Cleanup stale jobs on startup (jobs from previous process with no active process).
 */
export function cleanupStaleJobs() {
  try {
    mkdirSync(JOBS_DIR, { recursive: true });
    const entries = readdirSync(JOBS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check if there's a stop file we should clean
        const stopFile = join(JOBS_DIR, entry.name, "stop");
        if (existsSync(stopFile)) {
          unlinkSync(stopFile);
        }
      }
    }
  } catch {
    // non-fatal
  }
}

/**
 * Schedule auto-stop when all SSE clients disconnect.
 * Called by api-server when a tail client disconnects.
 * @param {string} jobId
 * @param {number} [delayMs=5000]
 */
export function scheduleDisconnectStop(jobId, delayMs = 30000) {
  // Clear any existing timer
  cancelDisconnectStop(jobId);

  const timer = setTimeout(() => {
    const job = jobs.get(jobId);
    if (job && job.status === 'running') {
      console.log(`[job-manager] No SSE clients for ${delayMs}ms — auto-stopping job ${jobId}`);
      stopJob(jobId);
    }
    disconnectTimers.delete(jobId);
  }, delayMs);

  disconnectTimers.set(jobId, timer);
}

/**
 * Cancel a pending disconnect stop (client reconnected).
 * @param {string} jobId
 * @returns {boolean} true if a timer was cancelled
 */
export function cancelDisconnectStop(jobId) {
  const timer = disconnectTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(jobId);
    return true;
  }
  return false;
}
