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
import crypto from "crypto";

// ── JWT generation using built-in crypto (no external deps) ────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'aurora-dev-secret-change-in-production-minimum-32-chars';
const JWT_ISSUER = 'aurora-gateway';
const JWT_AUDIENCE = 'aurora-users';
const JWT_EXPIRY_HOURS = 24;

/**
 * Generate a JWT for a user using HMAC-SHA256.
 * Returns a signed JWT string that Aurora's AuthHandler can verify.
 */
function generateJwt(userId) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId,
    sub: userId,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    exp: now + (JWT_EXPIRY_HOURS * 60 * 60),
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

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

// Update Cline auth for the current user (called by proxy on user switch).
// Also filters Cline's provider & model config files to only show
// providers/models the user has access to.
app.post("/api/auth/update", async (req, res) => {
  try {
    const { userId, apiKey } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const homeDir = os.homedir();
    const clineDataDir = path.join(homeDir, '.cline', 'data');
    const settingsDir = path.join(clineDataDir, 'settings');
    const secretsFile = path.join(clineDataDir, 'secrets.json');
    const providersFile = path.join(settingsDir, 'providers.json');
    const globalStateFile = path.join(clineDataDir, 'globalState.json');

    fs.mkdirSync(clineDataDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });

    // Build effective API key (but DON'T write to secrets yet — we need
    // to know which providers the user can access first).
    const effectiveApiKey = apiKey || generateJwt(userId);

    // ── Step 1: Fetch user's allowed models from Aurora ──────────────
    // Fetch models from Aurora's /api/v1/models endpoint (orchestrator → Aurora API)
    const auroraBase = (process.env.AURORA_GATEWAY_URL || 'http://host.docker.internal:3000/api/v1')
      .replace(/\/+$/, '');
    let allowedProviders = new Set();
    let allowedModels = []; // [{provider, modelId}]
    let primaryProvider = '';
    let primaryModel = '';
    let fetchSucceeded = false;

    try {
      const resp = await fetch(`${auroraBase}/models`, {
        headers: { 'Authorization': `Bearer ${effectiveApiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        fetchSucceeded = true;
        const data = await resp.json();
        const models = data.data || [];
        allowedModels = models.map(m => ({
          provider: m.owned_by === 'deepseek' ? 'deepseek' :
                    m.owned_by === 'lmstudio' ? 'lmstudio' :
                    m.owned_by === 'openai' ? 'openai' : m.owned_by,
          modelId: m.id,
        }));
        allowedProviders = new Set(allowedModels.map(m => m.provider));

        // Pick primary: first deepseek model, else first lmstudio, else first any
        const dsModel = allowedModels.find(m => m.provider === 'deepseek');
        const lmModel = allowedModels.find(m => m.provider === 'lmstudio');
        const first = allowedModels[0];
        if (dsModel) { primaryProvider = 'deepseek'; primaryModel = dsModel.modelId; }
        else if (lmModel) { primaryProvider = 'lmstudio'; primaryModel = lmModel.modelId; }
        else if (first) { primaryProvider = first.provider; primaryModel = first.modelId; }

        console.log(`[api] User ${userId}: ${allowedModels.length} allowed models across ${allowedProviders.size} providers`);
      }
    } catch (err) {
      console.warn(`[api] Could not fetch allowed models from Aurora (keeping existing config):`, err.message);
    }

    // Only keep existing config if the Aurora API call actually failed.
    // If fetch succeeded with 0 models (user has no access), apply empty filter.
    if (!fetchSucceeded) {
      console.log(`[api] Aurora fetch failed — keeping existing Cline config for user: ${userId}`);
      return res.json({ status: 'ok', userId });
    }

    // ── Step 3: Update providers.json — remove unavailable providers ─
    // Always start from the pristine backup (providers.json.orig) written by
    // preconfigure-cline.sh, so filtering works correctly across user switches.
    // If a previous zero-access user cleared all providers, the backup ensures
    // the next user with access can still see their allowed providers.
    const providersBackup = path.join(settingsDir, 'providers.json.orig');
    const providersSource = fs.existsSync(providersBackup) ? providersBackup : providersFile;
    let providers = { version: 1, lastUsedProvider: primaryProvider, providers: {} };
    if (fs.existsSync(providersSource)) {
      try { providers = JSON.parse(fs.readFileSync(providersSource, 'utf-8')); } catch {}
    }

    // Keep only providers the user has access to
    const currentProviders = providers.providers || {};
    const filteredProviders = {};

    // Map provider names to their Cline API key field in settings
    const PROVIDER_API_KEY_FIELDS = {
      'deepseek':    ['deepseekApiKey', 'openAiApiKey'],
      'lmstudio':    ['lmStudioApiKey', 'openAiApiKey'],
      'openai':      ['openAiApiKey'],
      'anthropic':   ['anthropicApiKey'],
      'ollama':      ['ollamaApiKey'],
      'gemini':      ['geminiApiKey'],
      'xai':         ['xaiApiKey'],
      'openrouter':  ['openRouterApiKey'],
    };

    // Redirect ALL provider base URLs to Aurora gateway so model listing &
    // chat completions flow through Aurora's per-user filtering & routing.
    // Strip /api/v1 suffix — Cline appends api/v0/* to the base URL.
    const AURORA_BASE = (process.env.AURORA_GATEWAY_URL || 'http://host.docker.internal:3000')
      .replace(/\/api\/v1\/?$/, '');
    const PROVIDER_BASE_URL_FIELDS = {
      'deepseek':    'deepseekBaseUrl',
      'lmstudio':    'lmStudioBaseUrl',
      'openai':      'openAiBaseUrl',
      'anthropic':   'anthropicBaseUrl',
      'ollama':      'ollamaBaseUrl',
      'gemini':      'geminiBaseUrl',
      'xai':         'xaiBaseUrl',
      'openrouter':  'openRouterBaseUrl',
    };

    for (const [pname, pconfig] of Object.entries(currentProviders)) {
      if (allowedProviders.has(pname)) {
        filteredProviders[pname] = pconfig;
        const settings = pconfig.settings || {};

        // ── Redirect provider base URL → Aurora gateway ──
        // Model listing goes through Aurora for per-user filtering.
        // Chat completions are proxied by Aurora to the real provider.
        const baseUrlField = PROVIDER_BASE_URL_FIELDS[pname];
        if (baseUrlField) {
          settings[baseUrlField] = AURORA_BASE;
        }

        // ── Inject user's JWT as the API key for this provider ──
        // Cline calls Aurora API directly from inside Docker on port 3000,
        // bypassing cs-proxy. The JWT identifies the user at API level.
        const keyFields = PROVIDER_API_KEY_FIELDS[pname] || [];
        for (const kf of keyFields) {
          settings[kf] = effectiveApiKey;
        }

        // Update the model for this provider to an allowed one
        const providerModels = allowedModels.filter(m => m.provider === pname);
        if (providerModels.length > 0) {
          if (pname === 'deepseek') settings.model = providerModels[0].modelId;
          if (pname === 'lmstudio') settings.lmStudioModelId = providerModels[0].modelId;
          if (pname === 'openai') settings.openAiModelId = providerModels[0].modelId;
        }
        pconfig.settings = settings;
        pconfig.tokenSource = 'aurora';
      }
    }
    providers.providers = filteredProviders;
    // If lastUsedProvider is no longer available, switch to primary.
    // When user has zero access, clear the field entirely.
    if (allowedModels.length === 0) {
      providers.lastUsedProvider = '';
    } else if (providers.lastUsedProvider && !allowedProviders.has(providers.lastUsedProvider)) {
      providers.lastUsedProvider = primaryProvider;
    }
    fs.writeFileSync(providersFile, JSON.stringify(providers, null, 2));
    console.log(`[api] providers.json → ${Object.keys(filteredProviders).join(',') || '(none)'}`);

    // ── Step 4: Update globalState.json — switch to allowed provider ─
    let globalState = {};
    if (fs.existsSync(globalStateFile)) {
      try { globalState = JSON.parse(fs.readFileSync(globalStateFile, 'utf-8')); } catch {}
    }

    // Set plan/act mode to the primary provider.
    // When the user has zero allowed models, clear the provider keys so Cline
    // shows no model dropdown at all instead of falling back to deepseek.
    if (allowedModels.length > 0) {
      globalState.planModeApiProvider = primaryProvider;
      globalState.actModeApiProvider = primaryProvider;
    } else {
      delete globalState['planModeApiProvider'];
      delete globalState['actModeApiProvider'];
    }

    // Cline uses specific casing in globalState keys:
    // deepseek → DeepSeek, lmstudio → LmStudio, openai → OpenAi, etc.
    const PROVIDER_KEY_MAP = {
      'deepseek': 'DeepSeek',
      'lmstudio': 'LmStudio',
      'openai': 'OpenAi',
      'anthropic': 'Anthropic',
      'ollama': 'Ollama',
      'gemini': 'Gemini',
      'xai': 'Xai',
      'openrouter': 'OpenRouter',
    };

    // Clear ALL model IDs for all providers first (prevents stale keys)
    // Also clear the generic API model IDs (used by "API" provider, not provider-specific)
    delete globalState['planModeApiModelId'];
    delete globalState['actModeApiModelId'];
    for (const [p, capName] of Object.entries(PROVIDER_KEY_MAP)) {
      delete globalState[`planMode${capName}ModelId`];
      delete globalState[`actMode${capName}ModelId`];
      // Also clean up alternate casings (e.g. "Lmstudio" vs "LmStudio")
      const altCap = p.charAt(0).toUpperCase() + p.slice(1);
      if (altCap !== capName) {
        delete globalState[`planMode${altCap}ModelId`];
        delete globalState[`actMode${altCap}ModelId`];
      }
    }

    // Set model IDs for allowed providers (use first model as default)
    const seenProviders = new Set();
    for (const m of allowedModels) {
      if (seenProviders.has(m.provider)) continue; // first model wins
      seenProviders.add(m.provider);
      const capName = PROVIDER_KEY_MAP[m.provider] || (m.provider.charAt(0).toUpperCase() + m.provider.slice(1));
      globalState[`planMode${capName}ModelId`] = m.modelId;
      globalState[`actMode${capName}ModelId`] = m.modelId;
    }

    // Also delete alternate-casing model IDs for disallowed providers
    for (const [p, capName] of Object.entries(PROVIDER_KEY_MAP)) {
      if (!allowedProviders.has(p)) {
        delete globalState[`planMode${capName}ModelId`];
        delete globalState[`actMode${capName}ModelId`];
      }
    }

    // ── Redirect allowed provider base URLs → Aurora gateway ──
    // Model listing through Aurora for per-user filtering.
    // Chat completions proxied by Aurora to real provider.
    // Strip /api/v1 suffix — Cline appends api/v0/* to the base URL.
    const AURORA_GATEWAY = (process.env.AURORA_GATEWAY_URL || 'http://host.docker.internal:3000')
      .replace(/\/api\/v1\/?$/, '');
    for (const p of allowedProviders) {
      const baseKey = PROVIDER_BASE_URL_FIELDS[p];
      if (baseKey) globalState[baseKey] = AURORA_GATEWAY;
    }

    // Clear base URLs for disallowed providers so Cline won't try them
    for (const [p, baseKey] of Object.entries(PROVIDER_BASE_URL_FIELDS)) {
      if (!allowedProviders.has(p)) {
        globalState[baseKey] = '';
      }
    }

    fs.writeFileSync(globalStateFile, JSON.stringify(globalState, null, 2));
    console.log(`[api] globalState.json → primary: ${primaryProvider}/${primaryModel}`);

    // ── Step 5: Update hidden_providers.json — hide disallowed providers ──
    // Cline reads this file to determine which providers to show in the dropdown.
    // If we don't update it, users will see providers they shouldn't have access to.
    const hiddenProvidersFile = path.join(clineDataDir, 'hidden_providers.json');
    let hiddenProviders = {};
    if (fs.existsSync(hiddenProvidersFile)) {
      try { hiddenProviders = JSON.parse(fs.readFileSync(hiddenProvidersFile, 'utf-8')); } catch {}
    }
    hiddenProviders.remoteConfiguredProviders = [...allowedProviders];
    fs.writeFileSync(hiddenProvidersFile, JSON.stringify(hiddenProviders, null, 2));
    console.log(`[api] hidden_providers.json → [${[...allowedProviders].join(',')}]`);

    // ── Step 6: Write secrets.json — ONLY for allowed providers ──
    // Cline reads secrets.json to get API keys. If a key exists for a provider
    // the user doesn't have access to, Cline will offer that provider anyway.
    // Write the JWT ONLY to the generic "apiKey" field and to the specific
    // provider key fields that this user actually has access to.
    let secrets = {};
    if (fs.existsSync(secretsFile)) {
      try { secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf-8')); } catch {}
    }

    // Always set the generic apiKey (used for Aurora-routed providers)
    secrets.apiKey = effectiveApiKey;

    // Clear ALL provider-specific keys first
    const SECRETS_PROVIDER_KEYS = [
      'deepSeekApiKey', 'lmStudioApiKey', 'openAiApiKey',
      'anthropicApiKey', 'ollamaApiKey', 'geminiApiKey', 'xaiApiKey',
      'openRouterApiKey',
    ];
    for (const k of SECRETS_PROVIDER_KEYS) {
      delete secrets[k];
    }

    // Now set keys ONLY for allowed providers
    const SECRETS_KEY_MAP = {
      'deepseek': 'deepSeekApiKey',
      'lmstudio': 'lmStudioApiKey',
      'openai': 'openAiApiKey',
      'anthropic': 'anthropicApiKey',
      'ollama': 'ollamaApiKey',
      'gemini': 'geminiApiKey',
      'xai': 'xaiApiKey',
      'openrouter': 'openRouterApiKey',
    };
    for (const p of allowedProviders) {
      const keyName = SECRETS_KEY_MAP[p];
      if (keyName) secrets[keyName] = effectiveApiKey;
    }
    fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
    console.log(`[api] secrets.json → keys for: [${[...allowedProviders].join(',')}]`);

    // ── Step 7: Clean up models.json and providers-tmp.json ──
    // These files are written by preconfigure-cline.sh and may contain
    // models the user doesn't have access to.
    const modelsFile = path.join(settingsDir, 'models.json');
    if (fs.existsSync(modelsFile)) {
      try {
        let modelsConfig = JSON.parse(fs.readFileSync(modelsFile, 'utf-8'));
        const filteredModelProviders = {};
        for (const [pname, pdata] of Object.entries(modelsConfig.providers || {})) {
          if (allowedProviders.has(pname)) filteredModelProviders[pname] = pdata;
        }
        modelsConfig.providers = filteredModelProviders;
        fs.writeFileSync(modelsFile, JSON.stringify(modelsConfig, null, 2));
        console.log(`[api] models.json → [${Object.keys(filteredModelProviders).join(',')}]`);
      } catch (e) { /* not critical */ }
    }

    // providers-tmp.json is a cache written by preconfigure-cline.sh
    const providersTmpFile = path.join(clineDataDir, 'providers-tmp.json');
    if (fs.existsSync(providersTmpFile)) {
      try {
        let tmp = JSON.parse(fs.readFileSync(providersTmpFile, 'utf-8'));
        // Filter providers array: only keep allowed
        if (tmp.providers) {
          const filteredTmp = {};
          for (const p of allowedProviders) filteredTmp[p] = true;
          tmp.providers = filteredTmp;
        }
        // Filter models: only keep allowed provider models
        if (tmp.models) {
          const filteredModels = {};
          for (const p of allowedProviders) {
            if (tmp.models[p]) filteredModels[p] = tmp.models[p];
          }
          tmp.models = filteredModels;
        }
        fs.writeFileSync(providersTmpFile, JSON.stringify(tmp));
        console.log('[api] providers-tmp.json → filtered to allowed providers');
      } catch (e) { /* not critical */ }
    }

    console.log(`[api] Updated Cline auth + providers for user: ${userId}`);
    saveLastUserId(userId);
    res.json({ status: 'ok', userId, providers: [...allowedProviders], modelCount: allowedModels.length });
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

// ── Bootstrap: ensure secrets.json has a JWT (never aurora-no-key) ────────
// On first boot, preconfigure-cline.sh may write "aurora-no-key". Replace it
// with a bootstrap JWT so Cline never leaks all models to unauthenticated
// users. The real user JWT is written by auth/update when a user connects.
(function bootstrapSecrets() {
  try {
    const homeDir = os.homedir();
    const secretsFile = path.join(homeDir, '.cline', 'data', 'secrets.json');
    const stateFile = path.join(homeDir, '.cline', 'data', '.aurora_user_state.json');

    let secrets = {};
    if (fs.existsSync(secretsFile)) {
      try { secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf-8')); } catch {}
    }

    const currentKey = secrets.apiKey || '';
    // Check if we already have a valid JWT (starts with eyJ)
    const hasValidJwt = currentKey.startsWith('eyJ');

    if (!hasValidJwt) {
      // Try to restore last known userId from state file
      let userId = null;
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
          userId = state.lastUserId;
        } catch {}
      }

      // Generate a JWT — if we have a userId, use it (allows per-user filtering
      // to work immediately). If not, use a bootstrap user (returns empty list
      // until real auth happens via proxy).
      const effectiveUserId = userId || '00000000-0000-0000-0000-000000000000';
      const jwt = generateJwt(effectiveUserId);
      secrets.deepSeekApiKey = jwt;
      secrets.lmStudioApiKey = jwt;
      secrets.openAiApiKey = jwt;
      secrets.apiKey = jwt;
      fs.mkdirSync(path.dirname(secretsFile), { recursive: true });
      fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
      console.log(`[api] Bootstrap: wrote initial JWT to secrets.json (userId=${effectiveUserId.substring(0,8)}...)`);
    } else {
      console.log('[api] Bootstrap: secrets.json already has valid JWT');
    }
  } catch (err) {
    console.warn('[api] Bootstrap: could not write initial secrets.json:', err.message);
  }
})();

// Save last userId to state file whenever auth/update is called, so
// on next restart the orchestrator can restore the user's JWT immediately.
function saveLastUserId(userId) {
  try {
    const stateFile = path.join(os.homedir(), '.cline', 'data', '.aurora_user_state.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ lastUserId: userId, updatedAt: new Date().toISOString() }));
  } catch {}
}

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
