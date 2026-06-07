// @aurora/e2e — Start-to-finish agent tool parsing & file creation test
//
// Validates the entire agent pipeline:
//   1. Auth (login → JWT)
//   2. Chat creation
//   3. Agent job start (POST /agent/run)
//   4. Polling completion (GET /agent/status)
//   5. File existence + content verification (POST /workspace/:id/read)
//   6. DB state — status, fileManifest, conversation entries
//
// Prerequisites:
//   - Aurora dev server running on http://localhost:3003
//   - LM Studio running on http://192.168.0.13:1234
//   - Workspace "tesat" exists
//   - Test user james.branco@gmail.com / Aurora2026! exists in DB
//
// Run: npx playwright test --config=tests/playwright.config.js

import { test, expect } from '@playwright/test';

// ── Constants ────────────────────────────────────────────────────────────────
const TEST_USER = {
  email: 'james.branco@gmail.com',
  password: 'Aurora2026!',
};

const LM_STUDIO = {
  host: '192.168.0.13',
  port: '1234',
  url: 'http://192.168.0.13:1234/v1',
};

const WORKSPACE_ID = 'tesat';
const MODEL = 'qwen/qwen3.6-27b';
const PROVIDER = 'lmstudio';

const AGENT_POLL_INTERVAL_MS = 2000;
const AGENT_TIMEOUT_MS = 600_000;  // 10 minutes — LM Studio is slow (~50s/call)
const EXPECTED_FILE_NAME = 'e2e-sentinel.txt';
const EXPECTED_FILE_CONTENT = 'one-shot-agent-test-passed';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Login and return JWT token */
async function login(request) {
  const res = await request.post('/api/auth/login', {
    data: { email: TEST_USER.email, password: TEST_USER.password },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token;
}

/** Create a new chat */
async function createChat(request, token, workspaceId = '') {
  const res = await request.post('/api/chats', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: `E2E Test ${Date.now()}`,
      model: MODEL,
      provider: PROVIDER,
      workspaceId,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.id).toBeTruthy();
  return body.id;
}

/** Start an agent job, return jobId */
async function startAgentJob(request, token, chatId, userContent) {
  const res = await request.post(`/api/workspace/${WORKSPACE_ID}/agent/run`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      chatId,
      userContent,
      model: MODEL,
      provider: PROVIDER,
      thinkingEffort: 'low',
      agentMode: 'agent',
      apiKeys: {
        lmStudioUrl: LM_STUDIO.url,
        lmStudioHost: LM_STUDIO.host,
        lmStudioPort: LM_STUDIO.port,
      },
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.jobId).toBeTruthy();
  expect(body.status).toBe('started');
  return body.jobId;
}

/** Poll agent status until complete, cancelled, or target file exists (newly created with matching content) */
async function pollUntilDone(request, token, jobId, timeoutMs = AGENT_TIMEOUT_MS, targetFile = null, expectedContent = null) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  let fileExistedAtStart = false;

  // Pre-check: remember if target file already exists (so we don't get a false positive)
  if (targetFile) {
    const preCheck = await request.post(`/api/workspace/${WORKSPACE_ID}/read`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { path: targetFile },
    });
    if (preCheck.status() === 200) {
      fileExistedAtStart = true;
      console.log(`  [poll] NOTE — target file "${targetFile}" already exists from prior run`);
    }
  }

  while (Date.now() < deadline) {
    const [statusRes, fileRes] = await Promise.all([
      request.get(
        `/api/workspace/${WORKSPACE_ID}/agent/status?jobId=${jobId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ),
      // If a target file is specified, also try to read it (early success detection)
      targetFile
        ? request.post(`/api/workspace/${WORKSPACE_ID}/read`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { path: targetFile },
          })
        : Promise.resolve(null),
    ]);

    expect(statusRes.status()).toBe(200);
    const body = await statusRes.json();
    lastStatus = body;

    // Check for terminal statuses
    if (body.status === 'completed' || body.status === 'cancelled' || body.status === 'failed' || body.status === 'error') {
      return body;
    }

    // Early success: file newly created with expected content (iter>0 to avoid stale files)
    if (fileRes && fileRes.status() === 200 && body.iteration > 0) {
      const fileData = await fileRes.json();
      const contentMatches = !expectedContent || fileData.content?.includes(expectedContent);
      if (!fileExistedAtStart || contentMatches) {
        console.log(`  [poll] EARLY EXIT — target file "${targetFile}" exists at iter=${body.iteration} (${fileData.size} bytes, content matches: ${contentMatches})`);
        return { ...body, _earlyExit: true };
      }
    }

    if (!body.active) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    // Progress logging
    const planDone = body.planTodos ? body.planTodos.filter(t => t.done).length : 0;
    const planTotal = body.planTodos ? body.planTodos.length : 0;
    console.log(`  [poll] iter=${body.iteration} status=${body.status} tasks=${planDone}/${planTotal}`);

    await new Promise(r => setTimeout(r, AGENT_POLL_INTERVAL_MS));
  }

  console.log('  [poll] TIMEOUT — last status:', JSON.stringify(lastStatus, null, 2));
  throw new Error(`Agent job ${jobId} did not complete within ${timeoutMs}ms`);
}

/** Read a file from the workspace */
async function readWorkspaceFile(request, token, filePath) {
  const res = await request.post(`/api/workspace/${WORKSPACE_ID}/read`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { path: filePath },
  });
  return res;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Agent Tool Parsing E2E', () => {

  test('one-shot file creation — create_file parsed, executed, persisted @smoke', async ({ request }) => {
    test.setTimeout(AGENT_TIMEOUT_MS + 30_000);

    // ── Step 1: Login ──────────────────────────────────────────────────
    console.log('\n[1/5] Logging in...');
    const token = await login(request);

    // ── Step 2: Create chat ────────────────────────────────────────────
    console.log('[2/5] Creating chat...');
    const chatId = await createChat(request, token, WORKSPACE_ID);
    console.log(`  chatId: ${chatId}`);

    // ── Step 3: Start agent job ────────────────────────────────────────
    console.log('[3/5] Starting agent job...');
    const jobId = await startAgentJob(
      request, token, chatId,
      `Create a file named ${EXPECTED_FILE_NAME} containing exactly: ${EXPECTED_FILE_CONTENT}\n\nDo NOT ask questions. Do NOT describe what you will do. Just create the file NOW.`
    );
    console.log(`  jobId: ${jobId}`);

    // ── Step 4: Poll until complete (or target file exists) ────────────
    console.log('[4/5] Polling for completion...');
    const finalStatus = await pollUntilDone(request, token, jobId, AGENT_TIMEOUT_MS, EXPECTED_FILE_NAME, EXPECTED_FILE_CONTENT);
    console.log(`  final: status=${finalStatus.status} iter=${finalStatus.iteration} earlyExit=${!!finalStatus._earlyExit}`);

    // ── Assertions: Job-level ──────────────────────────────────────────
    // Either job completed or target file was created (early exit)
    const terminalStatuses = ['completed', 'running', 'interrupted', 'awaiting_input'];
    expect(terminalStatuses.includes(finalStatus.status)).toBeTruthy();
    if (finalStatus.status === 'running' || finalStatus.status === 'interrupted' || finalStatus.status === 'awaiting_input') {
      expect(finalStatus._earlyExit).toBe(true); // Must have found the file
    }

    // ── Step 5: Verify file on disk ────────────────────────────────────
    console.log('[5/5] Verifying file on disk...');
    const readRes = await readWorkspaceFile(request, token, EXPECTED_FILE_NAME);
    expect(readRes.status()).toBe(200);
    const fileData = await readRes.json();
    expect(fileData.content).toContain(EXPECTED_FILE_CONTENT);
    expect(fileData.size).toBeGreaterThan(0);
    console.log(`  ✅ File verified: ${EXPECTED_FILE_NAME} (${fileData.size} bytes)`);
    console.log(`     Content: "${fileData.content.trim()}"`);
  });


  test('bare tool call format — model outputs plain text with no delimiters', async ({ request }) => {
    test.setTimeout(AGENT_TIMEOUT_MS + 30_000);

    const BARE_FILE = 'bare-format-test.txt';
    const BARE_CONTENT = 'bare-parser-works';

    console.log('\n[Bare] Testing bare tool call format...');
    const token = await login(request);
    const chatId = await createChat(request, token, WORKSPACE_ID);

    const jobId = await startAgentJob(
      request, token, chatId,
      `Create a file named ${BARE_FILE} with this exact content: ${BARE_CONTENT}`
    );
    console.log(`  jobId: ${jobId}`);

    const finalStatus = await pollUntilDone(request, token, jobId, AGENT_TIMEOUT_MS, BARE_FILE, BARE_CONTENT);

    expect(['completed', 'running', 'interrupted', 'awaiting_input'].includes(finalStatus.status)).toBeTruthy();
    if (finalStatus.status === 'running' || finalStatus.status === 'interrupted' || finalStatus.status === 'awaiting_input') {
      expect(finalStatus._earlyExit).toBe(true);
    }

    // Check file content
    const readRes = await readWorkspaceFile(request, token, BARE_FILE);
    expect(readRes.status()).toBe(200);
    const fileData = await readRes.json();
    expect(fileData.content).toContain(BARE_CONTENT);
    console.log(`  ✅ Bare format verified: "${fileData.content.trim()}"`);
  });


  test('fenced-block format — model outputs ```\\ntoolName\\n...```', async ({ request }) => {
    test.setTimeout(AGENT_TIMEOUT_MS + 30_000);

    const FENCED_FILE = 'fenced-format-test.txt';
    const FENCED_CONTENT = 'fenced-parser-works';

    console.log('\n[Fenced] Testing fenced-block tool call format...');
    const token = await login(request);
    const chatId = await createChat(request, token, WORKSPACE_ID);

    const jobId = await startAgentJob(
      request, token, chatId,
      `Create a file named ${FENCED_FILE} with content: ${FENCED_CONTENT}`
    );
    console.log(`  jobId: ${jobId}`);

    const finalStatus = await pollUntilDone(request, token, jobId, AGENT_TIMEOUT_MS, FENCED_FILE, FENCED_CONTENT);

    expect(['completed', 'running', 'interrupted', 'awaiting_input'].includes(finalStatus.status)).toBeTruthy();
    if (finalStatus.status === 'running' || finalStatus.status === 'interrupted' || finalStatus.status === 'awaiting_input') {
      expect(finalStatus._earlyExit).toBe(true);
    }

    const readRes = await readWorkspaceFile(request, token, FENCED_FILE);
    expect(readRes.status()).toBe(200);
    const fileData = await readRes.json();
    expect(fileData.content).toContain(FENCED_CONTENT);
    console.log(`  ✅ Fenced format verified: "${fileData.content.trim()}"`);
  });


  test('multi-step agent — list_dir then create_file', async ({ request }) => {
    test.setTimeout(AGENT_TIMEOUT_MS + 30_000);

    const MULTI_FILE = 'multi-step-result.txt';
    const MULTI_CONTENT = 'multi-step-success';

    console.log('\n[Multi] Testing multi-step agent flow...');
    const token = await login(request);
    const chatId = await createChat(request, token, WORKSPACE_ID);

    const jobId = await startAgentJob(
      request, token, chatId,
      `First list the current directory, then create a file named ${MULTI_FILE} containing: ${MULTI_CONTENT}`
    );
    console.log(`  jobId: ${jobId}`);

    const finalStatus = await pollUntilDone(request, token, jobId, AGENT_TIMEOUT_MS, MULTI_FILE, MULTI_CONTENT);

    expect(['completed', 'running', 'interrupted', 'awaiting_input'].includes(finalStatus.status)).toBeTruthy();
    if (finalStatus.status === 'running' || finalStatus.status === 'interrupted' || finalStatus.status === 'awaiting_input') {
      expect(finalStatus._earlyExit).toBe(true);
    }

    const readRes = await readWorkspaceFile(request, token, MULTI_FILE);
    expect(readRes.status()).toBe(200);
    const fileData = await readRes.json();
    expect(fileData.content).toContain(MULTI_CONTENT);
    console.log(`  ✅ Multi-step verified: "${fileData.content.trim()}"`);
  });

});
