// @aurora/web - Server-side agent runner
// Runs the agentic loop independently of the browser UI.
// Persists all state to the agent_jobs table so jobs survive refreshes and server restarts.

import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildHeaders(apiKeys) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  // ONLY use keys from the job record (frontend localStorage) — NO env var fallbacks.
  // The completions route also only uses header-supplied keys, so env vars here
  // would silently route to an unintended provider (e.g. LM Studio when DeepSeek was selected).
  const keys = apiKeys || {};

  // LM Studio — construct URL from host+port or use direct URL
  const lmHost = keys.lmStudioHost || '';
  const lmPort = keys.lmStudioPort || '1234';
  const lmUrl = keys.lmStudioUrl || '';
  if (lmUrl) {
    headers['x-lmstudio-url'] = lmUrl;
  } else if (lmHost) {
    headers['x-lmstudio-url'] = `http://${lmHost}:${lmPort}/v1`;
  }
  if (keys.lmStudioApiKey) {
    headers['x-lmstudio-api-key'] = keys.lmStudioApiKey;
  }

  // DeepSeek
  const dsKey = keys.deepseekKey || '';
  if (dsKey) headers['x-deepseek-key'] = dsKey;

  // OpenAI / Anthropic
  if (keys.openaiKey) headers['x-openai-key'] = keys.openaiKey;
  if (keys.anthropicKey) headers['x-anthropic-key'] = keys.anthropicKey;

  return headers;
}

function parsePlanTodos(content) {
  const todos = [];
  let summary = '';
  const summaryMatch = content.match(/###\s*Summary\s*\n([\s\S]*?)(?=\n###\s*Tasks|\n*$)/i);
  if (summaryMatch) summary = summaryMatch[1].trim();

  // New format: - [ ] Task text
  const newTaskRegex = /^\s*-\s*\[([ xX])\]\s+(.+)$/gm;
  let taskMatch;
  while ((taskMatch = newTaskRegex.exec(content)) !== null) {
    const rawText = taskMatch[2].trim();
    const done = taskMatch[1].toLowerCase() === 'x';
    const dependsMatch = rawText.match(/[—\-]\s*\*?\s*depends?\s+on:\s*(.+?)\*?\s*$/i);
    const text = dependsMatch
      ? rawText.slice(0, dependsMatch.index).replace(/\s*[—\-]\s*$/, '').trim()
      : rawText;
    todos.push({ id: `plan_${todos.length}`, text, done, complexity: '🟢', phase: 'Tasks', phaseNum: 0, dependsOn: dependsMatch ? dependsMatch[1].trim() : null });
  }

  // Fallback: flat checkbox format
  if (todos.length === 0) {
    const regex = /^\s*(?:\d+\.|[-*])\s*\[([ xX])\]\s+(.+)$/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const text = match[2].trim();
      const dependsMatch = text.match(/\*\s*depends on\s+(.+?)\*\s*$/i);
      todos.push({
        id: `plan_${todos.length}`,
        text: dependsMatch ? text.replace(dependsMatch[0], '').trim() : text,
        done: match[1].toLowerCase() === 'x',
        complexity: '🟢', phase: 'Plan', phaseNum: 0,
        dependsOn: dependsMatch ? dependsMatch[1].trim() : null
      });
    }
  }
  return { todos, summary };
}

function flattenTree(node, parentPath = '') {
  const results = [];
  if (!node) return results;
  if (Array.isArray(node)) {
    for (const child of node) results.push(...flattenTree(child, parentPath));
    return results;
  }
  const name = node.name || '';
  const fullPath = parentPath ? `${parentPath}/${name}` : name;
  results.push({ name, path: fullPath, type: node.type || 'file' });
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) results.push(...flattenTree(child, fullPath));
  }
  return results;
}

function getContextWindow(model, provider) {
  if ((model || '').includes('gpt-4')) return 128000;
  if ((model || '').includes('gpt-3.5')) return 16385;
  if ((model || '').includes('claude-3-opus')) return 200000;
  if ((model || '').includes('claude-3')) return 200000;
  if ((model || '').includes('deepseek-v4')) return 131072;
  if ((model || '').includes('deepseek')) return 65536;
  if (provider === 'lmstudio') return 32768;
  if (provider === 'ollama') return 4096;
  return 128000;
}

// ── Tool parsing (same logic as AgentPanel) ──────────────────────────────────

const KNOWN_TOOL_NAMES = new Set([
  'list_dir', 'read_file', 'grep_search', 'create_file',
  'replace_string_in_file', 'run_in_terminal', 'dev_server_status',
  'dev_server_start', 'dev_server_stop', 'show_preview', 'create_skill'
]);

const CONTENT_TOOLS = ['create_file', 'replace_string_in_file', 'run_in_terminal', 'create_skill'];

function parseAttrs(attrString) {
  const a = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(attrString)) !== null) a[m[1]] = m[2];
  if (a.filePath === undefined && a.path !== undefined) a.filePath = a.path;
  if (a.path === undefined && a.filePath !== undefined) a.path = a.filePath;
  return a;
}

