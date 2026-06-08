// @aurora/web - Server-side agent runner
// Runs the agentic loop independently of the browser UI.
// Persists all state to the agent_jobs table so jobs survive refreshes and server restarts.

import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { EventEmitter } from 'events';
import { initWorkspaceCheckpoints, createWorkspaceCheckpoint } from './checkpoint-utils.js';
import { getWorkspaceDir } from './workspace-utils.js';
import fs from 'fs';
import path from 'path';

// ── Agent Streaming Event Bus ────────────────────────────────────────────────
// In-memory pub/sub so the frontend can subscribe to real-time agent SSE events.
// Keyed by jobId → emits { type: 'thinking'|'content'|'done'|'error', text?, error? }
const _agentEvents = new EventEmitter();
_agentEvents.setMaxListeners(200);
export function getAgentEventBus() { return _agentEvents; }

// ── Concurrency guard ──
// Track which jobs are actively running in this process to prevent
// multiple concurrent runAgentJob() calls for the same job ID.
const _runningJobs = new Set();

// ── Abort registry ──
// Maps jobId → AbortController so in-flight LLM fetch calls can be aborted
// when the user clicks Stop. Used by cancelWorkspaceJobs.
const _abortControllers = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Lazy-init checkpoint git and create a tagged checkpoint for a user message.
 * Called before the agent processes a message so retry can revert to this point.
 */
async function createCheckpointForMessage(workspaceId, userMessageId) {
  try {
    const wsDir = getWorkspaceDir(workspaceId);
    if (!fs.existsSync(wsDir)) return;

    // Lazy-init checkpoint git if missing
    const ckDir = path.join(wsDir, '.aurora', 'checkpoints');
    if (!fs.existsSync(ckDir)) {
      const initResult = await initWorkspaceCheckpoints(wsDir);
      if (!initResult.success) {
        console.warn(`[agent-runner] Checkpoint init failed: ${initResult.error}`);
        return;
      }
    }

    // Create checkpoint tagged with the user message ID
    const result = await createWorkspaceCheckpoint(wsDir, userMessageId);
    if (result.success) {
      console.log(`[agent-runner] Checkpoint created for message ${userMessageId}: ${result.hash || '(no changes)'}`);
    } else if (result.error !== 'No changes to commit') {
      console.warn(`[agent-runner] Checkpoint creation skipped: ${result.error}`);
    }
  } catch (err) {
    console.warn('[agent-runner] Checkpoint creation error:', err.message);
    // Non-fatal — don't block the agent if checkpoint fails
  }
}

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

// ── Provider tool capabilities ───────────────────────────────────────────────
// 'native'  → provider supports OpenAI-compatible tools/tool_choice params
// 'custom'  → provider must use fenced-code-block / XML / bracket tool format

const PROVIDER_TOOL_MODE = {
  deepseek: 'native',
  openai: 'native',
  anthropic: 'native',
  lmstudio: 'custom',
  ollama: 'custom',
};

// Completion-detection patterns — model signaled it's done
const DONE_PHRASES = [
  /^task\s*complete/i,
  /^job\s*complete/i,
  /all\s*(requested\s*)?(files|tasks)\s*(are|have been)\s*(created|completed|done)/i,
  /^i('ve| have)\s*(completed|finished|done)/i,
  /\b(the\s+)?(task|job|project)\s+is\s+(complete|done|finished)/i,
  /^\s*✅/m,
  /\btask\s+complete[.!]?\s*$/im,
];

/**
 * Build OpenAI-format tools definitions array for native tool calling.
 * Each tool has a name, description, and JSON Schema parameters.
 */
function buildNativeTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List the contents of a directory. Returns file/directory names and types.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to the directory to list. Use "." for root.' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file. Returns the file content as text.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to the file to read.' }
          },
          required: ['filePath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'grep_search',
        description: 'Search for a text pattern in workspace files. Returns matching file paths and line content.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The text or regex pattern to search for.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Create a new file or overwrite an existing file with the given content.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path for the new file (e.g. src/index.ts).' },
            content: { type: 'string', description: 'The full content to write to the file.' }
          },
          required: ['filePath', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_string_in_file',
        description: 'Replace an exact string in an existing file with a new string.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path to the file to edit.' },
            oldString: { type: 'string', description: 'The exact text to find and replace.' },
            newString: { type: 'string', description: 'The new text to replace oldString with.' }
          },
          required: ['filePath', 'oldString', 'newString']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_in_terminal',
        description: 'Execute a shell command in the workspace. Use for npm install, git, build commands, etc.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute (e.g. "npm install", "npm run build").' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'dev_server_status',
        description: 'Check whether the development server is running and on which port.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'dev_server_start',
        description: 'Start the development server for the project.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Optional command to start the server (e.g. "npm run dev").' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'dev_server_stop',
        description: 'Stop the running development server.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'show_preview',
        description: 'Open a preview panel showing the running app (if server is running).',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }
  ];
}

/**
 * Get the tool mode for a given provider. Falls back to 'custom' if unknown.
 */
