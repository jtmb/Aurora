// @aurora/web - AgentPanel: AI coding agent chat sidebar

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function AgentPanel({ 
  workspaceId, 
  activeFilePath, 
  onFileEdit,
  onReadFile,
  currentFileContent
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  // --- Copilot-style agent controls ---
  const [agentMode, setAgentMode] = useState('chat');       // 'chat' | 'plan' | 'agent'
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('lmstudio');
  const [thinkingEffort, setThinkingEffort] = useState('medium'); // 'low' | 'medium' | 'high'
  const [availableModels, setAvailableModels] = useState([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef(null);

  // Provider color dots
  const sourceColorMap = {
    'LM Studio': 'bg-amber-500',
    'DeepSeek': 'bg-rose-500'
  };

  const mapSourceToProvider = (source) => {
    switch (source) {
      case 'LM Studio': return 'lmstudio';
      case 'DeepSeek': return 'deepseek';
      default: return 'lmstudio';
    }
  };

  // Load saved prefs + fetch models on mount
  useEffect(() => {
    const savedMode = localStorage.getItem('aurora_agent_mode');
    if (savedMode) setAgentMode(savedMode);
    const savedModel = localStorage.getItem('aurora_agent_model');
    if (savedModel) setSelectedModel(savedModel);
    const savedProvider = localStorage.getItem('aurora_agent_provider');
    if (savedProvider) setSelectedProvider(savedProvider);
    const savedThinking = localStorage.getItem('aurora_agent_thinking');
    if (savedThinking) setThinkingEffort(savedThinking);
    fetchModels();
  }, []);

  // Persist preferences
  useEffect(() => { localStorage.setItem('aurora_agent_mode', agentMode); }, [agentMode]);
  useEffect(() => { if (selectedModel) localStorage.setItem('aurora_agent_model', selectedModel); }, [selectedModel]);
  useEffect(() => { localStorage.setItem('aurora_agent_provider', selectedProvider); }, [selectedProvider]);
  useEffect(() => { localStorage.setItem('aurora_agent_thinking', thinkingEffort); }, [thinkingEffort]);

  // Click-away for model dropdown
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  const fetchModels = async () => {
    try {
      const headers = {};
      const token = localStorage.getItem('auth_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
      let lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      const lmStudioHost = localStorage.getItem('LM_STUDIO_HOST');
      const lmStudioPort = localStorage.getItem('LM_STUDIO_PORT');
      const lmStudioApiKey = localStorage.getItem('LM_STUDIO_API_KEY');

      // Construct LM Studio URL from host+port if full URL isn't stored
      if (!lmStudioUrl && lmStudioHost && lmStudioPort) {
        lmStudioUrl = `http://${lmStudioHost}:${lmStudioPort}/v1`;
      }

      if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
      if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
      if (lmStudioHost) headers['x-lmstudio-host'] = lmStudioHost;
      if (lmStudioPort) headers['x-lmstudio-port'] = lmStudioPort;
      if (lmStudioApiKey) headers['x-lmstudio-api-key'] = lmStudioApiKey;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/providers/models', { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data.models?.length > 0) {
          setAvailableModels(data.models);
          const saved = localStorage.getItem('aurora_agent_model');
          if (!saved || !data.models.find(m => m.id === saved)) {
            const first = data.models[0];
            setSelectedModel(first.id);
            setSelectedProvider(mapSourceToProvider(first.source));
          }
        } else {
          // No models available — clear stale selection so sendMessage falls back properly
          setAvailableModels([]);
          setSelectedModel('');
          setSelectedProvider('');
        }
      }
    } catch {
      // Network error fetching models — clear selection to avoid sending to dead provider
      setAvailableModels([]);
      setSelectedModel('');
      setSelectedProvider('');
    }
  };

  const currentModelInfo = availableModels.find(m => m.id === selectedModel);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => { scrollToBottom(); }, [messages, isThinking]);

  // Build request headers from localStorage
  const buildHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
    let lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
    const lmStudioHost = localStorage.getItem('LM_STUDIO_HOST');
    const lmStudioPort = localStorage.getItem('LM_STUDIO_PORT');
    const lmStudioApiKey = localStorage.getItem('LM_STUDIO_API_KEY');
    if (!lmStudioUrl && lmStudioHost && lmStudioPort) {
      lmStudioUrl = `http://${lmStudioHost}:${lmStudioPort}/v1`;
    }
    if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
    if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
    if (lmStudioHost) headers['x-lmstudio-host'] = lmStudioHost;
    if (lmStudioPort) headers['x-lmstudio-port'] = lmStudioPort;
    if (lmStudioApiKey) headers['x-lmstudio-api-key'] = lmStudioApiKey;
    return headers;
  };

  // Stream one LLM call and return the full response content
  const streamLLMCall = async (conversation, label) => {
    const headers = buildHeaders();
    const model = selectedModel || localStorage.getItem('aurora_last_model') || 'gpt-4o';
    const provider = selectedProvider || localStorage.getItem('aurora_last_provider') || 'openai';
    const temp = thinkingEffort === 'high' ? 0.5 : thinkingEffort === 'low' ? 0.1 : 0.3;
    const extraParams = {};
    if (thinkingEffort === 'high') extraParams.extended_thinking = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const res = await fetch('/api/v1/chat/completions', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ model, messages: conversation, temperature: temp, max_tokens: null, provider, stream: true, ...extraParams })
    });

    if (!res.ok) {
      let errorMsg = `API error: ${res.status}`;
      try { const errData = await res.json(); errorMsg = errData.error?.message || errorMsg; } catch {}
      throw new Error(errorMsg);
    }

    const assistantId = `agent_${Date.now()}`;
    setIsThinking(false);
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString(), iterationLabel: label }]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]') continue;
        try {
          const chunk = JSON.parse(json).choices?.[0]?.delta?.content || '';
          if (chunk) {
            content += chunk;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content } : m));
          }
        } catch {}
      }
    }
    return { content, assistantId };
  };

  // AGENTIC LOOP: send message, parse tools, execute, feed results back to LLM, repeat
  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userContent = input.trim();
    setInput('');
    setIsStreaming(true);
    setIsThinking(true);

    const userMsg = { id: `agent_user_${Date.now()}`, role: 'user', content: userContent, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    const systemPrompt = buildSystemPrompt(workspaceId, activeFilePath, currentFileContent, agentMode);
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent }
    ];

    const MAX_ITERATIONS = 12;

    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const label = iter > 0 ? `Step ${iter + 1}` : null;
        const { content: rawContent, assistantId } = await streamLLMCall(conversation, label);
        conversation.push({ role: 'assistant', content: rawContent });

        // Parse tool calls from the response
        const toolCalls = parseToolCalls(rawContent);
        if (toolCalls.length === 0) break; // Agent is done — no more tools

        // Execute all tools
        const toolResults = [];
        setIsThinking(true);
        for (const tc of toolCalls) {
          const result = await executeToolCall(tc, workspaceId);
          toolResults.push({ ...tc, result });
          // If create_file/replace succeeded, notify parent
          if ((tc.name === 'create_file' || tc.name === 'replace_string_in_file') && result.success && onFileEdit) {
            const fp = tc.args.filePath || tc.args.path;
            onFileEdit(fp, tc.args.content || result.content);
          }
        }
        setIsThinking(false);

        // Update last assistant bubble with tool call indicators
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === assistantId);
          if (idx < 0) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], toolCalls: toolResults.map(tr => ({
            name: tr.name, args: tr.args,
            status: tr.result.error ? 'error' : 'done',
            result: tr.result
          }))};
          return updated;
        });

        // Build tool result feedback for the LLM
        const resultSummary = toolResults.map(tr => {
          if (tr.result.error) return `${tr.name} ERROR: ${tr.result.error}`;
          const summary = summarizeToolResult(tr.name, tr.args, tr.result);
          return `${tr.name} OK: ${summary}`;
        }).join('\n');

        conversation.push({
          role: 'user',
          content: `[Tool Results for Step ${iter + 1}]\n${resultSummary}\n\nContinue. If the task is complete, respond normally WITHOUT using any tools.`
        });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, {
          id: `agent_err_${Date.now()}`,
          role: 'assistant',
          content: `Error: ${err.message}`,
          isError: true,
          timestamp: new Date().toISOString()
        }]);
      }
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
      abortRef.current = null;
    }
  };

  // Tool names that take a block body (the content is the body of the fenced block)
  const CONTENT_TOOLS = ['create_file', 'replace_string_in_file', 'run_in_terminal'];

  // Parser: finds ```TOOL_NAME key="val"... blocks and extracts tool calls
  const parseToolCalls = (content) => {
    const calls = [];
    // Match: ```toolName key1="val1" key2="val2"\n...body...\n```
    const regex = /```(\w+)\s+([^\n]*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const toolName = match[1];
      const attrStr = match[2];
      const body = match[3].trim();

      // Parse key="value" attributes (value may contain spaces, support single/double quotes)
      const args = {};
      const attrRegex = /(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
      let am;
      while ((am = attrRegex.exec(attrStr)) !== null) {
        args[am[1]] = am[2] || am[3] || am[4] || '';
      }

      // For content tools, the block body IS the content
      if (CONTENT_TOOLS.includes(toolName)) {
        if (toolName === 'replace_string_in_file') {
          // Split on ===FIND=== / ===REPLACE=== markers
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

      // Map Copilot tool names to internal executors
      const nameMap = {
        'create_file': 'create_file', 'read_file': 'read_file',
        'list_dir': 'list_dir', 'grep_search': 'grep_search',
        'replace_string_in_file': 'replace_string_in_file',
        'run_in_terminal': 'run_in_terminal'
      };
      if (nameMap[toolName]) {
        // Validate required args before accepting the tool call
        const fp = args.filePath || args.path;
        if ((toolName === 'create_file' || toolName === 'read_file' || toolName === 'replace_string_in_file') && !fp) {
          console.warn('[Agent] Skipping', toolName, 'call with no filePath — model omitted the path');
          continue;
        }
        if (toolName === 'create_file' && args.content === undefined) {
          console.warn('[Agent] Skipping create_file with no body — model wrote empty block for', fp);
          continue;
        }
        if (toolName === 'replace_string_in_file' && (!args.oldString || args.newString === undefined)) {
          console.warn('[Agent] Skipping replace_string_in_file with missing find/replace sections');
          continue;
        }
        calls.push({ name: toolName, args, raw: match[0] });
      }
    }
    return calls;
  };

  // Execute a single tool call — maps Copilot tool names to workspace API
  const executeToolCall = async (tc, wsId) => {
    try {
      switch (tc.name) {
        case 'read_file': return await executeReadFile(wsId, tc.args.filePath || tc.args.path);
        case 'create_file': return await executeCreateFile(wsId, tc.args.filePath || tc.args.path, tc.args.content);
        case 'replace_string_in_file': return await executeReplaceStringInFile(wsId, tc.args.filePath || tc.args.path, tc.args.oldString, tc.args.newString);
        case 'grep_search': return await executeSearch(wsId, tc.args.query);
        case 'list_dir': return await executeListFiles(wsId, tc.args.path);
        case 'run_in_terminal': return { error: 'Terminal execution not yet implemented. Use create_file to write files instead.' };
        default: return { error: `Unknown tool: ${tc.name}` };
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  // Summarize a tool result for LLM feedback
  const summarizeToolResult = (name, args, result) => {
    const fp = args.filePath || args.path || '?';
    switch (name) {
      case 'read_file': return `Read \`${fp}\` (${result.size || result.content?.length || 0} bytes): ${(result.content || '').slice(0, 500)}${(result.content || '').length > 500 ? '...' : ''}`;
      case 'create_file': return `Created \`${fp}\` successfully`;
      case 'replace_string_in_file': return `Patched \`${fp}\` successfully`;
      case 'grep_search': return `Found ${result.results?.length || 0} matches for "${args.query}": ${JSON.stringify((result.results || []).slice(0, 5))}`;
      case 'list_dir':
        const files = result.files || result.tree || [];
        return `Listed ${fp}: ${files.length} entries — ${files.slice(0, 20).map(f => f.name || f.path).join(', ')}${files.length > 20 ? '...' : ''}`;
      case 'git_status': return `Git branch: ${result.branch || 'unknown'}, modified: ${result.modified?.length || 0}`;
      default: return 'Done';
    }
  };

  const buildSystemPrompt = (wsId, activeFile, fileContent, mode = 'chat') => {
    const readOnlyTools = `You have these READ-ONLY tools. Call them with a fenced code block:
\`\`\`read_file filePath="relative/path.js"
\`\`\`
\`\`\`list_dir path="src"
\`\`\`
\`\`\`grep_search query="function name"
\`\`\``;

    const writeTools = `You also have these WRITE tools (Agent mode only):
\`\`\`create_file filePath="relative/path.js"
// Entire file content goes here — write the COMPLETE file
\`\`\`

\`\`\`replace_string_in_file filePath="relative/path.js"
===FIND===
exact old code to replace (must match exactly)
===REPLACE===
new replacement code
\`\`\``;

    let prompt = `You are Aurora Agent — an expert coding agent. You work in a LOOP: call tools, see their results, then call more tools.

HOW TO CALL TOOLS — Use a fenced code block with the tool name and key="value" arguments:
${readOnlyTools}

IMPORTANT:
- Arguments use filePath="value" (not path=) for file operations
- create_file takes filePath="..." and the COMPLETE file content in the block body
- replace_string_in_file takes filePath="..." and the block body must contain ===FIND=== and ===REPLACE=== sections
- read_file and list_dir take their arguments on the opening fence line
- You may call multiple tools in one response — put them in separate fenced blocks
- After completing the task, respond WITHOUT any tool calls`;

    if (mode === 'agent') {
      prompt += `

AGENT MODE — You have full write access.
WORKFLOW FOR BUILDING APPS:
1. First use list_dir to see what exists
2. Then create files one by one with create_file (write COMPLETE file content — the workspace may be empty)
3. For small changes, read_file first, then use replace_string_in_file

RULES:
- ALWAYS provide filePath="..." on the opening fence line
- For create_file, put the ENTIRE file content in the block body
- For replace_string_in_file, the ===FIND=== text must match the file EXACTLY
- After all steps are done, respond WITHOUT tool calls`;
      prompt += writeTools;
    } else if (mode === 'plan') {
      prompt += `\n\nPLAN MODE — Read-only. Explore the codebase, describe needed changes. NEVER use create_file or replace_string_in_file.`;
    } else {
      prompt += `\n\nCHAT MODE — Read-only, conversational. Suggest changes but don't make them. NEVER use create_file or replace_string_in_file.`;
    }

    if (activeFile) prompt += `\n\nActive file in editor: "${activeFile}"`;
    if (fileContent) {
      const truncated = fileContent.slice(0, 3000);
      prompt += `\n\nCurrent file content:\n\`\`\`\n${truncated}${fileContent.length > 3000 ? '\n... (truncated)' : ''}\n\`\`\``;
    }
    prompt += `\n\nWorkspace ID: ${wsId}`;
    return prompt;
  };

  // Tool executors (using Copilot-aligned names internally)
  const executeReadFile = async (wsId, filePath) => {
    const res = await fetch(`/api/workspace/${wsId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || 'Read failed');
    return await res.json();
  };

  const executeCreateFile = async (wsId, filePath, content) => {
    if (!filePath) return { error: 'filePath is required — the model forgot to provide a file path' };
    if (content === undefined || content === null) {
      console.warn('[Agent] create_file called with undefined/null content for', filePath, '— defaulting to empty file');
      content = '';
    }
    if (typeof content !== 'string') {
      content = String(content);
    }
    const res = await fetch(`/api/workspace/${wsId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Write failed (${res.status})`);
    }
    return await res.json();
  };

  const executeReplaceStringInFile = async (wsId, filePath, oldStr, newStr) => {
    if (!filePath) return { error: 'filePath is required for replace_string_in_file' };
    if (!oldStr || newStr === undefined || newStr === null) {
      return { error: 'replace_string_in_file requires both oldString (===FIND===) and newString (===REPLACE===)' };
    }
    // First read the file
    const readRes = await fetch(`/api/workspace/${wsId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    });
    if (!readRes.ok) throw new Error('File not found');
    const fileData = await readRes.json();
    
    // Try exact match
    let newContent = fileData.content;
    if (fileData.content.includes(oldStr)) {
      newContent = fileData.content.replace(oldStr, newStr);
    } else {
      // Try trimming whitespace from oldStr for fuzzy match
      const trimmed = oldStr.trim();
      if (fileData.content.includes(trimmed)) {
        newContent = fileData.content.replace(trimmed, newStr);
      } else {
        throw new Error('Could not find the text to replace in the file. The content may have changed.');
      }
    }
    
    // Write the modified content
    const writeRes = await fetch(`/api/workspace/${wsId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: newContent })
    });
    if (!writeRes.ok) throw new Error('Write failed');
    return { success: true, content: newContent, ...await writeRes.json() };
  };

  const executeSearch = async (wsId, query) => {
    const res = await fetch(`/api/workspace/${wsId}/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    return await res.json();
  };

  const executeListFiles = async (wsId, dirPath) => {
    // Reuse tree endpoint with subpath
    const res = await fetch(`/api/workspace/${wsId}/tree?depth=2`);
    if (!res.ok) throw new Error('List failed');
    const data = await res.json();
    if (dirPath) {
      // Filter tree to specific subdirectory
      const findNode = (nodes, target) => {
        for (const node of nodes) {
          if (node.path === target) return node.children || [];
          if (node.children) {
            const found = findNode(node.children, target);
            if (found.length) return found;
          }
        }
        return [];
      };
      return { files: findNode(data.tree, dirPath) };
    }
    return { files: data.tree };
  };

  const executeGitStatus = async (wsId) => {
    const res = await fetch(`/api/workspace/${wsId}/git/status`);
    return await res.json();
  };

  // UI display summary for tool call badges
  const getToolSummary = (name, args, result) => {
    const fp = args.filePath || args.path || '?';
    switch (name) {
      case 'read_file': return `Read \`${fp}\` (${result.size || result.content?.length || 0} bytes)`;
      case 'create_file': return `Created \`${fp}\``;
      case 'replace_string_in_file': return `Patched \`${fp}\``;
      case 'grep_search': return `Found ${result.results?.length || 0} matches for "${args.query}"`;
      case 'list_dir': return `Listed ${fp}`;
      case 'run_in_terminal': return `Ran \`${args.command}\``;
      default: return 'Done';
    }
  };

  // Handle apply/edit click from agent messages
  const handleApplyEdit = useCallback(async (filePath, newContent) => {
    if (!workspaceId || !onFileEdit) return;
    try {
      await executeCreateFile(workspaceId, filePath, newContent);
      onFileEdit(filePath, newContent);
    } catch (err) {
      console.error('Apply edit failed:', err);
    }
  }, [workspaceId, onFileEdit]);

  // Render message content with syntax highlighting
  const renderMessageContent = (msg) => {
    if (msg.isError) {
      return <div className="text-red-400 text-xs">{msg.content}</div>;
    }

    // Parse markdown-style code blocks
    const parts = msg.content.split(/(```\w*\n[\s\S]*?\n```)/g);
    
    return parts.map((part, i) => {
      const codeMatch = part.match(/```(\w*)\n([\s\S]*?)\n```/);
      if (codeMatch) {
        const lang = codeMatch[1] || 'text';
        const code = codeMatch[2];
        return (
          <div key={i} className="relative my-2 group">
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 rounded-t-lg border border-zinc-700/40 border-b-0">
              <span className="text-[10px] text-zinc-500 uppercase">{lang}</span>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
            <SyntaxHighlighter
              language={lang}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                borderTopLeftRadius: 0,
                borderTopRightRadius: 0,
                borderBottomLeftRadius: '0.5rem',
                borderBottomRightRadius: '0.5rem',
                border: '1px solid rgba(39,39,42,0.4)',
                borderTop: 'none',
                fontSize: '11px',
                lineHeight: 1.5,
                background: '#0d0d0d',
              }}
            >
              {code}
            </SyntaxHighlighter>
          </div>
        );
      }
      
      // Regular text (handle inline code)
      const inlineParts = part.split(/(`[^`]+`)/g);
      return (
        <span key={i}>
          {inlineParts.map((ip, j) => {
            if (ip.startsWith('`') && ip.endsWith('`')) {
              return <code key={j} className="bg-zinc-700/60 text-zinc-200 px-1 py-0.5 rounded text-[11px] font-mono">{ip.slice(1, -1)}</code>;
            }
            return <span key={j}>{ip}</span>;
          })}
        </span>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900/50 border-l border-zinc-800/40">
      {/* Header with model picker */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] text-white font-bold">A</span>
          </div>
          {/* Model picker dropdown */}
          <div className="relative" ref={modelDropdownRef}>
            <button
              type="button"
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800/60 transition-colors"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sourceColorMap[currentModelInfo?.source] || 'bg-zinc-500'}`} />
              <span className="truncate max-w-[110px]">{currentModelInfo?.name || selectedModel || 'Select model'}</span>
              <svg className={`w-3 h-3 text-zinc-500 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {modelDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700/50 rounded-xl shadow-2xl z-30 py-1 w-[220px] max-h-[260px] overflow-y-auto">
                {['OpenAI', 'Anthropic', 'DeepSeek', 'Ollama', 'LM Studio'].map(source => {
                  const groupModels = availableModels.filter(m => m.source === source);
                  if (groupModels.length === 0) return null;
                  return (
                    <div key={source}>
                      <div className="px-3 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider">{source}</div>
                      {groupModels.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(m.id);
                            setSelectedProvider(mapSourceToProvider(m.source));
                            setModelDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                            m.id === selectedModel ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sourceColorMap[m.source] || 'bg-zinc-500'}`} />
                          <span className="truncate">{m.name || m.id}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
                {availableModels.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-zinc-500">No models found</div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
              title="Clear chat"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-xs text-zinc-500">Ask me to read, search, or edit code</p>
            <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
              <button onClick={() => setInput('Explain what this codebase does')} className="px-2.5 py-1 bg-zinc-800/60 border border-zinc-700/40 rounded-full text-[10px] text-zinc-400 hover:bg-zinc-700/60 transition-colors">
                Explain codebase
              </button>
              <button onClick={() => setInput('Find all functions related to')} className="px-2.5 py-1 bg-zinc-800/60 border border-zinc-700/40 rounded-full text-[10px] text-zinc-400 hover:bg-zinc-700/60 transition-colors">
                Search code
              </button>
              <button onClick={() => setInput('Add error handling to')} className="px-2.5 py-1 bg-zinc-800/60 border border-zinc-700/40 rounded-full text-[10px] text-zinc-400 hover:bg-zinc-700/60 transition-colors">
                Improve code
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role !== 'user' && (
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[9px] text-white font-bold">A</span>
              </div>
            )}
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-tr-sm'
                : msg.isError
                  ? 'bg-red-950/30 border border-red-900/20 rounded-tl-sm text-red-300'
                  : 'bg-zinc-800/60 border border-zinc-700/40 rounded-tl-sm text-zinc-200'
            }`}>
              {msg.iterationLabel && (
                <div className="text-[9px] text-indigo-400 mb-1 font-medium">{msg.iterationLabel}</div>
              )}
              {renderMessageContent(msg)}
              
              {/* Tool calls display */}
              {msg.toolCalls?.map((tc, i) => (
                <div key={i} className={`mt-2 flex items-center gap-1.5 px-2 py-1 rounded text-[10px] ${
                  tc.status === 'error' 
                    ? 'bg-red-950/20 text-red-400' 
                    : tc.status === 'executing' 
                      ? 'bg-indigo-950/20 text-indigo-400'
                      : 'bg-emerald-950/20 text-emerald-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    tc.status === 'error' ? 'bg-red-400' : tc.status === 'executing' ? 'bg-indigo-400 animate-pulse' : 'bg-emerald-400'
                  }`} />
                  <span>{tc.name}</span>
                  <span className="text-zinc-600">—</span>
                  <span className="truncate">{getToolSummary(tc.name, tc.args, tc.result || {})}</span>
                </div>
              ))}
              
              <p className="text-[9px] mt-1 text-zinc-600">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </p>
            </div>
            
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            )}
          </div>
        ))}

        {isThinking && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-[9px] text-white font-bold">A</span>
            </div>
            <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-xl rounded-tl-sm px-3 py-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Agent mode toolbar */}
      <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-2 border-t border-zinc-800/20">
        {/* Mode pills: Chat | Plan | Agent */}
        <div className="flex items-center gap-0.5 bg-zinc-800/40 rounded-lg p-0.5">
          {[
            { id: 'chat', icon: '💬', label: 'Chat' },
            { id: 'plan', icon: '📋', label: 'Plan' },
            { id: 'agent', icon: '🤖', label: 'Agent' },
          ].map(mode => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setAgentMode(mode.id)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                agentMode === mode.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={
                mode.id === 'chat' ? 'Conversational — no file changes'
                : mode.id === 'plan' ? 'Plan only — no file changes'
                : 'Agent mode — can read and edit files'
              }
            >
              <span className="flex items-center gap-1">
                <span>{mode.icon}</span>
                <span>{mode.label}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Thinking effort selector */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[10px] text-zinc-600">Think:</span>
          <select
            value={thinkingEffort}
            onChange={(e) => setThinkingEffort(e.target.value)}
            className="bg-zinc-800/60 border border-zinc-700/40 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 cursor-pointer"
          >
            <option value="low" className="bg-zinc-800">Low</option>
            <option value="medium" className="bg-zinc-800">Med</option>
            <option value="high" className="bg-zinc-800">High</option>
          </select>
          {/* Visual bar indicator */}
          <div className="flex gap-0.5 ml-0.5">
            <span className={`w-1 h-3 rounded-full transition-colors ${['low', 'medium', 'high'].includes(thinkingEffort) ? 'bg-indigo-500' : 'bg-zinc-700'}`} />
            <span className={`w-1 h-3 rounded-full transition-colors ${['medium', 'high'].includes(thinkingEffort) ? 'bg-indigo-500' : 'bg-zinc-700'}`} />
            <span className={`w-1 h-3 rounded-full transition-colors ${thinkingEffort === 'high' ? 'bg-indigo-500' : 'bg-zinc-700'}`} />
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="p-2 border-t border-zinc-800/40">
        <form onSubmit={sendMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask agent to read, search, or edit..."
            disabled={isStreaming}
            className="flex-1 bg-zinc-800 border border-zinc-700/40 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isStreaming ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
