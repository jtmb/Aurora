#!/usr/bin/env node
/**
 * orchestrator/task-runner.js — Autonomous App Builder Orchestration Layer
 *
 * TWO MODES IN ONE CONTAINER:
 *
 *   Interactive: code-server + Cline VS Code extension → browser at :8080
 *   Headless:    THIS FILE → iterative loop calling `cline --auto-approve true`
 *
 * Cline CLI (npm i -g cline):
 *   Installed globally in the image. The orchestrator spawns it with
 *   --auto-approve true for fully autonomous tool execution.
 *   Provider is set to openai-compatible → LM Studio via OPENAI_API_BASE env var.
 *
 * Architecture:
 *   Accept Task → Build Prompt → Spawn `cline --auto-approve` → Observe Result
 *                                                     ↓
 *                                            Stop on: completion / max iter / stop file
 *
 * Usage:
 *   node orchestrator/task-runner.js --task "Build a React todo app with SQLite"
 *   TASK="Build a React todo app" node orchestrator/task-runner.js
 *
 * Environment variables:
 *   TASK                 — The build task
 *   MAX_ITERATIONS       — Max loop iterations (default: 50)
 *   STOP_FILE            — Path to stop signal file (default: /tmp/orchestrator-stop)
 *   LMSTUDIO_URL         — LM Studio API base URL (also OPENAI_API_BASE)
 *   LMSTUDIO_MODEL       — Model ID (default: qwen-coder)
 *   WORKSPACE_DIR        — Workspace to run in (default: cwd)
 *   CLINE_TIMEOUT        — Timeout per cline call in seconds (default: 600)
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// ── Configuration ──────────────────────────────────────────────────────────

// Map provider short name to cline --provider flag and base URL
function resolveProvider(provider, model) {
  const p = (provider || "").toLowerCase();

  switch (p) {
    case "openai":
      return {
        clineProvider: "openai",
        baseUrl: process.env.OPENAI_API_BASE || "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY || "",
      };
    case "anthropic":
      return {
        clineProvider: "anthropic",
        baseUrl: "", // Anthropic uses native SDK, not base URL
        apiKey: process.env.ANTHROPIC_API_KEY || "",
      };
    case "deepseek":
      return {
        clineProvider: "openai-compatible",
        baseUrl: process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY || "",
      };
    case "ollama":
      return {
        clineProvider: "openai-compatible",
        baseUrl: process.env.OLLAMA_HOST || "http://localhost:11434/v1",
        apiKey: process.env.OLLAMA_API_KEY || "",
      };
    case "lmstudio":
    default:
      return {
        clineProvider: "openai-compatible",
        baseUrl: process.env.LMSTUDIO_URL || process.env.OPENAI_API_BASE || "http://localhost:1234/v1",
        apiKey: process.env.LMSTUDIO_API_KEY !== undefined ? process.env.LMSTUDIO_API_KEY : "",
      };
  }
}

const ORCH_MODEL = process.env.ORCH_MODEL || "";
const ORCH_PROVIDER = process.env.ORCH_PROVIDER || "";
const resolved = resolveProvider(ORCH_PROVIDER, ORCH_MODEL);

const CONFIG = {
  task: process.env.TASK || "",
  maxIterations: parseInt(process.env.MAX_ITERATIONS || "50", 10),
  stopFile: process.env.STOP_FILE || join(tmpdir(), "orchestrator-stop"),
  workspaceDir: resolve(process.env.WORKSPACE_DIR || process.cwd()),
  lmStudioUrl: process.env.LMSTUDIO_URL || process.env.OPENAI_API_BASE || "http://localhost:1234/v1",
  model: ORCH_MODEL || process.env.LMSTUDIO_MODEL || "qwen-coder",
  clineProvider: resolved.clineProvider,
  providerBaseUrl: resolved.baseUrl,
  providerApiKey: resolved.apiKey,
  clineTimeout: parseInt(process.env.CLINE_TIMEOUT || "600", 10), // 10 min default
  stateFile: join(
    process.env.STATE_DIR || tmpdir(),
    "orchestrator-state.json"
  ),
  cooldownMs: parseInt(process.env.COOLDOWN_MS || "2000", 10),
  planFirst: process.env.ORCHESTRATOR_PLAN_FIRST !== "false", // Default: true in yolo mode
};

// ── CLI Argument Parsing ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--task" && args[i + 1]) {
      CONFIG.task = args[i + 1];
      i++;
    } else if (args[i] === "--max-iterations" && args[i + 1]) {
      CONFIG.maxIterations = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--stop-file" && args[i + 1]) {
      CONFIG.stopFile = args[i + 1];
      i++;
    } else if (args[i] === "--workspace" && args[i + 1]) {
      CONFIG.workspaceDir = resolve(args[i + 1]);
      i++;
    }
  }
}

// ── State Management ──────────────────────────────────────────────────────

function loadState() {
  try {
    if (existsSync(CONFIG.stateFile)) {
      return JSON.parse(readFileSync(CONFIG.stateFile, "utf-8"));
    }
  } catch {
    // fresh start
  }
  return {
    iterations: 0,
    history: [],
    artifacts: [],
    startedAt: new Date().toISOString(),
  };
}

function saveState(state) {
  mkdirSync(join(CONFIG.stateFile, ".."), { recursive: true });
  writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

// ── Stop Signal Detection ─────────────────────────────────────────────────

function shouldStop(state) {
  // 1. Stop file exists (touch /tmp/orchestrator-stop)
  if (existsSync(CONFIG.stopFile)) {
    console.log("🛑 Stop file detected — halting orchestration.");
    unlinkSync(CONFIG.stopFile);
    return { stop: true, reason: "stop_file" };
  }

  // 2. Max iterations reached
  if (state.iterations >= CONFIG.maxIterations) {
    console.log(
      `⏰ Max iterations (${CONFIG.maxIterations}) reached — stopping.`
    );
    return { stop: true, reason: "max_iterations" };
  }

  // 3. Completion signals in last iteration output
  const lastIter = state.history[state.history.length - 1];
  if (lastIter) {
    // Direct completion flag from cline
    if (lastIter.taskCompleted) {
      console.log(`✅ Task completion detected by Cline`);
      return { stop: true, reason: "completion_detected" };
    }

    const output = (lastIter.output || "").toLowerCase();
    const completionMarkers = [
      "task complete",
      "all done",
      "finished successfully",
      "build complete",
      "implementation complete",
      "project is ready",
    ];
    for (const marker of completionMarkers) {
      if (output.includes(marker)) {
        console.log(`✅ Completion detected: "${marker}"`);
        return { stop: true, reason: "completion_detected" };
      }
    }
  }

  return { stop: false };
}

// ── Prompt Builder ────────────────────────────────────────────────────────

function buildIterationPrompt(state) {
  const iterationNum = state.iterations + 1;
  const isFirst = state.history.length === 0;

  if (isFirst) {
    let promptBase = `TASK: ${CONFIG.task}`;

    // Include the plan if we ran a planning phase
    if (state.plan) {
      promptBase += `

── PLAN (from planning phase) ──
${state.plan}`;
    }

    promptBase += `

INSTRUCTIONS:
1. Plan your approach. Break the task into concrete steps.
2. Create files, directories, and code as needed.
3. Run build/lint commands to verify your work.
4. After each major step, summarize what you've done and what remains.
5. When the task is fully complete, output: "TASK COMPLETE" followed by a summary.

WORKSPACE: ${CONFIG.workspaceDir}`;

    return promptBase;
  }

  // Subsequent iterations: provide context from prior runs
  const lastIter = state.history[state.history.length - 1];
  const recentHistory = state.history
    .slice(-3)
    .map(
      (h, i) =>
        `[Iter ${state.iterations - state.history.length + i + 1}]: ${h.summary?.slice(0, 800) || "(no output)"}`
    )
    .join("\n\n");

  return `CONTINUING — Iteration ${iterationNum}/${CONFIG.maxIterations}

ORIGINAL TASK: ${CONFIG.task}

RECENT ACTIVITY:
${recentHistory}

LAST OUTPUT:
${lastIter?.output?.slice(-3000) || "No prior output"}

INSTRUCTIONS:
1. Review what has been done so far.
2. Identify the NEXT logical step toward completing the task.
3. Execute that step.
4. If the task is now complete, output: "TASK COMPLETE" with a final summary.
5. If stuck, explain what's blocking progress.

WORKSPACE: ${CONFIG.workspaceDir}`;
}

// ── Cline CLI Execution ────────────────────────────────────────────────────

/**
 * Spawn `cline` CLI with --auto-approve true for fully autonomous execution.
 * Cline handles all tool calling (read_file, write_to_file, execute_command,
 * web_fetch, search_files, etc.) internally via the provider API.
 *
 * Flags:
 *   --auto-approve true   Zero-approval tool execution (essential for headless)
 *   --provider <id>       Provider override (openai-compatible)
 *   --model <model>       Model override
 *   -c <path>             Working directory
 *   --timeout <seconds>   Task timeout
 */