function parseToolCalls(content) {
  const calls = [];

  // Self-closing XML: <toolName attr="val"/>
  const selfClosingRegex = /<(\w+)((?:\s+\w+="[^"]*")*)\s*\/>/gi;
  let scMatch;
  while ((scMatch = selfClosingRegex.exec(content)) !== null) {
    const toolName = scMatch[1].toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
    const args = parseAttrs(scMatch[2]);
    const fp = args.filePath || args.path;
    if ((toolName === 'create_file' || toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) continue;
    if (toolName === 'create_file' && args.content === undefined) continue;
    calls.push({ name: toolName, args, raw: scMatch[0] });
  }

  // Child-element XML: <toolName>\n<param>value</param>\n</toolName>
  // Attribute+body XML: <toolName attr="val">body</toolName>
  const xmlRegex = /<(\w+)((?:\s+\w+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/gi;
  let xmlMatch;
  while ((xmlMatch = xmlRegex.exec(content)) !== null) {
    const toolName = xmlMatch[1].toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
    const args = parseAttrs(xmlMatch[2]);
    const innerContent = xmlMatch[3];
    const childRegex = /<(\w+)>([\s\S]*?)<\/\1>/gi;
    let child;
    let lastChildEnd = 0;
    while ((child = childRegex.exec(innerContent)) !== null) {
      const childName = child[1];
      const childValue = child[2].trim();
      if (childName === 'filePath' || childName === 'filepath' || childName === 'file_path') args.filePath = childValue;
      else if (childName === 'path') args.path = childValue;
      else if (childName === 'query') args.query = childValue;
      else if (childName === 'command') args.command = childValue;
      else if (childName === 'oldString' || childName === 'old_string') args.oldString = childValue;
      else if (childName === 'newString' || childName === 'new_string') args.newString = childValue;
      else if (childName === 'name') args.name = childValue;
      else if (childName === 'description') args.description = childValue;
      else if (childName === 'keywords') args.keywords = childValue;
      else if (childName === 'content') args.content = childValue;
      else args[childName] = childValue;
      lastChildEnd = child.index + child[0].length;
    }
    const bodyText = innerContent.slice(lastChildEnd).trim();
    if (bodyText && args.content === undefined) args.content = bodyText;
    if (args.filePath === undefined && args.path !== undefined) args.filePath = args.path;
    const fp = args.filePath || args.path;
    if ((toolName === 'create_file' || toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) continue;
    if (toolName === 'create_file' && args.content === undefined) continue;
    if (toolName === 'replace_string_in_file' && (!args.oldString || args.newString === undefined)) continue;
    calls.push({ name: toolName, args, raw: xmlMatch[0] });
  }

  // Fenced-code-block: ```toolName arg="value"\nbody\n```
  const regex = /```(\w+)\b\s*(.*?)```/gs;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const toolName = match[1];
    const fullRest = match[2];
    const newlineIdx = fullRest.indexOf('\n');
    const attrLine = newlineIdx >= 0 ? fullRest.slice(0, newlineIdx) : fullRest;
    let body = newlineIdx >= 0 ? fullRest.slice(newlineIdx + 1).trim() : '';
    const args = {};
    const attrRegex = /(\w+)=(?:"([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRegex.exec(attrLine)) !== null) args[am[1]] = am[2] || am[3] || '';
    if (CONTENT_TOOLS.includes(toolName)) {
      if (toolName === 'replace_string_in_file') {
        const findIdx = body.indexOf('===FIND===');
        const replaceIdx = body.indexOf('===REPLACE===');
        if (findIdx >= 0 && replaceIdx >= 0) {
          args.oldString = body.slice(findIdx + 10, replaceIdx).trim();
          args.newString = body.slice(replaceIdx + 13).trim();
        }
      } else {
        args.content = body;
      }
    }
    const nameMap = {
      'create_file': 'create_file', 'read_file': 'read_file',
      'list_dir': 'list_dir', 'grep_search': 'grep_search',
      'replace_string_in_file': 'replace_string_in_file',
      'run_in_terminal': 'run_in_terminal',
      'dev_server_status': 'dev_server_status',
      'dev_server_start': 'dev_server_start',
      'dev_server_stop': 'dev_server_stop',
      'show_preview': 'show_preview', 'create_skill': 'create_skill'
    };
    if (nameMap[toolName]) {
      const fp = args.filePath || args.path;
      if ((toolName === 'create_file' || toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) continue;
      if (toolName === 'create_file' && args.content === undefined) continue;
      if (toolName === 'replace_string_in_file' && (!args.oldString || args.newString === undefined)) continue;
      calls.push({ name: toolName, args, raw: match[0] });
    }
  }
  return calls;
}

// ── Tool execution (server-side, via fetch to local API routes) ──────────────

const TOOL_TIMEOUT = 30000;

async function executeToolCall(tc, wsId) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Tool ${tc.name} timed out after ${TOOL_TIMEOUT / 1000}s`)), TOOL_TIMEOUT)
  );
  try {
    const result = await Promise.race([(async () => {
      const base = `http://localhost:${process.env.PORT || 3000}`;
      switch (tc.name) {
        case 'read_file': {
          const res = await fetch(`${base}/api/workspace/${wsId}/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { content: data.content, size: data.size };
        }
        case 'create_file': {
          const res = await fetch(`${base}/api/workspace/${wsId}/write`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path, content: tc.args.content })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { success: true, created: data.created };
        }
        case 'replace_string_in_file': {
          // Read, replace, write
          const readRes = await fetch(`${base}/api/workspace/${wsId}/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path })
          });
          const readData = await readRes.json();
          if (readData.error) return { error: readData.error.message };
          const oldContent = readData.content;
          if (!oldContent.includes(tc.args.oldString)) {
            return { error: `Could not find oldString in file. File may have been modified.` };
          }
          const newContent = oldContent.replace(tc.args.oldString, tc.args.newString);
          const writeRes = await fetch(`${base}/api/workspace/${wsId}/write`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path, content: newContent })
          });
          const writeData = await writeRes.json();
          if (writeData.error) return { error: writeData.error.message };
          return { success: true };
        }
        case 'grep_search': {
          const res = await fetch(`${base}/api/workspace/${wsId}/search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: tc.args.query })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { results: data.results || [], total: data.total };
        }
        case 'list_dir': {
          const pathParam = tc.args.path || '.';
          const res = await fetch(`${base}/api/workspace/${wsId}/tree?depth=2`);
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          const flat = flattenTree(data.tree);
          if (pathParam === '.' || pathParam === '/') return { files: flat };
          const prefix = pathParam.replace(/\/$/, '') + '/';
          return { files: flat.filter(f => (f.path || '').startsWith(prefix)) };
        }
        case 'run_in_terminal': {
          const res = await fetch(`${base}/api/workspace/${wsId}/exec`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: tc.args.command })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { success: data.success, stdout: data.stdout, stderr: data.stderr, exitCode: data.exitCode };
        }
        case 'dev_server_status': {
          const res = await fetch(`${base}/api/workspace/${wsId}/dev-server`, { method: 'GET' });
          const data = await res.json();
          return { running: data.running || false, port: data.port, url: data.url, logs: data.logs };
        }
        case 'dev_server_start': {
          const res = await fetch(`${base}/api/workspace/${wsId}/dev-server`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: tc.args.command || 'npm run dev' })
          });
          const data = await res.json();
          return { running: data.running || false, port: data.port, url: data.url, command: data.command, logs: data.logs };
        }
        case 'dev_server_stop': {
          const res = await fetch(`${base}/api/workspace/${wsId}/dev-server`, { method: 'DELETE' });
          const data = await res.json();
          return { message: data.message || 'Server stopped' };
        }
        case 'show_preview': {
          return { shown: true };
        }
        case 'create_skill': {
          return { success: true, name: tc.args.name };
        }
        default: return { error: `Unknown tool: ${tc.name}` };
      }
    })(), timeoutPromise]);
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

function summarizeToolResult(name, args, result) {
  const fp = args.filePath || args.path || '?';
  switch (name) {
    case 'read_file': return `Read \`${fp}\` (${result.size || result.content?.length || 0} bytes): ${(result.content || '').slice(0, 500)}${(result.content || '').length > 500 ? '...' : ''}`;
    case 'create_file': return `Created \`${fp}\` successfully`;
    case 'replace_string_in_file': return `Patched \`${fp}\` successfully`;
    case 'grep_search': return `Found ${result.results?.length || 0} matches for "${args.query}": ${JSON.stringify((result.results || []).slice(0, 5))}`;
    case 'list_dir': {
      const files = result.files || [];
      return `Listed ${fp}: ${files.length} entries — ${files.slice(0, 20).map(f => f.name || f.path).join(', ')}${files.length > 20 ? '...' : ''}`;
    }
    case 'dev_server_status': return result.running ? `Server running on port ${result.port} (${result.url}).` : 'Server not running';
    case 'dev_server_start': return result.running ? `Server started on port ${result.port} (${result.url}).` : `Server start attempted.`;
    case 'dev_server_stop': return result.message || 'Server stopped';
    case 'show_preview': return result.shown ? 'Preview panel opened' : 'Preview not available';
    case 'run_in_terminal': return result.success ? `Command succeeded (exit ${result.exitCode}). ${(result.stdout || '').slice(0, 300)}` : `Command failed (exit ${result.exitCode}). ${(result.stderr || result.stdout || '').slice(0, 300)}`;
    default: return 'Done';
  }
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function loadJob(jobId) {
  runMigrations();
  const db = getDb();
  const job = db.prepare("SELECT * FROM agent_jobs WHERE id = ?").get(jobId);
  if (!job) return null;
  return {
    ...job,
    plan_todos: JSON.parse(job.plan_todos || '[]'),
    conversation: JSON.parse(job.conversation || '[]'),
    file_manifest: JSON.parse(job.file_manifest || '[]'),
    api_keys: JSON.parse(job.api_keys || '{}'),
  };
}

function saveJob(job) {
  const db = getDb();
  db.prepare(`
    UPDATE agent_jobs SET
      status = ?, model = ?, provider = ?, thinking_effort = ?,
      agent_mode = ?, user_request = ?, plan_todos = ?, plan_summary = ?,
      iteration = ?, conversation = ?, file_manifest = ?, api_keys = ?,
      error_message = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    job.status, job.model, job.provider, job.thinkingEffort || 'high',
    job.agentMode || 'agent', job.userRequest || '', JSON.stringify(job.planTodos || []), job.planSummary || '',
    job.iteration || 0, JSON.stringify(job.conversation || []), JSON.stringify(job.fileManifest || []),
    JSON.stringify(job.api_keys || {}),
    job.errorMessage || '', job.id
  );
}

async function saveMessageToChat(chatId, role, content, model, provider, msgId, timestamp) {
  try {
    runMigrations();
    const db = getDb();
    const messageId = msgId || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const ts = timestamp || new Date().toISOString();

    // Get next position
    const lastMsg = db.prepare('SELECT MAX(position) as maxPos FROM messages WHERE chat_id = ?').get(chatId);
    const position = (lastMsg?.maxPos ?? -1) + 1;

    db.prepare(`
      INSERT INTO messages (id, chat_id, role, content, model, provider, timestamp, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, chatId, role, content, model || '', provider || '', ts, position);

    // Update chat metadata
    db.prepare(`
      UPDATE chats SET last_message_at = ?, message_count = message_count + 1 WHERE id = ?
    `).run(ts, chatId);
  } catch (err) {
    console.error('[agent-runner] Failed to save message:', err.message);
  }
}

// ── System prompt builder (same logic as AgentPanel) ─────────────────────────

function buildSystemPrompt(wsId, mode = 'agent') {
  if (mode === 'agent') {
    const toolSyntax = [
      'create_file filePath="path/file.ext"',
      '  FILE CONTENT HERE',
      '```',
      'read_file filePath="path/file.ext"',
      'list_dir path="."',
      'replace_string_in_file filePath="path/file.ext"',
      '  ===FIND===',
      '  old text',
      '  ===REPLACE===',
      '  new text',
      'grep_search query="pattern"',
      'dev_server_status',
      'dev_server_start command="npm run dev"',
      'dev_server_stop',
      'show_preview'
    ].join('\n');

    let base = 'Workspace API: /api/workspace/' + wsId + '. Use RELATIVE paths: "." is root.\n' +
      'TOOL SYNTAX:\n' + toolSyntax + '\n' +
      '- First step: `list_dir path="."` to see what exists.\n' +
      '- create_file puts content INSIDE the block body, never as content="..." attribute.\n' +
      '- Call ONE tool per response. Nothing outside the fenced block.\n' +
      '\nTHINK-THEN-ACT — Before every action, briefly reason (1-3 lines max):\n' +
      '1. WHAT file are you creating/modifying and WHY?\n' +
      '2. Are your IMPORTS correct?\n' +
      '3. Does this step have all DEPENDENCIES resolved?\n' +
      'Output your reasoning in plain text, then the tool block.\n';

    return base;
  }

  // Plan mode
  return `You are a planning assistant. Explore the workspace, understand the codebase, and produce a structured implementation plan.

## EXPLORATION TOOL FORMAT
To explore the workspace, use fenced code blocks with EXACTLY this syntax:
\`\`\`list_dir path="."
\`\`\`
\`\`\`read_file filePath="src/index.ts"
\`\`\`
\`\`\`grep_search query="pattern"
\`\`\`

## RULES
- Explore thoroughly: use list_dir and read_file to understand the codebase.
- NEVER use write/modify tools (create_file, replace_string_in_file, run_in_terminal).
- Only use read_file, list_dir, grep_search.
- When you have enough context, output your plan.

## PLAN OUTPUT FORMAT
\`\`\`
1. [ ] Task description (brief, actionable)
2. [ ] Task description
...
\`\`\`

Each task must be a SINGLE concrete action. Tasks in execution ORDER. 5-15 tasks total.`;
}

// ── Build compact summary (for context window management) ────────────────────

function buildCompactSummary(iter, fileManifest, planTodos, originalRequest, executionErrors) {
  const doneCount = planTodos.filter(t => t.done).length;
  const pending = planTodos.filter(t => !t.done);
  const created = fileManifest.filter(f => f.action === 'created').map(f => f.path);
  const modified = fileManifest.filter(f => f.action === 'modified').map(f => f.path);

  let summary = `[CONTEXT SUMMARY after ${iter} iterations]\n`;
  summary += `Progress: ${doneCount}/${planTodos.length} tasks done.\n`;
  if (pending.length > 0) {
    summary += `Remaining: ${pending.map(t => t.text).join('; ')}\n`;
  }
  if (created.length > 0) summary += `Created: ${created.join(', ')}\n`;
  if (modified.length > 0) summary += `Modified: ${modified.join(', ')}\n`;
  if (executionErrors.length > 0) summary += `Recent errors: ${executionErrors.slice(-3).join('; ')}\n`;
  summary += `\nOriginal request: ${originalRequest}\n`;
  summary += `Continue with the next pending task. Use a tool call.`;
  return summary;
}

// ── Main agent loop ──────────────────────────────────────────────────────────

/**
 * Run the agentic loop for a job. This function runs asynchronously and
 * persists progress to the DB after every iteration.
 *
 * @param {string} jobId - The job ID from agent_jobs table
 */
export async function runAgentJob(jobId) {
  let job = loadJob(jobId);
  if (!job) {
    console.error(`[agent-runner] Job ${jobId} not found`);
    return;
  }

  // Don't restart completed, cancelled, or already-running jobs
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    console.log(`[agent-runner] Job ${jobId} already ${job.status}, skipping`);
    return;
  }

  console.log(`[agent-runner] Starting job ${jobId} for workspace ${job.workspace_id} (mode: ${job.agent_mode || 'agent'})`);
  job.status = 'running';
  saveJob(job);

  const MAX_ITERATIONS = 50;
  const workspaceId = job.workspace_id;
  const chatId = job.chat_id;
  const model = job.model || 'gpt-4o';
  const provider = job.provider || 'openai';
  const thinkingEffort = job.thinkingEffort || job.thinking_effort || 'high';
  const agentMode = job.agentMode || job.agent_mode || 'agent';

  // State
  let conversation = job.conversation || [];
  let planTodos = job.planTodos || job.plan_todos || [];
  let planSummary = job.planSummary || job.plan_summary || '';
  let fileManifest = job.fileManifest || job.file_manifest || [];
  const originalRequest = job.userRequest || job.user_request || '';
  let checkpointTaken = false;
  let compactedAt = -1;
  let noToolStreak = 0;
  let planCompleted = false;
  let buildAttempted = false;
  let buildVerificationRetries = 0;
  let barrenStreak = 0;
  const executionErrors = [];
  const recentToolCalls = [];
  const recentToolResults = [];

  try {
    let startIter = job.iteration || 0;

    // If resuming from interruption, reconstruct the loop position
    if (conversation.length > 0) {
      console.log(`[agent-runner] Resuming job ${jobId} at iteration ${startIter}`);
    }

    for (let iter = startIter; iter < MAX_ITERATIONS; iter++) {
      const label = iter > 0 ? `Step ${iter + 1}` : null;

      // ── Check for cancellation before each iteration ──
      const liveJob = loadJob(jobId);
      if (!liveJob || liveJob.status === 'cancelled') {
        console.log(`[agent-runner] Job ${jobId} cancelled at iteration ${iter}`);
        job.status = 'cancelled';
        saveJob(job);
        return;
      }

      // ── LLM Call ──
      const apiKeys = job.api_keys || {};
      const { content: rawContent, thinking } = await llmCall(conversation, model, provider, thinkingEffort, apiKeys);
      const assistantId = `agent_${Date.now()}_${iter}`;
      conversation.push({ role: 'assistant', content: rawContent });

      // Save assistant message
      await saveMessageToChat(chatId, 'assistant', rawContent, model, provider, assistantId, new Date().toISOString());

      // Parse tool calls
      const toolCalls = parseToolCalls(rawContent);

      if (toolCalls.length === 0) {
        // Plan mode: parse plan from response
        if (agentMode === 'plan') {
          const { todos, summary } = parsePlanTodos(rawContent);
          if (todos.length > 0) {
            planTodos = todos;
            planSummary = summary;
            planCompleted = true;

            // Write PLAN.md
            try {
              const planLines = [`# Implementation Plan`, ``, `> **Request:** ${originalRequest.slice(0, 200)}`, ``, `## Tasks`, ``];
              for (const t of todos) planLines.push(`- [${t.done ? 'x' : ' '}] ${t.text}`);
              const planMd = planLines.join('\n');
              await executeToolCall({ name: 'create_file', args: { filePath: 'PLAN.md', content: planMd } }, workspaceId);
            } catch (err) {
              console.warn('[agent-runner] Failed to write PLAN.md:', err.message);
            }
            break;
          }
        }

        // No tools, pending tasks?
        const stillPending = planTodos.filter(t => !t.done);
        if (stillPending.length > 0) {
          noToolStreak++;
          if (noToolStreak >= 3) {
            if (fileManifest.length > 0 && !buildAttempted) {
              const bvResult = await runBuildVerification(workspaceId, fileManifest, planTodos, conversation, buildVerificationRetries);
              buildVerificationRetries = bvResult.retries;
              if (bvResult.built) { buildAttempted = true; break; }
            }
            break;
          }
          const nextTask = stillPending[0];
          const pendingList = stillPending.map(t => `- [ ] ${t.text}`).join('\n');
          conversation.push({
            role: 'user',
            content: `You stopped but tasks remain. Your NEXT task is: ${nextTask.text}\n\nAll pending tasks:\n${pendingList}\n\nComplete the NEXT task NOW with a tool call. Do NOT respond without a tool call.`
          });
          continue;
        }

        // Build verification
        if (fileManifest.length > 0 && !buildAttempted) {
          const bvResult = await runBuildVerification(workspaceId, fileManifest, planTodos, conversation, buildVerificationRetries);
          buildVerificationRetries = bvResult.retries;
          if (bvResult.built) { buildAttempted = true; break; }
          if (buildVerificationRetries >= 3) {
            buildAttempted = true;
            conversation.push({ role: 'user', content: `Build verification failed after ${buildVerificationRetries} attempts. Summarize accomplishments and respond "Task complete."` });
            continue;
          }
          continue;
        }
        break;
      }

      noToolStreak = 0;

      // Checkpoint before first write
      if (!checkpointTaken && toolCalls.some(tc => tc.name === 'create_file' || tc.name === 'replace_string_in_file')) {
        try {
          const base = `http://localhost:${process.env.PORT || 3000}`;
          const res = await fetch(`${base}/api/workspace/${workspaceId}/git/commit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `checkpoint: agent step ${iter}` })
          });
          if (res.ok) checkpointTaken = true;
        } catch {}
      }

      // Stuck detection
      const last3 = recentToolCalls.slice(-3);
      const stuckTools = toolCalls.filter(tc => {
        if (['list_dir', 'read_file', 'dev_server_status'].includes(tc.name)) {
          const fp = tc.args.filePath || tc.args.path || '';
          const sameCount = last3.filter(l => l.name === tc.name && l.filePath === fp).length;
          return sameCount >= 2;
        }
        return false;
      });

      if (stuckTools.length > 0 && last3.length >= 3) {
        const pendingTasks = planTodos.filter(t => !t.done);
        const nextTask = pendingTasks[0];
        if (!nextTask && fileManifest.length > 0 && !buildAttempted) {
          const bvResult = await runBuildVerification(workspaceId, fileManifest, planTodos, conversation, buildVerificationRetries);
          buildVerificationRetries = bvResult.retries;
          if (bvResult.built) { buildAttempted = true; break; }
          continue;
        }
        const stuckDesc = stuckTools.map(t => `${t.name} ${t.args.filePath || t.args.path || '.'}`).join(', ');
        const nextTaskHint = nextTask ? ` Your next task is: "${nextTask.text}". Complete it NOW.` : '';
        conversation.push({
          role: 'user',
          content: `You've called ${stuckDesc} repeatedly. The files exist — you're in a verification loop. MOVE ON.${nextTaskHint} If all tasks are done, respond "Task complete" without any tool block.`
        });
        continue;
      }

      // Dev server anti-polling
      const last3Results = recentToolResults.slice(-3);
      if (last3Results.length >= 3 && last3Results.every(r => r.name === 'dev_server_status' && r.summary === 'Server not running')) {
        conversation.push({
          role: 'user',
          content: `The dev server is NOT running. Use \`dev_server_start\` to START it — do NOT call \`dev_server_status\` again until you start the server.`
        });
        continue;
      }

      // Read-only streak
      const last5Calls = recentToolCalls.slice(-5);
      const READ_ONLY_TOOLS = ['list_dir', 'read_file', 'grep_search', 'dev_server_status', 'dev_server_stop'];
      if (last5Calls.length >= 5 && last5Calls.every(tc => READ_ONLY_TOOLS.includes(tc.name))) {
        const nextTask = planTodos.filter(t => !t.done)[0];
        const nextTaskHint = nextTask ? ` Complete: "${nextTask.text}" with a \`create_file\` or \`replace_string_in_file\` call NOW.` : ' If all done, respond "Task complete".';
        conversation.push({
          role: 'user',
          content: `You've made 5 read-only calls in a row without writing or building anything. You're stuck in analysis.${nextTaskHint}`
        });
        continue;
      }

      // Barren streak
      if (barrenStreak >= 8) {
        const nextTask = planTodos.filter(t => !t.done)[0];
        if (!nextTask && fileManifest.length === 0) break;
        conversation.push({
          role: 'user',
          content: `You've spent ${barrenStreak} iterations without creating or modifying any files. You are in a loop.${nextTask ? ` Your next pending task is: "${nextTask.text}". Complete it NOW with a tool call.` : ' If all tasks are done, respond "Task complete" with no tool block.'}`
        });
        barrenStreak = 0;
        continue;
      }

      // Execute tools
      for (const tc of toolCalls) {
        recentToolCalls.push({ name: tc.name, filePath: tc.args.filePath || tc.args.path || '' });
        if (recentToolCalls.length > 10) recentToolCalls.shift();

        const result = await executeToolCall(tc, workspaceId);

        // Track tool result
        const resultSummaryShort = summarizeToolResult(tc.name, tc.args, result).slice(0, 80);
        recentToolResults.push({ name: tc.name, summary: resultSummaryShort });
        if (recentToolResults.length > 10) recentToolResults.shift();

        // Track file changes
        if (!result.error && (tc.name === 'create_file' || tc.name === 'replace_string_in_file')) {
          const fp = tc.args.filePath || tc.args.path;
          if (fp) {
            barrenStreak = 0;
            // Verify file exists after create
            if (tc.name === 'create_file') {
              const verifyRes = await executeToolCall({ name: 'read_file', args: { filePath: fp } }, workspaceId);
              if (verifyRes.error) {
                conversation.push({
                  role: 'user',
                  content: `⚠️ HALLUCINATION DETECTED: You claimed to create \`${fp}\` but the file does NOT exist on disk. Re-create it NOW.`
                });
                continue;
              }
            }
            const existing = fileManifest.find(f => f.path === fp);
            const action = tc.name === 'create_file' ? 'created' : 'modified';
            if (existing) { existing.action = action; }
            else { fileManifest.push({ path: fp, action, purpose: '' }); }

            // Check for task completion markers
            const checkoffRegex = /\[x\]\s*(.+)$/gm;
            let cm;
            while ((cm = checkoffRegex.exec(rawContent)) !== null) {
              const checkedText = cm[1].trim().toLowerCase();
              const updated = planTodos.map(t => {
                if (t.done) return t;
                const words = checkedText.split(/\s+/).filter(w => w.length > 2);
                const taskLower = t.text.toLowerCase();
                const matchCount = words.filter(w => taskLower.includes(w)).length;
                if (matchCount >= Math.min(2, words.length) && matchCount > 0) {
                  return { ...t, done: true };
                }
                return t;
              });
              if (updated.some((t, i) => t.done !== planTodos[i].done)) {
                planTodos = updated;
              }
            }
          }
        }

        // Track build attempts
        if (!result.error && (
          tc.name === 'show_preview' ||
          (tc.name === 'run_in_terminal' && (tc.args.command || '').match(/npm run (?!dev)|npm start|npx next build|python|pip|bun|cargo|go run|dotnet run|uvicorn/))
        )) {
          buildAttempted = true;
        }

        if (result.error) {
          executionErrors.push(`${tc.name} ${tc.args.filePath || tc.args.path || ''}: ${result.error}`);
        }
      }

      barrenStreak++;

      // Build tool result feedback
      const resultSummary = toolCalls.map(tr => {
        const result = recentToolResults.find(r => r.name === tr.name);
        if (result) return `${tr.name} OK: ${result.summary}`;
        return `${tr.name} Done`;
      }).join('\n');

      let continueMsg = `[Tool Results for Step ${iter + 1}]\n${resultSummary}`;
      if (planTodos.length > 0) {
        const pending = planTodos.filter(t => !t.done);
        const doneCount = planTodos.length - pending.length;
        if (pending.length > 0) {
          continueMsg += `\n\nPROGRESS: ${doneCount}/${planTodos.length} tasks done. REMAINING:\n`;
          for (const t of pending) continueMsg += `  - [ ] ${t.text}\n`;
          continueMsg += '\nYou are NOT done. Use a TOOL CALL to complete the next remaining task.';
        } else {
          continueMsg += '\n\nAll tasks are now complete. Respond without using any tools.';
        }
      } else {
        continueMsg += '\n\nContinue. If the task is complete, respond normally WITHOUT using any tools.';
      }
      conversation.push({ role: 'user', content: continueMsg });

      // ── Token-aware compaction ──
      if (iter > 5 && iter - compactedAt >= 6) {
        const totalChars = conversation.reduce((sum, m) => sum + (m.content || '').length, 0);
        const estimatedTokens = Math.ceil(totalChars / 2.5);
        const contextWindow = getContextWindow(model, provider);
        const threshold = Math.floor(contextWindow * 0.75);
        if (estimatedTokens > threshold) {
          const compactSummary = buildCompactSummary(iter, fileManifest, planTodos, originalRequest, executionErrors);
          const systemMsg = conversation[0];
          const originalUserMsg = conversation.find(m => m.role === 'user' && !m.content.startsWith('[Tool Results') && !m.content.startsWith('[CONTEXT SUMMARY'));
          const recentMessages = conversation.slice(-6);
          conversation = [systemMsg, ...(originalUserMsg ? [originalUserMsg] : []), { role: 'user', content: compactSummary }, ...recentMessages];
          compactedAt = iter;
        }
      }

      // ── Persist progress ──
      job.iteration = iter + 1;
      job.planTodos = planTodos;
      job.planSummary = planSummary;
      job.conversation = conversation;
      job.fileManifest = fileManifest;
      saveJob(job);
    }

    // ── Post-loop summary ──
    if (!planCompleted) {
      const doneCount = planTodos.filter(t => t.done).length;
      const createdFiles = fileManifest.filter(f => f.action === 'created');
      const modifiedFiles = fileManifest.filter(f => f.action === 'modified');

      let buildStatusLine = '⚪ No build attempted';
      try {
        const base = `http://localhost:${process.env.PORT || 3000}`;
        const devRes = await fetch(`${base}/api/workspace/${workspaceId}/dev-server`, { method: 'GET' });
        const devData = devRes.ok ? await devRes.json() : null;
        if (devData?.running) {
          buildStatusLine = `🟢 Dev server running on port ${devData.port}`;
        } else if (buildAttempted) {
          buildStatusLine = `🟡 Build attempted but server not running`;
        }
      } catch {}

      let summary = '';
      if (planTodos.length > 0 && doneCount === planTodos.length) {
        summary = `✅ All ${planTodos.length} tasks complete.\n\n${buildStatusLine}`;
      } else if (createdFiles.length + modifiedFiles.length > 0) {
        summary = `✅ **Files affected**: ${[...createdFiles.map(f => `created \`${f.path}\``), ...modifiedFiles.map(f => `modified \`${f.path}\``)].join(', ')}\n\n${buildStatusLine}\n\nTask complete.`;
      } else {
        summary = `Task complete.\n\n${buildStatusLine}`;
      }

      const summaryId = `agent_summary_${Date.now()}`;
      await saveMessageToChat(chatId, 'assistant', summary, model, provider, summaryId, new Date().toISOString());
    }

    // ── Mark job completed ──
    job.status = 'completed';
    job.planTodos = planTodos;
    job.conversation = conversation;
    job.fileManifest = fileManifest;
    job.iteration = MAX_ITERATIONS; // signal completion
    saveJob(job);
    console.log(`[agent-runner] Job ${jobId} completed successfully`);

  } catch (err) {
    console.error(`[agent-runner] Job ${jobId} failed:`, err.message);
    job.status = 'failed';
    job.errorMessage = err.message;
    saveJob(job);
    try {
      await saveMessageToChat(chatId, 'assistant', `Error: ${err.message}`, model, provider, `agent_err_${Date.now()}`, new Date().toISOString());
    } catch {}
  }
}

// ── LLM Call (non-streaming for server-side) ─────────────────────────────────

async function llmCall(conversation, model, provider, thinkingEffort, apiKeys) {
  const headers = buildHeaders(apiKeys);
  const temp = thinkingEffort === 'high' ? 0.1 : thinkingEffort === 'low' ? 0.5 : 0.3;
  const extraParams = {};
  if (provider === 'deepseek' && thinkingEffort === 'high') {
    extraParams.reasoning_effort = thinkingEffort;
    extraParams.thinking_type = 'enabled';
  }

  const bodyObj = {
    model,
    messages: conversation,
    provider,
    stream: false,
    max_tokens: 4096,
    ...extraParams,
  };
  if (!(provider === 'deepseek' && thinkingEffort === 'high')) {
    bodyObj.temperature = temp;
    bodyObj.top_p = 1;
  }

  const base = `http://localhost:${process.env.PORT || 3000}`;
  const res = await fetch(`${base}/api/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj)
  });

  if (!res.ok) {
    let errorMsg = `API error: ${res.status}`;
    try { const errData = await res.json(); errorMsg = errData.error?.message || errorMsg; } catch {}
    throw new Error(errorMsg);
  }

  const data = await res.json();
  const choice = data.choices?.[0] || {};
  const content = choice.message?.content || '';
  const thinking = choice.message?.thinking || data.thinking || '';

  return { content, thinking };
}

// ── Build verification ──────────────────────────────────────────────────────

async function runBuildVerification(workspaceId, fileManifest, planTodos, conversation, retries) {
  retries++;
  if (retries >= 3) return { built: false, retries };

  let hasPackageJson = false;
  let allFiles = [];
  try {
    const base = `http://localhost:${process.env.PORT || 3000}`;
    const treeRes = await fetch(`${base}/api/workspace/${workspaceId}/tree?depth=3`);
    const treeData = treeRes.ok ? await treeRes.json() : null;
    allFiles = treeData?.tree ? flattenTree(treeData.tree) : [];
    hasPackageJson = allFiles.some(f => (f.name || f) === 'package.json');
  } catch {}

  if (!hasPackageJson) {
    // Static project — try starting dev server
    try {
      await executeToolCall({ name: 'dev_server_start', args: { command: 'npx serve .' } }, workspaceId);
    } catch {}
    return { built: true, retries };
  }

  // Run npm install
  let buildLog = '';
  try {
    const ir = await executeToolCall({ name: 'run_in_terminal', args: { command: 'npm install --legacy-peer-deps' } }, workspaceId);
    if (!ir.success) buildLog += `[npm install] FAILED:\n${ir.stderr || ir.stdout || 'Unknown'}\n`;
  } catch (err) { buildLog += `[npm install] Error: ${err.message}\n`; }

  if (!buildLog) {
    try {
      let buildCmd = 'npm run build';
      const fileNames = allFiles.map(f => f.name || f);
      if (fileNames.some(n => n === 'next.config.js' || n === 'next.config.mjs' || n === 'next.config.ts')) {
        buildCmd = 'npx next build';
      } else if (fileNames.some(n => n === 'vite.config.js' || n === 'vite.config.ts')) {
        buildCmd = 'npx vite build';
      }
      const br = await executeToolCall({ name: 'run_in_terminal', args: { command: buildCmd } }, workspaceId);
      if (!br.success) buildLog += `[${buildCmd}] FAILED:\n${(br.stderr || br.stdout || '').slice(0, 2000)}\n`;
    } catch (err) { buildLog += `[build] Error: ${err.message}\n`; }
  }

  if (buildLog) {
    conversation.push({
      role: 'user',
      content: `BUILD FAILED (attempt ${retries}/3). Fix these errors with tools, then respond without tool calls to retry:\n\n${buildLog}`
    });
    return { built: false, retries };
  }

  // Build passed — start dev server
  try {
    await executeToolCall({ name: 'dev_server_start', args: { command: '' } }, workspaceId);
    conversation.push({ role: 'user', content: `✅ Build passed. Dev server started. Summarize what was built and respond "Task complete."` });
  } catch (err) {
    conversation.push({ role: 'user', content: `✅ Build passed but server start failed. Try \`dev_server_start\`, then respond "Task complete."` });
  }
  return { built: true, retries };
}

// ── Start a new job ──────────────────────────────────────────────────────────

/**
 * Create and start a new agent job. Returns the job ID immediately.
 * The job runs asynchronously in the background.
 */
export function startAgentJob({ workspaceId, chatId, userContent, model, provider, thinkingEffort, agentMode, systemPrompt, apiKeys }) {
  runMigrations();
  const db = getDb();
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Cancel any existing running jobs for this workspace
  db.prepare("UPDATE agent_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE workspace_id = ? AND status IN ('running', 'interrupted')").run(workspaceId);

  const isPlanExecution = userContent.startsWith('Execute the following plan');
  const effectiveMode = isPlanExecution ? 'agent' : agentMode;

  // Build initial conversation
  let systemPromptFinal = systemPrompt || buildSystemPrompt(workspaceId, effectiveMode);
  const frameworkKeywords = /\b(next\.?js|nextjs|react|vue|angular|svelte|express|django|flask|fastapi|rails|laravel|static html|plain html|html only|vanilla js|python|go|rust|sveltekit|nuxt|remix|astro|gatsby|vite)\b/i;
  const frameworkHint = frameworkKeywords.test(userContent) ? '' : '\n\nTECH STACK: Build this as a Next.js 16 + TypeScript + Tailwind CSS v3 project. Create files in the app/ directory (App Router). Do NOT use plain HTML.';

  let effectiveUserContent = userContent;
  if (effectiveMode === 'agent') {
    effectiveUserContent = `USER REQUEST: ${userContent}${frameworkHint}\n\nIMPORTANT: You are in AGENT MODE. DO NOT describe what you'll do. DO NOT ask questions. DO NOT explain your plan. ACT NOW. Use a TOOL CALL immediately. The workspace may be empty — create ALL needed files yourself. If you need to see what exists, use list_dir first.`;
  }

  const conversation = [
    { role: 'system', content: systemPromptFinal },
    { role: 'user', content: effectiveUserContent }
  ];

  // Load existing plan todos if executing a plan
  let planTodos = [];
  let planSummary = '';
  if (isPlanExecution) {
    // Try to load from the last plan-mode job for this workspace
    const lastPlan = db.prepare(
      "SELECT * FROM agent_jobs WHERE workspace_id = ? AND agent_mode = 'plan' ORDER BY created_at DESC LIMIT 1"
    ).get(workspaceId);
    if (lastPlan) {
      try {
        planTodos = JSON.parse(lastPlan.plan_todos || '[]');
        planSummary = lastPlan.plan_summary || '';
      } catch {}
    }
  }

  db.prepare(`
    INSERT INTO agent_jobs (id, workspace_id, chat_id, status, model, provider, thinking_effort, agent_mode, user_request, plan_todos, plan_summary, iteration, conversation, file_manifest, api_keys)
    VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, 0, ?, '[]', ?)
  `).run(
    jobId, workspaceId, chatId,
    model, provider, thinkingEffort || 'high', effectiveMode, userContent,
    JSON.stringify(planTodos), planSummary,
    JSON.stringify(conversation),
    JSON.stringify(apiKeys || {})
  );

  // Run asynchronously — don't await
  runAgentJob(jobId).catch(err => {
    console.error(`[agent-runner] Unhandled error in job ${jobId}:`, err);
  });

  return jobId;
}

/**
 * Cancel all running/interrupted jobs for a workspace.
 */
export function cancelWorkspaceJobs(workspaceId) {
  runMigrations();
  const db = getDb();
  const info = db.prepare(
    "UPDATE agent_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE workspace_id = ? AND status IN ('running', 'interrupted')"
  ).run(workspaceId);
  return info.changes;
}

/**
 * Get the current status of an active job for a workspace.
 * Returns null if no active job exists.
 */
export function getJobStatus(workspaceId) {
  runMigrations();
  const db = getDb();
  const job = db.prepare(
    "SELECT * FROM agent_jobs WHERE workspace_id = ? AND status IN ('running', 'interrupted') ORDER BY created_at DESC LIMIT 1"
  ).get(workspaceId);

  if (!job) return null;

  return {
    jobId: job.id,
    status: job.status,
    workspaceId: job.workspace_id,
    chatId: job.chat_id,
    model: job.model,
    provider: job.provider,
    thinkingEffort: job.thinking_effort,
    agentMode: job.agent_mode,
    planTodos: JSON.parse(job.plan_todos || '[]'),
    planSummary: job.plan_summary || '',
    iteration: job.iteration,
    errorMessage: job.error_message || '',
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

/**
 * Resume an interrupted job (e.g. after server restart)
 */
export function resumeInterruptedJob(workspaceId) {
  runMigrations();
  const db = getDb();
  const job = db.prepare(
    "SELECT * FROM agent_jobs WHERE workspace_id = ? AND status = 'interrupted' ORDER BY created_at DESC LIMIT 1"
  ).get(workspaceId);

  if (!job) return null;

  console.log(`[agent-runner] Resuming interrupted job ${job.id} for workspace ${workspaceId}`);
  runAgentJob(job.id).catch(err => {
    console.error(`[agent-runner] Unhandled error resuming job ${job.id}:`, err);
  });

  return job.id;
}