function getToolMode(provider) {
  const p = (provider || '').toLowerCase();
  return PROVIDER_TOOL_MODE[p] || 'custom';
}

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

  // Qwen/LM Studio <tool_call> wrapper: <tool_call>inner</tool_call> or <tool_call>inner (truncated)
  // Strip the wrapper and parse the inner content with existing parsers
  const tcRegex = /<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|$)/gi;
  let tcMatch;
  while ((tcMatch = tcRegex.exec(content)) !== null) {
    const inner = tcMatch[1].trim();
    if (inner) {
      // Recursively parse inner content to find actual tool calls
      const nested = parseToolCalls(inner);
      calls.push(...nested);
    }
  }
  // If we found tool calls via <tool_call> wrapper, return them
  if (calls.length > 0) return calls;

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

  // <invoke name="toolName">...</invoke> syntax (used by Qwen/LM Studio models)
  const invokeRegex = /<invoke\s+name="(\w+)"[^>]*>([\s\S]*?)<\/invoke>/gi;
  let invMatch;
  while ((invMatch = invokeRegex.exec(content)) !== null) {
    const toolName = invMatch[1].toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
    const innerContent = invMatch[2];
    const args = {};
    const paramRegex = /<parameter\s+name="(\w+)"[^>]*>([\s\S]*?)<\/parameter>/gi;
    let pMatch;
    while ((pMatch = paramRegex.exec(innerContent)) !== null) {
      const pName = pMatch[1];
      const pValue = pMatch[2].trim();
      if (pName === 'filePath' || pName === 'filepath' || pName === 'file_path') args.filePath = pValue;
      else if (pName === 'path') args.path = pValue;
      else if (pName === 'query') args.query = pValue;
      else if (pName === 'command') args.command = pValue;
      else if (pName === 'oldString' || pName === 'old_string') args.oldString = pValue;
      else if (pName === 'newString' || pName === 'new_string') args.newString = pValue;
      else if (pName === 'name') args.name = pValue;
      else if (pName === 'description') args.description = pValue;
      else if (pName === 'content') args.content = pValue;
      else args[pName] = pValue;
    }
    if (args.filePath === undefined && args.path !== undefined) args.filePath = args.path;
    const fp = args.filePath || args.path;
    if ((toolName === 'create_file' || toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) continue;
    if (toolName === 'create_file' && args.content === undefined) continue;
    if (toolName === 'replace_string_in_file' && (!args.oldString || args.newString === undefined)) continue;
    calls.push({ name: toolName, args, raw: invMatch[0] });
  }

  // Bracket syntax: [toolName arg="val"] ... [/toolName]
  // Handles models (like Qwen) that use bracket notation instead of XML
  // Inline: [list_dir path="."]
  // Block:  [create_file filePath="x.txt"]\nbody\n[/create_file]
  const bracketRegex = /\[(\w+)\s+((?:\w+=(?:"[^"]*"|'[^']*')\s*)*)\]([\s\S]*?)\[\/\1\]/gi;
  let bMatch;
  while ((bMatch = bracketRegex.exec(content)) !== null) {
    const toolName = bMatch[1].toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
    const args = parseAttrs(bMatch[2]);
    const body = bMatch[3].trim();
    if (CONTENT_TOOLS.includes(toolName)) {
      if (toolName === 'replace_string_in_file') {
        const findIdx = body.indexOf('===FIND===');
        const replaceIdx = body.indexOf('===REPLACE===');
        if (findIdx >= 0 && replaceIdx >= 0) {
          args.oldString = body.slice(findIdx + 10, replaceIdx).trim();
          args.newString = body.slice(replaceIdx + 13).trim();
        }
      } else if (body && args.content === undefined) {
        args.content = body;
      }
    }
    const fp = args.filePath || args.path;
    if ((toolName === 'create_file' || toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) continue;
    if (toolName === 'create_file' && args.content === undefined) continue;
    if (toolName === 'replace_string_in_file' && (!args.oldString || args.newString === undefined)) continue;
    calls.push({ name: toolName, args, raw: bMatch[0] });
  }

  // Inline bracket: [toolName arg="val"]  (no closing [/toolName])
  const inlineBracketRegex = /\[(\w+)\s+((?:\w+=(?:"[^"]*"|'[^']*')\s*)*)\]/gi;
  let ibMatch;
  while ((ibMatch = inlineBracketRegex.exec(content)) !== null) {
    const toolName = ibMatch[1].toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
    if (CONTENT_TOOLS.includes(toolName)) continue; // Content tools need a body block
    const args = parseAttrs(ibMatch[2]);
    const fp = args.filePath || args.path;
    if ((toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) continue;
    calls.push({ name: toolName, args, raw: ibMatch[0] });
  }

  // Bare tool calls: toolName arg="val"\nbody
  // Handles models that output tool calls without any fenced code block,
  // XML, or bracket delimiters — just plain "create_file filePath=\"x.txt\"\\ncontent"
  const bareRegex = /^(\w+)\s+((?:\w+=(?:"[^"]*"|'[^']*')\s*)+)([\s\S]*?)(?=\n\w+\s+\w+=|$)/gm;
  let bareMatch;
  while ((bareMatch = bareRegex.exec(content)) !== null) {
    const toolName = bareMatch[1].toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
    const args = parseAttrs(bareMatch[2]);
    const body = (bareMatch[3] || '').trim();
    if (CONTENT_TOOLS.includes(toolName)) {
      if (toolName === 'replace_string_in_file') {
        const findIdx = body.indexOf('===FIND===');
        const replaceIdx = body.indexOf('===REPLACE===');
        if (findIdx >= 0 && replaceIdx >= 0) {
          args.oldString = body.slice(findIdx + 10, replaceIdx).trim();
          args.newString = body.slice(replaceIdx + 13).trim();
        }
      } else if (body && args.content === undefined) {
        args.content = body;
      }
    }
    const fp = args.filePath || args.path;
    if ((toolName === 'create_file' || toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) continue;
    if (toolName === 'create_file' && args.content === undefined) continue;
    if (toolName === 'replace_string_in_file' && (!args.oldString || args.newString === undefined)) continue;
    calls.push({ name: toolName, args, raw: bareMatch[0] });
  }

  // Fenced-code-block: ```toolName arg="value"\nbody\n```
  // Handles both closed (with ```) and unclosed (model forgot to close) blocks
  const regex = /```\s*(\w+)\b\s*(.*?)(?:```|$)/gs;
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

  // ── Fallback: non-tool fenced code blocks → create_file ──────────────────
  // Models sometimes output ```json / ```typescript blocks instead of
  // wrapping them in proper tool call syntax. Convert these to create_file
  // calls by extracting the file path from the preceding text or inferring
  // it from the content structure.
  if (calls.length === 0 && content.includes('```')) {
    const genericBlockRegex = /```(\w+)\s*\n([\s\S]*?)```/g;
    let gbMatch;
    const FILE_LANGS = new Set([
      'json', 'typescript', 'ts', 'tsx', 'js', 'jsx',
      'css', 'scss', 'less', 'html', 'yaml', 'yml', 'toml',
      'md', 'markdown', 'py', 'sql', 'graphql', 'gql'
    ]);
    // IMPORTANT: extension alternation must list longer prefixes FIRST
    // (json before js, tsx before ts) so "package.json" doesn't match as "package.js"
    const FILE_EXT_ALT = '(?:json|jsx|js|tsx|ts|css|scss|less|html|yaml|yml|toml|md|markdown|py|sql|graphql|gql)';
    let lastBlockEnd = 0;
    while ((gbMatch = genericBlockRegex.exec(content)) !== null) {
      const lang = gbMatch[1].toLowerCase();
      const body = gbMatch[2].trim();
      if (!body) continue;
      if (KNOWN_TOOL_NAMES.has(lang)) { lastBlockEnd = gbMatch.index + gbMatch[0].length; continue; }
      if (!FILE_LANGS.has(lang)) { lastBlockEnd = gbMatch.index + gbMatch[0].length; continue; }

      // Try to extract file path from text *since the last block* (not the entire document)
      const beforeText = content.slice(lastBlockEnd, gbMatch.index);
      let filePath = null;

      const pathPatterns = [
        // Backtick-quoted paths: Create `file.tsx`, file: `path/to/file.ts`
        new RegExp(`(?:Create|create|Write|write|file|File|path|Path)\\s*[\`:]\s*\`([^\`]+)\``, 'g'),
        new RegExp(`(?:Create|create|Write|write)\\s+\`([^\`]+)\``, 'g'),
        new RegExp(`\`([^\`]+\\.${FILE_EXT_ALT})\``, 'g'),
        // Quoted/colon paths: file: "foo.tsx", path='bar.css'
        new RegExp(`(?:file|File|path|Path)\\s*[=:]\\s*["']([^"']+)["']`, 'g'),
        // Bare paths in natural language: "Create package.json with ...",
        // "Write src/app/page.tsx", "Task: create styles.css"
        new RegExp(`(?:Create|create|Write|write|file|File|path|Path)\\s+([^\\s\`"']+\\.${FILE_EXT_ALT})`, 'gi'),
        // Any bare filename with recognized extension near the block
        new RegExp(`([^\\s\`"']+\\.${FILE_EXT_ALT})`, 'gi'),
      ];

      for (const pattern of pathPatterns) {
        const matches = [...beforeText.matchAll(pattern)];
        if (matches.length > 0) {
          filePath = matches[matches.length - 1][1]; // Closest to block
          break;
        }
      }

      // If no path found, try to infer from content
      if (!filePath) {
        if (lang === 'json') {
          try {
            const parsed = JSON.parse(body);
            if (parsed.name && (parsed.scripts || parsed.dependencies || parsed.devDependencies)) {
              filePath = 'package.json';
            } else if (parsed.compilerOptions !== undefined) {
              filePath = 'tsconfig.json';
            }
          } catch { /* invalid JSON, skip */ }
        } else if (lang === 'typescript' || lang === 'ts') {
          const exportMatch = body.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
          if (exportMatch) filePath = `src/${exportMatch[1]}.ts`;
        } else if (lang === 'tsx' || lang === 'jsx') {
          const exportMatch = body.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
          if (exportMatch) filePath = `src/${exportMatch[1]}.tsx`;
        }
      }

      if (filePath) {
        calls.push({
          name: 'create_file',
          args: { filePath, content: body },
          raw: gbMatch[0],
        });
      }
      lastBlockEnd = gbMatch.index + gbMatch[0].length;
    }
  }

  return calls;
}

/**
 * Strip tool call syntax from content text so it doesn't appear in the UI.
 * Uses parseToolCalls to find all matched patterns and removes them by their
 * raw matched text. This keeps the conversation history parseable (it still
 * holds the raw content) while cleaning what gets saved to the DB for display.
 */
function stripToolCallsFromContent(content) {
  if (!content) return content;
  const calls = parseToolCalls(content);
  if (calls.length === 0) return content;
  let cleaned = content;
  // Remove from end to start so index positions stay valid
  const removals = calls
    .map(c => ({ raw: c.raw, index: content.indexOf(c.raw) }))
    .filter(r => r.raw && r.index >= 0)
    .sort((a, b) => b.index - a.index);
  // Deduplicate: if two removals share the same index, only keep one
  const seen = new Set();
  for (const r of removals) {
    const key = `${r.index}:${r.raw.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned = cleaned.slice(0, r.index) + cleaned.slice(r.index + r.raw.length);
  }
  // Collapse blank lines left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

// ── Tool execution (server-side, via fetch to local API routes) ──────────────

const TOOL_TIMEOUT = 30000;

async function executeToolCall(tc, wsId, userId) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Tool ${tc.name} timed out after ${TOOL_TIMEOUT / 1000}s`)), TOOL_TIMEOUT)
  );
  // Build internal auth header so workspace API calls pass getUserId()
  const internalHeaders = userId ? { 'x-internal-user-id': userId } : {};
  try {
    const result = await Promise.race([(async () => {
      const base = `http://localhost:${process.env.PORT || 3000}`;
      switch (tc.name) {
        case 'read_file': {
          const res = await fetch(`${base}/api/workspace/${wsId}/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { content: data.content, size: data.size };
        }
        case 'create_file': {
          const contentStr = tc.args.content;
          if (contentStr === undefined || contentStr === null || (typeof contentStr === 'string' && contentStr.trim() === '')) {
            return { error: `Content is empty or missing. You MUST provide the full file content in the 'content' argument of create_file.` };
          }
          const res = await fetch(`${base}/api/workspace/${wsId}/write`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path, content: contentStr })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { success: true, created: data.created, linesAdded: data.linesAdded || (typeof contentStr === 'string' ? contentStr.split('\n').length : 0), totalLines: data.totalLines };
        }
        case 'replace_string_in_file': {
          // Read, replace, write
          const readRes = await fetch(`${base}/api/workspace/${wsId}/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path })
          });
          const readData = await readRes.json();
          if (readData.error) return { error: readData.error.message };
          const oldContent = readData.content;
          if (!oldContent.includes(tc.args.oldString)) {
            return { error: `Could not find oldString in file. File may have been modified.` };
          }
          const oldLines = oldContent.split('\n').length;
          const newContent = oldContent.replace(tc.args.oldString, tc.args.newString);
          const writeRes = await fetch(`${base}/api/workspace/${wsId}/write`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders },
            body: JSON.stringify({ path: tc.args.filePath || tc.args.path, content: newContent })
          });
          const writeData = await writeRes.json();
          if (writeData.error) return { error: writeData.error.message };
          // Store full line counts for diff display
          const oldEditLines = tc.args.oldString.split('\n').length;
          const newEditLines = tc.args.newString.split('\n').length;
          return { success: true, linesAdded: Math.max(0, newEditLines - oldEditLines), linesRemoved: Math.max(0, oldEditLines - newEditLines), newLines: newEditLines, oldLines: oldEditLines, totalLines: newContent.split('\n').length };
        }
        case 'grep_search': {
          const res = await fetch(`${base}/api/workspace/${wsId}/search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders },
            body: JSON.stringify({ query: tc.args.query })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { results: data.results || [], total: data.total };
        }
        case 'list_dir': {
          const pathParam = tc.args.path || '.';
          const res = await fetch(`${base}/api/workspace/${wsId}/tree?depth=2`, { headers: internalHeaders });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          const flat = flattenTree(data.tree);
          if (pathParam === '.' || pathParam === '/') return { files: flat };
          const prefix = pathParam.replace(/\/$/, '') + '/';
          return { files: flat.filter(f => (f.path || '').startsWith(prefix)) };
        }
        case 'run_in_terminal': {
          const res = await fetch(`${base}/api/workspace/${wsId}/exec`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders },
            body: JSON.stringify({ command: tc.args.command })
          });
          const data = await res.json();
          if (data.error) return { error: data.error.message };
          return { success: data.success, stdout: data.stdout, stderr: data.stderr, exitCode: data.exitCode };
        }
        case 'dev_server_status': {
          const res = await fetch(`${base}/api/workspace/${wsId}/dev-server`, { method: 'GET', headers: internalHeaders });
          const data = await res.json();
          return { running: data.running || false, port: data.port, url: data.url, logs: data.logs };
        }
        case 'dev_server_start': {
          const res = await fetch(`${base}/api/workspace/${wsId}/dev-server`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders },
            body: JSON.stringify({ command: tc.args.command || 'npm run dev' })
          });
          const data = await res.json();
          return { running: data.running || false, port: data.port, url: data.url, command: data.command, logs: data.logs };
        }
        case 'dev_server_stop': {
          const res = await fetch(`${base}/api/workspace/${wsId}/dev-server`, { method: 'DELETE', headers: internalHeaders });
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
  if (result.alreadyExists) return `ALREADY EXISTS: \`${fp}\` was already ${result.existingAction || 'created'}. SKIP — move to NEXT task.`;
  switch (name) {
    case 'read_file': return `Read \`${fp}\` (${result.size || result.content?.length || 0} bytes): ${(result.content || '').slice(0, 500)}${(result.content || '').length > 500 ? '...' : ''}`;
    case 'create_file': {
      const n = result.linesAdded || result.totalLines || 0;
      const plus = n > 0 ? `+${n}` : '';
      return result.error ? `FAILED to create \`${fp}\`: ${result.error}` : `Created \`${fp}\`${plus ? ` (${plus} lines)` : ''} successfully`;
    }
    case 'replace_string_in_file': {
      const added = result.newLines ?? (args.newString ? args.newString.split('\n').length : 0);
      const removed = result.oldLines ?? (args.oldString ? args.oldString.split('\n').length : 0);
      return result.error ? `FAILED to patch \`${fp}\`: ${result.error}` : `Patched \`${fp}\` +${added}-${removed} successfully`;
    }
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
    agentMode: job.agent_mode,
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
    job.agentMode || job.agent_mode || 'agent', job.userRequest || '', JSON.stringify(job.planTodos || []), job.planSummary || '',
    job.iteration || 0, JSON.stringify(job.conversation || []), JSON.stringify(job.fileManifest || []),
    JSON.stringify(job.api_keys || {}),
    job.errorMessage || '', job.id
  );
}

async function saveMessageToChat(chatId, role, content, model, provider, msgId, timestamp, thinking = '') {
  try {
    runMigrations();
    const db = getDb();
    const messageId = msgId || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const ts = timestamp || new Date().toISOString();

    // Check if message already exists (upsert — for incremental streaming updates)
    const existing = db.prepare('SELECT id, position FROM messages WHERE id = ?').get(messageId);
    if (existing) {
      // Update existing message content/thinking (streaming incremental save)
      db.prepare(`
        UPDATE messages SET content = ?, thinking = ?, model = ?, provider = ?, timestamp = ? WHERE id = ?
      `).run(content, thinking || '', model || '', provider || '', ts, messageId);
      return;
    }

    // Ensure the chat row exists (defensive — frontend may not have created it yet)
    const chatExists = db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId);
    if (!chatExists) {
      // Auto-create the chat row so FK constraint passes
      db.prepare(`
        INSERT OR IGNORE INTO chats (id, user_id, title, created_at, last_message_at, message_count)
        VALUES (?, 'auto', ?, ?, ?, 1)
      `).run(chatId, 'Auto-created chat', ts, ts);
    }

    // Get next position for new message
    const lastMsg = db.prepare('SELECT MAX(position) as maxPos FROM messages WHERE chat_id = ?').get(chatId);
    const position = (lastMsg?.maxPos ?? -1) + 1;

    db.prepare(`
      INSERT INTO messages (id, chat_id, role, content, thinking, model, provider, timestamp, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, chatId, role, content, thinking || '', model || '', provider || '', ts, position);

    // Update chat metadata
    db.prepare(`
      UPDATE chats SET last_message_at = ?, message_count = message_count + 1 WHERE id = ?
    `).run(ts, chatId);
  } catch (err) {
    console.error('[agent-runner] Failed to save message:', err.message);
  }
}

// ── System prompt builder (same logic as AgentPanel) ─────────────────────────

function buildSystemPrompt(wsId, mode = 'agent', provider = '') {
  if (mode === 'agent') {
    const toolMode = getToolMode(provider);
    const isNative = toolMode === 'native';

    let base = 'You are in AGENT MODE — you autonomously create and modify files. '
      + 'The user can switch to Chat mode for discussion or Plan mode to generate a structured task list before execution.\n'
      + 'If the user message contains "CONVERSATION HISTORY", that is the prior discussion from Chat/Plan modes — use it for context.\n\n'
      + 'Workspace API: /api/workspace/' + wsId + '. Use RELATIVE paths: "." is root.\n\n';

    if (isNative) {
      base += 'TOOLS: You have native function calling tools. Call them directly using the function calling mechanism built into this chat. '
        + 'Do NOT use fenced code blocks — the system handles tool execution automatically when you invoke functions.\n'
        + 'Available tools: list_dir, read_file, grep_search, create_file, replace_string_in_file, run_in_terminal, dev_server_status, dev_server_start, dev_server_stop, show_preview.\n\n';
    } else {
      base += 'TOOL FORMAT — wrap EVERY tool call in a fenced code block with the tool name:\n\n'
        + '```list_dir path="."\n```\n'
        + '```read_file filePath="path/file.ext"\n```\n'
        + '```grep_search query="pattern"\n```\n'
        + '```create_file filePath="path/file.ext"\n[YOUR CONTENT HERE]\n```\n'
        + '```replace_string_in_file filePath="path/file.ext"\n===FIND===\n[OLD TEXT]\n===REPLACE===\n[NEW TEXT]\n```\n'
        + '```dev_server_status\n```\n'
        + '```dev_server_start command="npm run dev"\n```\n'
        + '```dev_server_stop\n```\n'
        + '```show_preview\n```\n'
        + '- create_file: put file content as the body of the code block. Replace [YOUR CONTENT HERE] with the actual content.\n'
        + '- Nothing outside the fenced code block except a brief reasoning line.\n\n';
    }

    base += 'RULES:\n'
      + '- First step: list_dir path="." to see what exists.\n'
      + '- You can call MULTIPLE tools in a SINGLE response. Batch related operations together for efficiency.\n'
      + '- Create ALL files the user requested. Do not stop until every requested file exists.\n'
      + '- You may freely explore the workspace — read files, list directories, search — as much as you need.\n'
      + '- When you are completely done with ALL tasks, respond with "Task complete" and NO tool calls.\n';

    return base;
  }

  // Plan mode
  return `You are a helpful AI assistant in PLAN MODE working with a developer in their workspace. The workspace is at /api/workspace/${wsId}.

You are in PLAN MODE — your goal is to explore the workspace and produce a structured implementation plan. You must NEVER write or modify files. You CAN use exploration tools (list_dir, read_file, grep_search) to understand the codebase.

**Other available modes:**
- **Chat mode** — for free discussion, questions, and brainstorming without producing plans. The user may have discussed their project there first.
- **Agent mode** — for autonomous file creation and editing once a plan is ready.

**⚠️ CRITICAL: If the user message contains "CONVERSATION HISTORY (from Chat mode)", that means the user already discussed this project in Chat mode. Review that history carefully — it contains the user's preferences, tech choices, and feature requirements. Use it to build your plan. Do NOT re-ask questions that were already answered in the history.**

## WORKFLOW
1. **Read the conversation history** if present — extract the user's requirements and preferences.
2. **Discuss & clarify** the user's request ONLY if critical information is missing. If the conversation history already has the answers, proceed.
3. **Explore the workspace** using tools to understand what already exists.
4. **Produce a concrete plan** in the format below.

## EXPLORATION TOOL FORMAT
Use fenced code blocks:
\`\`\`list_dir path="."
\`\`\`
\`\`\`read_file filePath="src/index.ts"
\`\`\`
\`\`\`grep_search query="pattern"
\`\`\`

- Print ONLY ONE tool per response.
- After getting results, briefly state what you found, then either explore more OR output the plan.

## PLAN OUTPUT FORMAT

### Summary
One sentence: what the user asked for + the tech stack you'll use.

### Tasks
- [ ] Create \`path/to/file1.ext\`: what this file does — *depends on: Task 1*
- [ ] Create \`path/to/file2.ext\`: what this file does
- [ ] Modify \`path/to/existing.ext\`: what change and why

## RULES
- **Every task MUST mention at least one concrete file path.** No vague tasks.
- **For web app projects (Next.js, React, etc.), the plan MUST include app source files (e.g., app/layout.tsx, app/page.tsx, app/globals.css) — NOT just config files like package.json or tsconfig.json. Without these the app will not build.**
- **6-12 tasks maximum.** Keep it focused.
- **No phases** — just a flat ordered task list.
- **Only use read_file, list_dir, grep_search.**
- **After outputting the plan, STOP.** The system will surface it to the user with an "Execute Plan" button.`;
}

// ── Main agent loop ──────────────────────────────────────────────────────────

/**
 * Run the agentic loop for a job. This function runs asynchronously and
 * persists progress to the DB after every iteration.
 *
 * @param {string} jobId - The job ID from agent_jobs table
 */
export async function runAgentJob(jobId, userMessageId) {
  // ── Concurrency guard: prevent multiple concurrent runs of the same job ──
  if (_runningJobs.has(jobId)) {
    console.log(`[agent-runner] Job ${jobId} is already running in this process, skipping duplicate call`);
    return;
  }

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

  _runningJobs.add(jobId);
  try {
    return await _runAgentJobImpl(jobId, job, userMessageId);
  } finally {
    _runningJobs.delete(jobId);
  }
}

async function _runAgentJobImpl(jobId, job, userMessageId) {
  console.log(`[agent-runner] Starting job ${jobId} for workspace ${job.workspace_id} (mode: ${job.agent_mode || 'agent'})`);
  job.status = 'running';
  saveJob(job);

  const MAX_ITERATIONS = 100;
  const workspaceId = job.workspace_id;
  const chatId = job.chat_id;
  const userId = job.user_id || '';
  const model = job.model || 'gpt-4o';
  const provider = job.provider || 'openai';
  const thinkingEffort = job.thinkingEffort || job.thinking_effort || 'high';
  const agentMode = job.agentMode || job.agent_mode || 'agent';
  const originalRequest = job.userRequest || job.user_request || '';

  // State
  let conversation = job.conversation || [];
  let planTodos = job.planTodos || job.plan_todos || [];
  let planSummary = job.planSummary || job.plan_summary || '';
  let planCompleted = false;
  const executionErrors = [];

  try {
    let startIter = job.iteration || 0;

    if (conversation.length > 0) {
      console.log(`[agent-runner] Resuming job ${jobId} at iteration ${startIter}`);
    }

    for (let iter = startIter; iter < MAX_ITERATIONS; iter++) {
      // ── Check for cancellation before each iteration ──
      const liveJob = loadJob(jobId);
      if (!liveJob || liveJob.status === 'cancelled') {
        console.log(`[agent-runner] Job ${jobId} cancelled at iteration ${iter}`);
        job.status = 'cancelled';
        saveJob(job);
        // Clean up abort controller
        const ac = _abortControllers.get(jobId);
        if (ac) { _abortControllers.delete(jobId); }
        return;
      }

      // ── Create AbortController for this LLM call ──
      const ac = new AbortController();
      _abortControllers.set(jobId, ac);

      // ── LLM Call ──
      const apiKeys = job.api_keys || {};
      const assistantId = `agent_${Date.now()}_${iter}`;
      let rawContent, thinking, nativeToolCalls;
      try {
        const result = await llmCall(conversation, model, provider, thinkingEffort, apiKeys, chatId, assistantId, jobId, ac.signal);
        rawContent = result.content;
        // Strip [x] / [X] checklist prefixes the model echoes from tool feedback
        if (rawContent) {
          rawContent = rawContent.replace(/^\[x\]\s*/gmi, '');
        }
        thinking = result.thinking;
        nativeToolCalls = result.nativeToolCalls;
      } catch (err) {
        if (err.name === 'AbortError') {
          console.log(`[agent-runner] Job ${jobId} LLM call aborted at iteration ${iter}`);
          job.status = 'cancelled';
          saveJob(job);
          _abortControllers.delete(jobId);
          // Emit stop event so the SSE stream closes
          _agentEvents.emit(`job:${jobId}`, { type: 'stop' });
          return;
        }
        throw err;
      }
      _abortControllers.delete(jobId);

      conversation.push({ role: 'assistant', content: rawContent, native_tool_calls: nativeToolCalls });

      // Signal iteration end so SSE frontend knows this LLM call is complete
      _agentEvents.emit(`job:${jobId}`, { type: 'iteration_end' });

      // ── Parse tool calls ──
      let toolCalls = [];
      if (nativeToolCalls && nativeToolCalls.length > 0) {
        toolCalls = nativeToolCalls.map(ntc => ({ name: ntc.name, args: ntc.args }));
        console.log(`[agent-runner] Using ${toolCalls.length} native tool_calls: ${toolCalls.map(tc => tc.name).join(', ')}`);
      } else {
        toolCalls = parseToolCalls(rawContent);
        if (toolCalls.length > 0) {
          console.log(`[agent-runner] Parsed ${toolCalls.length} custom-format tool calls from content`);
        }
      }

      if (toolCalls.length === 0) {
        // ── Plan mode: parse plan from response ──
        if (agentMode === 'plan') {
          const { todos, summary } = parsePlanTodos(rawContent);
          if (todos.length > 0) {
            planTodos = todos;
            planSummary = summary;
            planCompleted = true;
            try {
              const planLines = [`# Implementation Plan`, ``, `> **Request:** ${originalRequest.slice(0, 200)}`, ``, `## Tasks`, ``];
              for (const t of todos) planLines.push(`- [${t.done ? 'x' : ' '}] ${t.text}`);
              const planMd = planLines.join('\n');
              await executeToolCall({ name: 'create_file', args: { filePath: 'PLAN.md', content: planMd } }, workspaceId, userId);
            } catch (err) {
              console.warn('[agent-runner] Failed to write PLAN.md:', err.message);
            }
            break;
          }
        }

        // ── Clarification pause: detect questions before any files are created ──
        // Check both parsed text tool calls AND native tool calls from provider
        const hasCreatedFiles = conversation.some(m => {
          if (m.role !== 'assistant') return false;
          const calls = parseToolCalls(m.content || '');
          const nativeCalls = m.native_tool_calls || [];
          const allCalls = [...calls, ...nativeCalls.map(ntc => ({ name: ntc.name }))];
          return allCalls.some(tc => tc.name === 'create_file' || tc.name === 'replace_string_in_file');
        });

        // Also check the current iteration's native tool calls
        const hasCreatedThisIter = toolCalls.some(tc => tc.name === 'create_file' || tc.name === 'replace_string_in_file');

        if (agentMode === 'agent' && !planCompleted && !hasCreatedFiles && !hasCreatedThisIter) {
          const questionPatterns = [
            /\?/,
            /^(before i|i need to|let me|first|should i|do you want|would you like)/i,
            /^(which|what|how|where|who|when|can you|could you|please clarify)/i,
            /(not sure|don't know|unclear|ambiguous|need more|more info|context)/i,
            /^(do you|are you|is this|is that)/i,
          ];
          const isQuestion = questionPatterns.some(p => p.test(rawContent.trim()));
          if (isQuestion) {
            console.log(`[agent-runner] Job ${jobId}: Detected clarifying question, pausing.`);
            job.status = 'awaiting_input';
            job.pendingQuestion = rawContent.trim().slice(0, 1000);
            job.planTodos = planTodos;
            job.conversation = conversation;
            job.iteration = iter;
            job.fileManifest = [];
            saveJob(job);
            return;
          }
        }

        // ── Completion detection: model says it's done ──
        const isDone = DONE_PHRASES.some(p => p.test(rawContent.trim()));

        // ── Auto-complete: files were created but model didn't say a done phrase ──
        // After creating/modifying files, models often respond with text like
        // "I've created hello.txt" which matches NO done phrase, causing an
        // infinite nudge loop. If we've already done real work and the model
        // has no more tool calls, assume completion.
        const didFileWork = hasCreatedFiles || hasCreatedThisIter;
        const isStuck = !isDone && didFileWork && !planCompleted;

        if (isDone) {
          console.log(`[agent-runner] Job ${jobId}: Model signaled completion at iteration ${iter}`);
          break;
        }

        if (isStuck) {
          console.log(`[agent-runner] Job ${jobId}: Files created, no more tool calls — auto-completing`);
          break;
        }

        // ── Detect repeated-tool loops (model calls same tool 3+ times without making file progress) ──
        const recentToolNames = [];
        for (let i = conversation.length - 1; i >= 0; i--) {
          const m = conversation[i];
          if (m.role !== 'assistant') continue;
          const calls = parseToolCalls(m.content || '');
          const nativeCalls = m.native_tool_calls || [];
          for (const c of [...calls, ...nativeCalls.map(ntc => ({ name: ntc.name }))]) {
            recentToolNames.push(c.name);
          }
          if (recentToolNames.length >= 4) break;
        }
        // Check if last 4 tool calls are all the same name
        const repeatedTool = recentToolNames.length >= 3 &&
          recentToolNames.slice(0, 3).every(t => t === recentToolNames[0]) &&
          recentToolNames[0] !== 'create_file' &&
          recentToolNames[0] !== 'replace_string_in_file';

        if (repeatedTool) {
          const tool = recentToolNames[0];
          console.log(`[agent-runner] Job ${jobId}: Repeated ${tool} loop detected, forceful nudge`);
          conversation.push({
            role: 'user',
            content: tool === 'list_dir'
              ? `You've seen the workspace. STOP listing directories. Now CREATE the file the user requested: "${originalRequest}". Use create_file immediately. DO NOT list directories again.`
              : `You've been using "${tool}" repeatedly. Make progress: create or edit files now. Stop using "${tool}".`
          });
          continue;
        }

        // ── Gentle nudge: model stopped without acting ──
        conversation.push({
          role: 'user',
          content: 'Continue. What is the next step?'
        });
        continue;
      }

      // ── Execute tools (no manifest skip — model writes freely) ──
      const toolResults = [];

      // ── Detect repeated-tool loops BEFORE executing (model keeps returning same tool) ──
      const allToolNames = toolCalls.map(tc => tc.name);
      const allSame = allToolNames.length > 0 && allToolNames.every(t => t === allToolNames[0]);
      const allSamePaths = allSame && toolCalls.every(tc =>
        (tc.args.filePath || tc.args.path || '') === (toolCalls[0].args.filePath || toolCalls[0].args.path || ''));
      if (allSame && (allToolNames[0] === 'list_dir' || allToolNames[0] === 'read_file')) {
        const repeatCount = (job._sameToolCount || 0) + 1;
        job._sameToolCount = repeatCount;
        if (repeatCount >= 3) {
          console.log(`[agent-runner] Job ${jobId}: Repeated ${allToolNames[0]} loop (${repeatCount}x), forceful nudge`);
          job._sameToolCount = 0;
          conversation.push({
            role: 'user',
            content: allToolNames[0] === 'list_dir'
              ? `You've been listing directories for ${repeatCount} iterations. STOP. The workspace is EMPTY. Just CREATE the file: "${originalRequest}". Use create_file NOW. DO NOT list anything.`
              : `You've been reading files for ${repeatCount} iterations. STOP reading. Make changes NOW. Create or edit files: "${originalRequest}".`
          });
          continue;
        }
      } else if (allSamePaths && (allToolNames[0] === 'create_file' || allToolNames[0] === 'replace_string_in_file')) {
        const repeatCount = (job._sameToolCount || 0) + 1;
        job._sameToolCount = repeatCount;
        if (repeatCount >= 3) {
          console.log(`[agent-runner] Job ${jobId}: Repeated ${allToolNames[0]} on same file (${repeatCount}x), breaking`);
          job._sameToolCount = 0;
          break;
        }
      } else {
        job._sameToolCount = 0;
      }

      for (const tc of toolCalls) {
        // Check for cancellation during tool execution (tools can be slow, e.g. npm install)
        const cancelCheck = loadJob(jobId);
        if (!cancelCheck || cancelCheck.status === 'cancelled') {
          console.log(`[agent-runner] Job ${jobId} cancelled during tool execution at iteration ${iter}`);
          job.status = 'cancelled';
          saveJob(job);
          return;
        }

        const fp = tc.args.filePath || tc.args.path || '';

        // Execute tool — let the model write/overwrite anything freely
        const result = await executeToolCall(tc, workspaceId, userId);
        toolResults.push({ tc, result, fp });

        // After create_file, verify the file actually exists on disk
        if (!result.error && tc.name === 'create_file' && fp) {
          const verifyRes = await executeToolCall({ name: 'read_file', args: { filePath: fp } }, workspaceId, userId);
          if (verifyRes.error) {
            conversation.push({
              role: 'user',
              content: `⚠️ File \`${fp}\` was NOT created successfully. The write failed. Please recreate it.`
            });
          }
        }

        if (result.error) {
          executionErrors.push(`${tc.name} ${fp}: ${result.error}`);
        }

        // ── Commit after every file-modifying tool so restore can revert ──
        if (!result.error && (tc.name === 'create_file' || tc.name === 'replace_string_in_file') && userMessageId) {
          try {
            const wsDir = getWorkspaceDir(workspaceId);
            const stepTag = `${userMessageId}_step${iter + 1}`;
            // Create step checkpoint (does NOT move the pre-message cp_{userMessageId} tag)
            await createWorkspaceCheckpoint(wsDir, stepTag);
          } catch (_) { /* non-fatal */ }
        }
      }

      // ── Notify frontend of file changes for real-time tree refresh ──
      const fileWriteTools = toolCalls.filter(tc =>
        tc.name === 'create_file' || tc.name === 'replace_string_in_file' || tc.name === 'run_in_terminal'
      );
      if (fileWriteTools.length > 0) {
        _agentEvents.emit(`job:${jobId}`, { type: 'files_changed', count: fileWriteTools.length });
      }

      // ── Tool result feedback with actual data ──
      const feedbackParts = [];
      for (const { tc, result, fp } of toolResults) {
        const name = tc.name;
        switch (name) {
          case 'create_file':
            feedbackParts.push(`Created \`${fp}\``);
            break;
          case 'replace_string_in_file':
            feedbackParts.push(`Patched \`${fp}\``);
            break;
          case 'read_file':
            if (!result.error && result.content) {
              const truncated = result.content.length > 4000 ? result.content.slice(0, 4000) + '\n... (truncated)' : result.content;
              feedbackParts.push(`Read \`${fp}\`:\n\`\`\`\n${truncated}\n\`\`\``);
            } else {
              feedbackParts.push(`Read \`${fp}\`: ${result.error || 'empty'}`);
            }
            break;
          case 'list_dir':
            if (!result.error && result.files) {
              const lines = result.files.map(f => {
                const icon = f.type === 'directory' ? '📁' : '📄';
                return `${icon} ${f.path || f.name}`;
              });
              feedbackParts.push(`Workspace files:\n${lines.join('\n')}`);
            } else {
              feedbackParts.push(`Listed \`${fp || '.'}\`: ${result.error || 'empty'}`);
            }
            break;
          case 'run_in_terminal': {
            const out = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 2000);
            feedbackParts.push(`Ran: ${(tc.args.command || '').slice(0, 60)}\n\`\`\`\n${out || '(no output)'}\n\`\`\``);
            break;
          }
          case 'dev_server_start':
            feedbackParts.push(`Started dev server`);
            break;
          case 'dev_server_status':
            feedbackParts.push(`Checked dev server`);
            break;
          case 'grep_search': {
            if (!result.error && result.results) {
              feedbackParts.push(`Search results for "${tc.args.query}": ${result.total} matches`);
            } else {
              feedbackParts.push(`Search "${tc.args.query}": ${result.error || 'no matches'}`);
            }
            break;
          }
          default:
            feedbackParts.push(`${name} done`);
        }
      }

      conversation.push({
        role: 'user',
        content: `[Step ${iter + 1}] ${feedbackParts.join('\n')}`
      });

      // ── Persist progress (guard: don't overwrite a DB-side cancellation) ──
      const preSaveCheck = loadJob(jobId);
      if (!preSaveCheck || preSaveCheck.status === 'cancelled') {
        console.log(`[agent-runner] Job ${jobId} cancelled (detected pre-save), exiting`);
        job.status = 'cancelled';
        saveJob(job);
        return;
      }
      job.iteration = iter + 1;
      job.planTodos = planTodos;
      job.planSummary = planSummary;
      job.conversation = conversation;
      job.fileManifest = [];
      saveJob(job);
    }

    // ── Post-loop summary (only when the model didn't already say it's done) ──
    if (!planCompleted) {
      // Check if the model's last message already contained a done phrase.
      // If so, the UI already shows a completion message — skip the duplicate.
      const lastMsg = conversation.filter(m => m.role === 'assistant').pop();
      const lastContent = (lastMsg?.content || '').replace(/^\[x\]\s*/gmi, '').trim();
      const alreadySignaled = lastContent && DONE_PHRASES.some(p => p.test(lastContent));

      if (!alreadySignaled) {
        let summary = 'Task complete. ✅';

        try {
          const base = `http://localhost:${process.env.PORT || 3000}`;
          const devRes = await fetch(`${base}/api/workspace/${workspaceId}/dev-server`, { method: 'GET' });
          const devData = devRes.ok ? await devRes.json() : null;
          if (devData?.running) {
            summary = `✅ Task complete. Dev server is running on port ${devData.port}.`;
          }
        } catch {}

        const summaryId = `agent_summary_${Date.now()}`;
        await saveMessageToChat(chatId, 'assistant', summary, model, provider, summaryId, new Date().toISOString());
      }
    }

    // ── Mark job completed ──
    job.status = 'completed';
    job.planTodos = planTodos;
    job.conversation = conversation;
    job.fileManifest = [];
    job.iteration = MAX_ITERATIONS;
    saveJob(job);
    _agentEvents.emit(`job:${jobId}`, { type: 'done' });
    console.log(`[agent-runner] Job ${jobId} completed successfully`);

  } catch (err) {
    console.error(`[agent-runner] Job ${jobId} failed:`, err.message);
    job.status = 'failed';
    job.errorMessage = err.message;
    saveJob(job);
    _agentEvents.emit(`job:${jobId}`, { type: 'error', error: err.message });
    try {
      await saveMessageToChat(chatId, 'assistant', `Error: ${err.message}`, model, provider, `agent_err_${Date.now()}`, new Date().toISOString());
    } catch {}
  }
}

// ── LLM Call (streaming SSE — saves incremental thinking/content to chat) ───

async function llmCall(conversation, model, provider, thinkingEffort, apiKeys, chatId, assistantId, jobId, signal) {
  const headers = buildHeaders(apiKeys);
  const temp = thinkingEffort === 'high' ? 0.1 : thinkingEffort === 'low' ? 0.5 : 0.3;
  const extraParams = {};
  if (provider === 'deepseek' && thinkingEffort === 'high') {
    extraParams.reasoning_effort = thinkingEffort;
    extraParams.thinking_type = 'enabled';
  }

  // Native tool calling: add tools + tool_choice for providers that support it
  const toolMode = getToolMode(provider);
  if (toolMode === 'native') {
    extraParams.tools = buildNativeTools();
    extraParams.tool_choice = 'auto';
  }

  const bodyObj = {
    model,
    messages: conversation,
    provider,
    stream: true,
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
    body: JSON.stringify(bodyObj),
    signal
  });

  if (!res.ok) {
    let errorMsg = `API error: ${res.status}`;
    try { const errData = await res.json(); errorMsg = errData.error?.message || errorMsg; } catch {}
    throw new Error(errorMsg);
  }

  // Stream SSE response — accumulate content, thinking, and tool_calls incrementally
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let streamBuffer = '';
  let content = '';
  let thinking = '';

  // Accumulate native tool calls from streaming delta chunks
  const toolCallAccumulator = {}; // index -> { id, name, arguments }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    streamBuffer += decoder.decode(value, { stream: true });

    const lines = streamBuffer.split('\n');
    streamBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]') continue;

      try {
        const data = JSON.parse(jsonStr);
        const delta = data.choices?.[0]?.delta || {};

        const thinkChunk = delta.thinking || delta.reasoning_content || delta.reasoning || '';
        if (thinkChunk) thinking += thinkChunk;

        const contentChunk = delta.content || '';
        if (contentChunk) content += contentChunk;

        // Accumulate native tool_calls from streaming delta
        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulator[idx]) {
              toolCallAccumulator[idx] = { id: tc.id || '', name: '', arguments: '' };
            }
            if (tc.id) toolCallAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallAccumulator[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCallAccumulator[idx].arguments += tc.function.arguments;
          }
        }

        // Emit real-time event AND save on EVERY SSE chunk that has content
        if (thinkChunk || contentChunk) {
          if (jobId) {
            // Emit to connected SSE clients (letter-by-letter streaming)
            _agentEvents.emit(`job:${jobId}`, {
              type: thinkChunk ? 'thinking' : 'content',
              text: thinkChunk || contentChunk
            });
          }
          if (chatId && assistantId) {
            saveMessageToChat(chatId, 'assistant', content, model, provider, assistantId, new Date().toISOString(), thinking);
          }
        }
      } catch {}
    }
  }

  // Final save with complete content/thinking — strip [x] echo and tool call syntax before persisting
  if (chatId && assistantId) {
    let cleanContent = content;
    if (cleanContent) {
      cleanContent = cleanContent.replace(/^\[x\]\s*/gmi, '');
      // Strip tool call syntax (fenced blocks, XML, brackets, etc.) so the UI
      // doesn't show raw tool calls as visible text. Only affects local LLMs
      // (non-native tool calling providers) since native tool_calls are separate.
      cleanContent = stripToolCallsFromContent(cleanContent);
    }
    saveMessageToChat(chatId, 'assistant', cleanContent, model, provider, assistantId, new Date().toISOString(), thinking);
  }

  // Build native tool_calls from stream accumulator
  const nativeToolCalls = Object.values(toolCallAccumulator)
    .filter(tc => tc.name)
    .map(tc => {
      let args = {};
      try {
        args = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        args = {};
      }
      // Normalize filePath/path
      if (args.filePath === undefined && args.path !== undefined) args.filePath = args.path;
      if (args.path === undefined && args.filePath !== undefined) args.path = args.filePath;
      return { name: tc.name, args, id: tc.id };
    });
  const finishReason = 'stop';

  console.log(`[agent-runner] LLM response: content=${content.length} chars, thinking=${thinking.length} chars, finish_reason=${finishReason}`);

  // DEBUG: Log content when we have tool calls
  if (content.length > 0) {
    console.log(`[agent-runner] LLM message content (first 500 chars): ${content.slice(0, 500)}`);
  }

  return { content, thinking, finishReason, nativeToolCalls };
}

// ── Build verification removed — the model handles builds itself via run_in_terminal

// ── Start a new job ──────────────────────────────────────────────────────────

/**
 * Create and start a new agent job. Returns the job ID immediately.
 * The job runs asynchronously in the background.
 */
export function startAgentJob({ workspaceId, chatId, userId, userContent, userMessageId, model, provider, thinkingEffort, agentMode, systemPrompt, apiKeys, trimAfterMessageId }) {
  runMigrations();
  const db = getDb();

  // ── Resume awaiting_input job if present ──
  const awaitingJob = db.prepare(
    "SELECT * FROM agent_jobs WHERE workspace_id = ? AND status = 'awaiting_input' ORDER BY updated_at DESC LIMIT 1"
  ).get(workspaceId);

  if (awaitingJob) {
    console.log(`[agent-runner] Resuming paused job ${awaitingJob.id} with user response`);
    const job = awaitingJob;
    const conversation = JSON.parse(job.conversation || '[]');
    const planTodos = JSON.parse(job.plan_todos || '[]');
    const fileManifest = JSON.parse(job.file_manifest || '[]');

    // Append user's answer to the conversation
    conversation.push({ role: 'user', content: userContent });
    // Add gentle nudge to continue
    conversation.push({
      role: 'user',
      content: 'Thank you for the clarification. Continue with the task using a tool call. DO NOT ask more questions — ACT NOW.'
    });

    // Save the user message to the chat (caller may have already saved it — this is idempotent via message ID)
    const userMsgId = `agent_user_${Date.now()}`;
    saveMessageToChat(chatId, 'user', userContent, model, provider, userMsgId, new Date().toISOString());

    // Update job to running
    db.prepare(`
      UPDATE agent_jobs 
      SET status = 'running', conversation = ?, iteration = ?, pending_question = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(conversation), job.iteration || 0, awaitingJob.id);

    // Create filesystem checkpoint before resuming agent
    const ckMsgId = userMessageId || userMsgId;
    createCheckpointForMessage(workspaceId, ckMsgId);

    // Run asynchronously
    runAgentJob(awaitingJob.id, ckMsgId).catch(err => {
      console.error(`[agent-runner] Unhandled error in resumed job ${awaitingJob.id}:`, err);
    });

    return awaitingJob.id;
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Cancel any existing running jobs for this workspace
  db.prepare("UPDATE agent_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE workspace_id = ? AND status IN ('running', 'interrupted')").run(workspaceId);

  const isPlanExecution = userContent.startsWith('Execute the following plan');
  const effectiveMode = isPlanExecution ? 'agent' : agentMode;

  // ── Load prior chat messages so Plan/Agent modes have full context ──
  let priorChatMessages = [];
  try {
    const chatMsgs = db.prepare(
      "SELECT * FROM messages WHERE chat_id = ? ORDER BY position ASC"
    ).all(chatId);
    // Map to OpenAI format, exclude empty/system messages
    priorChatMessages = (chatMsgs || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content || '', id: m.id }))
      .filter(m => m.content.trim());

    // If retrying from a specific point, trim history after the given message ID
    if (trimAfterMessageId) {
      const trimIdx = priorChatMessages.findIndex(m => m.id === trimAfterMessageId);
      if (trimIdx >= 0) {
        priorChatMessages = priorChatMessages.slice(0, trimIdx + 1);
        console.log(`[agent-runner] Trimmed conversation history after message ${trimAfterMessageId}, kept ${priorChatMessages.length} messages`);
      }
    }
  } catch (e) {
    console.warn('[agent-runner] Could not load prior chat messages:', e.message);
  }

  // Build initial conversation
  let systemPromptFinal = systemPrompt || buildSystemPrompt(workspaceId, effectiveMode, provider);
  // Only inject Next.js tech stack when the user is explicitly building a web app.
  // Don't inject for simple tasks like "create a file", "run a command", etc.
  const webAppKeywords = /\b(website|web app|webapp|landing page|landing page|site|portfolio|dashboard|build a.*app|create a.*site|create a.*app|frontend|fullstack|spa|single page app)\b/i;
  const frameworkKeywords = /\b(next\.?js|nextjs|react|vue|angular|svelte|express|django|flask|fastapi|rails|laravel|static html|plain html|html only|vanilla js|python|go|rust|sveltekit|nuxt|remix|astro|gatsby|vite)\b/i;
  const userWantsWebApp = webAppKeywords.test(userContent);
  const userSpecifiedFramework = frameworkKeywords.test(userContent);
  const frameworkHint = (userWantsWebApp && !userSpecifiedFramework)
    ? '\n\nTECH STACK: Build this as a Next.js 16 + TypeScript + Tailwind CSS v3 project. Create files in the app/ directory (App Router). Do NOT use plain HTML.'
    : '';

  let effectiveUserContent = userContent;

  // ── Mode-transition context injection ──
  if (effectiveMode === 'plan') {
    // Inject prior Chat context so Plan mode knows what was discussed
    let planContext = '';
    if (priorChatMessages.length > 0) {
      planContext = '\n\n=== CONVERSATION HISTORY (from Chat mode) ===\n';
      planContext += 'The user previously discussed this project in Chat mode. Here is the conversation:\n\n';
      // Include last 20 messages (10 exchanges) to stay within context
      const recentMsgs = priorChatMessages.slice(-20);
      for (const m of recentMsgs) {
        planContext += `[${m.role.toUpperCase()}]: ${m.content.slice(0, 1000)}\n\n`;
      }
      planContext += '=== END CONVERSATION HISTORY ===\n\n';
    }
    effectiveUserContent = `${planContext}NOW: ${userContent}\n\nIMPORTANT: Review the conversation history above. The user discussed this project in Chat mode — use that discussion to inform your plan. Generate a structured plan in the ### Summary / ### Tasks format. DO NOT ask more questions unless absolutely necessary — the conversion history already contains the user\'s preferences.`;
  } else if (effectiveMode === 'agent') {
    // Prior messages are included as actual conversation turns below.
    // Only add the framework hint and mode directive.
    effectiveUserContent = `${userContent}${frameworkHint}\n\nYou are in AGENT MODE. Act immediately with a tool call. Start with list_dir if you need to see the workspace.`;
  }

  // Build conversation with prior chat messages as actual turns (not just text injection).
  // This ensures the model maintains full context across retries and continuations.
  const conversation = [
    { role: 'system', content: systemPromptFinal },
  ];

  // Include prior chat messages as separate conversation turns (respecting trimAfterMessageId)
  if (priorChatMessages.length > 0) {
    for (const m of priorChatMessages) {
      conversation.push({ role: m.role, content: m.content });
    }
  }

  // Add the new user message as the final turn
  conversation.push({ role: 'user', content: effectiveUserContent });

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
    INSERT INTO agent_jobs (id, workspace_id, chat_id, user_id, status, model, provider, thinking_effort, agent_mode, user_request, plan_todos, plan_summary, iteration, conversation, file_manifest, api_keys)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, 0, ?, '[]', ?)
  `).run(
    jobId, workspaceId, chatId, userId || '',
    model, provider, thinkingEffort || 'high', effectiveMode, userContent,
    JSON.stringify(planTodos), planSummary,
    JSON.stringify(conversation),
    JSON.stringify(apiKeys || {})
  );

  // Create filesystem checkpoint before agent starts working
  if (userMessageId) {
    createCheckpointForMessage(workspaceId, userMessageId);
  }

  // Run asynchronously — don't await
  runAgentJob(jobId, userMessageId || null).catch(err => {
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

  // Abort any in-flight LLM calls for this workspace
  const jobs = db.prepare(
    "SELECT id FROM agent_jobs WHERE workspace_id = ? AND status IN ('running', 'interrupted', 'awaiting_input')"
  ).all(workspaceId);
  for (const row of (jobs || [])) {
    const ac = _abortControllers.get(row.id);
    if (ac) {
      ac.abort();
      _abortControllers.delete(row.id);
    }
  }

  const info = db.prepare(
    "UPDATE agent_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE workspace_id = ? AND status IN ('running', 'interrupted', 'awaiting_input')"
  ).run(workspaceId);
  return info.changes;
}

/**
 * Get the current status of an active job for a workspace.
 * Returns null if no active job exists.
 */
export function getJobStatus(workspaceId, jobId = null) {
  runMigrations();
  const db = getDb();
  
  let job;
  if (jobId) {
    job = db.prepare(
      "SELECT * FROM agent_jobs WHERE id = ?"
    ).get(jobId);
  } else {
    job = db.prepare(
      "SELECT * FROM agent_jobs WHERE workspace_id = ? AND status IN ('running', 'interrupted', 'awaiting_input') ORDER BY created_at DESC LIMIT 1"
    ).get(workspaceId);
  }

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
    pendingQuestion: job.pending_question || '',
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

  // Mark as running BEFORE starting the async job to prevent double-resume
  db.prepare(
    "UPDATE agent_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ? AND status = 'interrupted'"
  ).run(job.id);

  console.log(`[agent-runner] Resuming interrupted job ${job.id} for workspace ${workspaceId}`);
  // Use job ID as fallback checkpoint tag (pre-message checkpoint already exists from original startAgentJob call)
  runAgentJob(job.id, `resume_${job.id}`).catch(err => {
    console.error(`[agent-runner] Unhandled error resuming job ${job.id}:`, err);
  });

  return job.id;
}