function runClineTask(prompt) {
  return new Promise((resolve, reject) => {
    const baseUrl = CONFIG.providerBaseUrl.replace(/\/+$/, "");
    const apiKey = CONFIG.providerApiKey;
    const clineProvider = CONFIG.clineProvider;

    const args = [
      "--verbose",
      "--auto-approve", "true",
      "--provider", clineProvider,
      "--model", CONFIG.model,
      "-c", CONFIG.workspaceDir,
      "--timeout", String(CONFIG.clineTimeout),
    ];

    // Only pass --key if API key is non-empty (LM Studio doesn't require auth)
    if (apiKey) {
      args.splice(5, 0, "--key", apiKey);
    }

    args.push(prompt);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🤖 Cline CLI — Iteration ${loadState().iterations + 1}`);
    console.log(`   Provider:   ${clineProvider}`);
    console.log(`   Base URL:   ${baseUrl}`);
    console.log(`   Model:      ${CONFIG.model}`);
    console.log(`   API Key:    ${apiKey ? (apiKey.slice(0,8) + "...") : "(empty)"}`);
    console.log(`   Workspace:  ${CONFIG.workspaceDir}`);
    console.log(`   Timeout:    ${CONFIG.clineTimeout}s`);
    console.log(`${"=".repeat(60)}\n`);

    // Ensure cline data directories exist to suppress hook errors
    mkdirSync("/tmp/cline-hooks", { recursive: true });
    mkdirSync("/tmp/cline-data", { recursive: true });

    const child = spawn("cline", args, {
      cwd: CONFIG.workspaceDir,
      env: {
        ...process.env,
        // Pass provider base URL for openai-compatible providers
        ...(clineProvider === "openai-compatible" ? { OPENAI_API_BASE: baseUrl } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text); // Stream to terminal
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      console.log(`\n📋 Cline exited with code ${code}`);
      const taskCompleted = checkCompletion(stdout);
      resolve({
        exitCode: code,
        output: stdout,
        stderr,
        summary: extractSummary(stdout),
        success: code === 0,
        taskCompleted,
      });
    });

    child.on("error", (err) => {
      console.error(`❌ Cline spawn error: ${err.message}`);
      reject(err);
    });
  });
}

function checkCompletion(output) {
  const lower = output.toLowerCase();
  const markers = [
    "task complete",
    "all done",
    "finished successfully",
    "build complete",
    "implementation complete",
    "project is ready",
    "task completed successfully",
  ];
  return markers.some((m) => lower.includes(m));
}

function extractSummary(output) {
  const lines = output.split("\n").filter(Boolean);
  // Look for summary markers
  const summaryIdx = lines.findIndex(
    (l) =>
      l.toLowerCase().includes("summary:") ||
      l.toLowerCase().includes("done:") ||
      l.toLowerCase().includes("completed:") ||
      l.toLowerCase().includes("task complete")
  );
  if (summaryIdx >= 0) {
    return lines.slice(summaryIdx).join("\n").slice(0, 1000);
  }
  // Fallback: last meaningful lines
  const meaningful = lines.filter((l) => l.length > 20);
  return meaningful.slice(-10).join("\n");
}

// ── Planning Phase (cline -p) ─────────────────────────────────────────────

/**
 * Run cline in PLAN MODE (-p) for read-only analysis.
 * No tools are executed — the model just reads codebase and produces a plan.
 * This is always run before the act loop in yolo/headless mode.
 */
function runClinePlan() {
  return new Promise((resolve, reject) => {
    const baseUrl = CONFIG.providerBaseUrl.replace(/\/+$/, "");
    const apiKey = CONFIG.providerApiKey;
    const clineProvider = CONFIG.clineProvider;

    const args = [
      "-p",                          // Plan mode — no tool execution
      "--verbose",
      "--provider", clineProvider,
      "--model", CONFIG.model,
      "-c", CONFIG.workspaceDir,
      "--timeout", String(Math.min(CONFIG.clineTimeout, 300)), // Plan: max 5 min
    ];

    // Inject API key if set (same as act mode)
    if (apiKey) {
      args.splice(2, 0, "--key", apiKey);
    }

    const planPrompt = `TASK: ${CONFIG.task}

You are in PLAN MODE. Do NOT write any code or execute any tools.
Instead, analyze the workspace and produce a detailed implementation plan.

Your plan must include:
1. Architecture overview — what components / files are needed
2. Step-by-step breakdown — ordered list of concrete actions
3. Dependencies — what packages or libraries will be needed
4. Edge cases and potential pitfalls
5. Testing strategy — how to verify the implementation works

FORMAT REQUIREMENT: Every concrete action in the step-by-step breakdown MUST use
this exact checkbox format (one per line):
- [ ] Create \`path/file.ext\`: description of what this file does
- [ ] Add package-name: reason for this dependency

Use \`- [ ]\` for pending tasks and \`- [x]\` for completed ones.
This is critical — the UI parses these checkboxes to show a task tracker.`;

    args.push(planPrompt);

    console.log(`\n🧠 PLANNING PHASE — analyzing task before execution...`);
    console.log(`   Provider:   ${clineProvider}`);
    console.log(`   Model:      ${CONFIG.model}`);
    console.log(`   Workspace:  ${CONFIG.workspaceDir}`);
    console.log(`   Timeout:    300s (plan mode cap)\n`);

    const child = spawn("cline", args, {
      cwd: CONFIG.workspaceDir,
      env: {
        ...process.env,
        ...(clineProvider === "openai-compatible" ? { OPENAI_API_BASE: baseUrl } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      console.log(`\n📋 Plan phase exited with code ${code}`);
      const planText = extractPlanText(stdout);
      resolve({
        exitCode: code,
        output: stdout,
        stderr,
        plan: planText,
        success: code === 0,
      });
    });

    child.on("error", (err) => {
      console.error(`❌ Plan phase spawn error: ${err.message}`);
      reject(err);
    });
  });
}

/** Extract the meaningful plan content from plan-mode output */
function extractPlanText(output) {
  // Plan output tends to be the body after the initial log lines.
  // Strip hook lines and keep content-heavy lines.
  const lines = output.split("\n");
  const contentLines = lines.filter(
    (l) =>
      !l.startsWith("[hook:") &&
      !l.startsWith("AI SDK Warning") &&
      l.trim().length > 0
  );

  // If we have good content, return it. Otherwise fall back to raw.
  const planText = contentLines.join("\n").trim();
  if (planText.length > 200) {
    return planText.slice(0, 8000); // Cap at 8K chars — enough context, not too much
  }
  // Plan mode might have failed; return what we have
  return output.slice(0, 8000);
}

// ── Main Loop ─────────────────────────────────────────────────────────────

async function main() {
  parseArgs();

  if (!CONFIG.task) {
    console.error("ERROR: No task specified. Use --task or set TASK env var.");
    console.error(
      "Example: node orchestrator/task-runner.js --task 'Build a React todo app'"
    );
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════════════╗
║     Autonomous App Builder — Orchestrator           ║
╠══════════════════════════════════════════════════════╣
║  Task:         ${CONFIG.task.slice(0, 40).padEnd(40)}║
║  Workspace:    ${CONFIG.workspaceDir.slice(0, 40).padEnd(40)}║
║  Max Iters:    ${String(CONFIG.maxIterations).padEnd(40)}║
║  Plan First:   ${String(CONFIG.planFirst).padEnd(40)}║
║  Stop File:    ${CONFIG.stopFile.slice(0, 40).padEnd(40)}║
║  LM Studio:    ${CONFIG.lmStudioUrl.slice(0, 40).padEnd(40)}║
╚══════════════════════════════════════════════════════╝
`);

  // Clean any stale stop file
  if (existsSync(CONFIG.stopFile)) {
    unlinkSync(CONFIG.stopFile);
  }

  let state = loadState();

  // ── Planning Phase (always in yolo/headless mode) ──────────────────
  if (CONFIG.planFirst) {
    try {
      const planResult = await runClinePlan();
      state.plan = planResult.plan || planResult.output?.slice(0, 8000) || "";
      if (state.plan) {
        console.log(`\n📝 Plan captured (${state.plan.length} chars) — feeding into act phase.`);
      } else {
        console.warn("⚠ Plan phase returned empty — proceeding without plan.");
      }
      // Save plan to state
      saveState(state);
    } catch (err) {
      console.warn(`⚠ Plan phase failed: ${err.message} — proceeding without plan.`);
      state.plan = null;
    }
  }

  // ── Act Loop ───────────────────────────────────────────────────────
  while (true) {
    // Check stop conditions BEFORE running
    const stopCheck = shouldStop(state);
    if (stopCheck.stop) {
      console.log(`\n⏹ Orchestrator stopped: ${stopCheck.reason}`);
      break;
    }

    // Build prompt and run
    const prompt = buildIterationPrompt(state);
    let result;

    try {
      result = await runClineTask(prompt);
    } catch (err) {
      console.error(`❌ Iteration failed: ${err.message}`);
      result = {
        exitCode: 1,
        output: `ERROR: ${err.message}`,
        stderr: err.message,
        summary: `Failed: ${err.message}`,
        success: false,
      };
    }

    // Record iteration
    state.iterations++;
    state.history.push({
      iteration: state.iterations,
      timestamp: new Date().toISOString(),
      success: result.success,
      summary: result.summary,
      output: result.output.slice(-10000), // Keep last 10K chars
      exitCode: result.exitCode,
      taskCompleted: result.taskCompleted || false,
    });

    saveState(state);

    // Check stop conditions AFTER running
    const postCheck = shouldStop(state);
    if (postCheck.stop) {
      console.log(`\n⏹ Orchestrator stopped: ${postCheck.reason}`);
      break;
    }

    // Cooldown between iterations
    console.log(
      `\n⏳ Cooldown ${CONFIG.cooldownMs / 1000}s before next iteration...`
    );
    await new Promise((r) => setTimeout(r, CONFIG.cooldownMs));
  }

  // Final report
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 FINAL REPORT");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Task:        ${CONFIG.task}`);
  console.log(`  Iterations:  ${state.iterations}`);
  console.log(
    `  Successful:  ${state.history.filter((h) => h.success).length}`
  );
  console.log(`  Duration:    ${computeDuration(state.startedAt)}`);
  console.log(
    `  Plan:        ${state.plan ? `${state.plan.length} chars captured` : "disabled"}`
  );
  console.log(
    `  Artifacts:   ${state.history.length > 0 ? "See workspace" : "None"}`
  );
  console.log(`  State file:  ${CONFIG.stateFile}`);
  console.log(`${"=".repeat(60)}`);

  process.exit(0);
}

function computeDuration(startedAt) {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const ms = now - start;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

// ── Signal Handlers ───────────────────────────────────────────────────────

process.on("SIGINT", () => {
  console.log("\n⚠ SIGINT received — writing stop file and exiting.");
  writeFileSync(CONFIG.stopFile, "interrupted");
  process.exit(130);
});

process.on("SIGTERM", () => {
  console.log("\n⚠ SIGTERM received — writing stop file and exiting.");
  writeFileSync(CONFIG.stopFile, "terminated");
  process.exit(143);
});

// ── Run ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
