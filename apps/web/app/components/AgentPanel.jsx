// @aurora/web - AgentPanel: AI coding agent chat sidebar

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function AgentPanel({ 
  workspaceId,
  workspaceChatId,
  initialMessages,
  activeFilePath, 
  onFileEdit,
  onReadFile,
  currentFileContent,
  onOpenPreview,
  onToggleMode,
  codeMode
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const thinkingContainerRef = useRef(null);
  const turnCounterRef = useRef(0);

  // --- Copilot-style agent controls ---
  const [agentMode, setAgentMode] = useState('agent');       // 'plan' | 'agent'
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('lmstudio');
  const [thinkingEffort, setThinkingEffort] = useState('medium'); // 'low' | 'medium' | 'high'
  const [availableModels, setAvailableModels] = useState([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState(new Set());
  const [expandedToolIds, setExpandedToolIds] = useState(new Set());
  const [planTodos, setPlanTodos] = useState([]); // [{ id, text, done, dependsOn }]
  const modelDropdownRef = useRef(null);

  // Dynamic thinking label based on content (mirrors page.js pattern)
  const getThinkingLabel = (thinking, streaming) => {
    if (!streaming) return 'Done';
    const t = (thinking || '').toLowerCase();
    if (/\b(?:analyz|break\s*down|examin|inspect|dissect|scrutiniz)\b/i.test(t)) return 'Analyzing';
    if (/\b(?:reason|think|logic|deduc|infer|conclude|ponder)\b/i.test(t)) return 'Reasoning';
    if (/\b(?:evaluat|assess|weigh|judge|compar|decide)\b/i.test(t)) return 'Evaluating';
    if (/\b(?:plan|outline|step|approach|strateg|organiz)\b/i.test(t)) return 'Planning';
    if (/\b(?:calculat|comput|math|equation|formula|arithmetic)\b/i.test(t)) return 'Calculating';
    if (/\b(?:process|working|generating|producing|crafting|building)\b/i.test(t)) return 'Processing';
    if (/\b(?:verif|check|confirm|validat|test|ensur)\b/i.test(t)) return 'Verifying';
    if (/\b(?:summariz|recap|sum\s*up|overview|condens)\b/i.test(t)) return 'Summarizing';
    if (/\b(?:refin|improv|polish|enhance|tweak|adjust)\b/i.test(t)) return 'Refining';
    return 'Thinking';
  };

  // Parse plan mode response into structured todo items
  const parsePlanTodos = (content) => {
    const todos = [];
    const regex = /^\s*(?:\d+\.|[-*])\s*\[([ xX])\]\s+(.+)$/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const text = match[2].trim();
      const dependsMatch = text.match(/\*depends on\s+(.+?)\*$/i);
      todos.push({
        id: `plan_${todos.length}`,
        text: dependsMatch ? text.replace(dependsMatch[0], '').trim() : text,
        done: match[1].toLowerCase() === 'x',
        dependsOn: dependsMatch ? dependsMatch[1].trim() : null
      });
    }
    return todos;
  };

  // Auto-scroll thinking container during streaming
  useEffect(() => {
    if (isStreaming && thinkingContainerRef.current) {
      thinkingContainerRef.current.scrollTop = thinkingContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-collapse thinking when streaming finishes
  useEffect(() => {
    if (!isStreaming) {
      setExpandedThinkingIds(new Set());
    }
  }, [isStreaming]);

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

  // Load persisted messages when workspace chat changes
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages.map(m => ({
        ...m,
        id: m.id || `restored_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        content: m.content || ''
      })));
    } else if (initialMessages && initialMessages.length === 0) {
      setMessages([]);
    }
  }, [workspaceChatId, initialMessages]);

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

  // Stream one LLM call and return the full response content + thinking
  const streamLLMCall = async (conversation, label, turnId) => {
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
    setMessages(prev => [...prev, {
      id: assistantId, role: 'assistant', content: '', thinking: '',
      timestamp: new Date().toISOString(), iterationLabel: label, turnId, model, provider
    }]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', thinking = '';

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
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta || {};
          const chunkContent = delta.content || '';
          // Capture thinking/reasoning from multiple possible field names
          const chunkThinking = delta.thinking || delta.reasoning_content || delta.reasoning ||
            parsed.thinking || parsed.reasoning_content || parsed.reasoning || '';
          if (chunkContent) {
            content += chunkContent;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content } : m));
          }
          if (chunkThinking) {
            thinking += chunkThinking;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, thinking } : m));
          }
        } catch {}
      }
    }
    // Persist completed assistant message
    if (content) {
      const currentModel = selectedModel || localStorage.getItem('aurora_last_model') || '';
      const currentProvider = selectedProvider || localStorage.getItem('aurora_last_provider') || '';
      saveMessageToChat('assistant', content, currentModel, currentProvider, assistantId, new Date().toISOString());
    }
    return { content, thinking, assistantId };
  };

  // Take a git checkpoint before writing files (if workspace is a git repo)
  const takeCheckpoint = async (label) => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `checkpoint: ${label}` })
      });
      if (res.ok) {
        const data = await res.json();
        return { hash: data.commit?.hash, success: true };
      }
    } catch {}
    return null;
  };

  // Retry: remove last assistant turn and re-submit the user message
  const handleRetry = (msgId) => {
    if (isStreaming) return;
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId);
      if (idx < 0) return prev;
      // Find the user message that preceded this assistant message
      let userMsg = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (prev[i].role === 'user' && !prev[i].isToolResult) { userMsg = prev[i]; break; }
      }
      if (!userMsg) return prev;
      // Remove from the user message onward
      const trimmed = prev.slice(0, prev.indexOf(userMsg));
      // Re-trigger with the same user content
      setTimeout(() => {
        setInput(userMsg.content);
        // Submit after state settles
        setTimeout(() => {
          const form = document.querySelector('#agent-input-form');
          if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }, 50);
      }, 50);
      return trimmed;
    });
  };

  // Stop generation
  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  // Save a message to the workspace's chat via the API
  const saveMessageToChat = async (role, content, model, provider, msgId, timestamp) => {
    if (!workspaceChatId) return;
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      await fetch(`/api/chats/${workspaceChatId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msgId, role, content, model: model || '', provider: provider || '', timestamp: timestamp || new Date().toISOString() })
      });
    } catch {}
  };

  // AGENTIC LOOP: send message, parse tools, execute, feed results back to LLM, repeat
  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userContent = input.trim();
    setInput('');
    setIsStreaming(true);
    setIsThinking(true);
    setPlanTodos([]);

    const turnId = `turn_${++turnCounterRef.current}`;
    const userMsg = {
      id: `agent_user_${Date.now()}`, role: 'user', content: userContent,
      timestamp: new Date().toISOString(), turnId
    };
    setMessages(prev => [...prev, userMsg]);

    // Persist user message
    saveMessageToChat('user', userContent, selectedModel, selectedProvider, userMsg.id, userMsg.timestamp);

    const systemPrompt = buildSystemPrompt(workspaceId, activeFilePath, currentFileContent, agentMode);

    // In agent mode, wrap the user message with FORCEFUL instructions
    let effectiveUserContent = userContent;
    let prefillMessages = [];
    if (agentMode === 'agent') {
      effectiveUserContent = `USER REQUEST: ${userContent}

IMPORTANT: You are in AGENT MODE. DO NOT describe what you'll do.
DO NOT ask questions. DO NOT explain your plan. ACT NOW.
Use a TOOL CALL immediately. The workspace may be empty — create ALL needed files yourself.
If you need to see what exists, use list_dir first.`;

// On first turn in agent mode, add extra format guidance to the user message
      if (messages.length === 0) {
        effectiveUserContent = `USER REQUEST: ${userContent}

IMPORTANT: You are in AGENT MODE. DO NOT describe what you'll do.
DO NOT ask questions. DO NOT explain your plan. ACT NOW.
Use a TOOL CALL immediately. The workspace may be empty — create ALL needed files yourself.
If you need to see what exists, use list_dir first.

EXAMPLE: The correct format for creating a file is:
\`\`\`create_file filePath="src/index.html"
<!DOCTYPE html><html>...</html>
\`\`\`
Content goes INSIDE the block body, NOT as a content="..." attribute.`;
      }
    }

    const conversation = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      ...prefillMessages,
      { role: 'user', content: effectiveUserContent }
    ];

    const MAX_ITERATIONS = 12;
    let checkpointTaken = false;

    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const label = iter > 0 ? `Step ${iter + 1}` : null;
        const { content: rawContent, thinking, assistantId } = await streamLLMCall(conversation, label, turnId);
        conversation.push({ role: 'assistant', content: rawContent });

        // Parse plan todos in plan mode
        if (agentMode === 'plan' && iter === 0) {
          const todos = parsePlanTodos(rawContent);
          if (todos.length > 0) setPlanTodos(todos);
        }

        // Parse tool calls from the response
        const toolCalls = parseToolCalls(rawContent);
        if (toolCalls.length === 0) break; // Agent is done — no more tools

        // Take checkpoint before first write in agent mode
        if (agentMode === 'agent' && !checkpointTaken &&
            toolCalls.some(tc => tc.name === 'create_file' || tc.name === 'replace_string_in_file')) {
          const cp = await takeCheckpoint(`agent turn ${turnCounterRef.current} step ${iter}`);
          if (cp) {
            checkpointTaken = true;
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, checkpointHash: cp.hash } : m
            ));
          }
        }

        // Execute all tools
        const toolResults = [];
        setIsThinking(true);
        for (const tc of toolCalls) {
          const toolId = `${assistantId}_tool_${toolResults.length}`;
          // Add executing tool to message immediately
          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantId);
            if (idx < 0) return prev;
            const updated = [...prev];
            const existingTools = updated[idx].toolCalls || [];
            updated[idx] = {
              ...updated[idx],
              toolCalls: [...existingTools, { id: toolId, name: tc.name, args: tc.args, status: 'executing', result: null }]
            };
            return updated;
          });
          const result = await executeToolCall(tc, workspaceId);
          toolResults.push({ ...tc, result, toolId });
          // Update tool status to done/error
          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantId);
            if (idx < 0) return prev;
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              toolCalls: (updated[idx].toolCalls || []).map(t =>
                t.id === toolId ? { ...t, status: result.error ? 'error' : 'done', result } : t
              )
            };
            return updated;
          });
          // If create_file/replace succeeded, notify parent
          if ((tc.name === 'create_file' || tc.name === 'replace_string_in_file') && result.success && onFileEdit) {
            const fp = tc.args.filePath || tc.args.path;
            onFileEdit(fp, tc.args.content || result.content);
          }
        }
        setIsThinking(false);

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
          timestamp: new Date().toISOString(),
          turnId
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
        } else if (toolName === 'create_file') {
          // If the model put content as an attribute (content="...") extract it
          if (body.startsWith('content=')) {
            const contentMatch = body.match(/^content=["']([\s\S]*?)["']$/);
            if (contentMatch) {
              args.content = contentMatch[1];
            } else {
              args.content = body;
            }
          } else {
            args.content = body;
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

  const buildSystemPrompt = (wsId, activeFile, fileContent, mode = 'agent') => {
    // Agent mode: functional instructions only
    if (mode === 'agent') {
      return `Workspace: /api/workspace/${wsId}. Use RELATIVE paths: "." is root, "src/file.ts" for nested.

TOOL CALL FORMAT — Use EXACTLY this syntax for EVERY action:
\`\`\`create_file filePath="filename.ext"
COMPLETE FILE CONTENT GOES HERE
\`\`\`

\`\`\`read_file filePath="filename.ext"
\`\`\`

\`\`\`list_dir path="."
\`\`\`

\`\`\`replace_string_in_file filePath="filename.ext"
===FIND===
exact text to replace
===REPLACE===
new text
\`\`\`

\`\`\`grep_search query="search pattern"
\`\`\`

- First step: ${'`'}list_dir path="."${'`'} to see what exists.
- create_file puts content INSIDE the block body, never as content="..." attribute.
- Call ONE tool per response. Nothing outside the fenced block.
- When done, respond "Task complete." with no tool block.`;
    }

    // Plan mode
    if (mode === 'plan') {
      return `Workspace: /api/workspace/${wsId}.

TOOLS (use fenced code blocks to call them):
\`\`\`read_file filePath="filename.ext"
\`\`\`
\`\`\`list_dir path="."
\`\`\`
\`\`\`grep_search query="pattern"
\`\`\`

PLAN OUTPUT FORMAT (after exploration):
## Summary
Brief explanation of the goal and approach.

## Plan
- [ ] Task description — *depends on Task #*
- [ ] Another task

Use 🟢🟡🔴 for complexity. NEVER use create_file or replace_string_in_file.`;
    }

    // Agent mode (default)
    let prompt = `Workspace: /api/workspace/${wsId}.

TOOLS (use fenced code blocks):
\`\`\`read_file filePath="filename.ext"
\`\`\`
\`\`\`list_dir path="."
\`\`\`
\`\`\`grep_search query="pattern"
\`\`\`
\`\`\`create_file filePath="filename.ext"
COMPLETE FILE CONTENT GOES HERE
\`\`\`
\`\`\`replace_string_in_file filePath="filename.ext"
===FIND===
exact text to replace
===REPLACE===
new text
\`\`\``;

    if (activeFile) prompt += `\n\nActive file in editor: "${activeFile}"`;
    if (fileContent) {
      const truncated = fileContent.slice(0, 3000);
      prompt += `\n\nCurrent file content:\n\`\`\`\n${truncated}${fileContent.length > 3000 ? '\n... (truncated)' : ''}\n\`\`\``;
    }
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

  // Tool icon + color helpers
  const getToolIcon = (name) => {
    switch (name) {
      case 'read_file': return '📖';
      case 'create_file': return '📝';
      case 'replace_string_in_file': return '✏️';
      case 'grep_search': return '🔍';
      case 'list_dir': return '📁';
      case 'run_in_terminal': return '⚡';
      default: return '🔧';
    }
  };
  const getToolBorderColor = (name, status) => {
    if (status === 'error') return 'border-red-500/30';
    switch (name) {
      case 'read_file': return 'border-sky-500/30';
      case 'create_file': return 'border-emerald-500/30';
      case 'replace_string_in_file': return 'border-amber-500/30';
      case 'grep_search': return 'border-violet-500/30';
      case 'list_dir': return 'border-cyan-500/30';
      default: return 'border-zinc-600/30';
    }
  };
  const getLangColor = (lang) => {
    const colors = { javascript: 'text-amber-400', js: 'text-amber-400', jsx: 'text-amber-400',
      typescript: 'text-sky-400', ts: 'text-sky-400', tsx: 'text-sky-400',
      css: 'text-blue-400', scss: 'text-pink-400', html: 'text-orange-400',
      python: 'text-green-400', py: 'text-green-400', json: 'text-yellow-400',
      markdown: 'text-zinc-400', md: 'text-zinc-400', yaml: 'text-red-400',
      bash: 'text-emerald-400', sh: 'text-emerald-400', sql: 'text-cyan-400' };
    return colors[(lang || '').toLowerCase()] || 'text-zinc-500';
  };

  // Render message content with syntax highlighting (excludes tool fenced blocks)
  const renderMessageContent = (msg) => {
    if (msg.isError) {
      return <div className="text-red-400 text-xs">{msg.content}</div>;
    }
    if (!msg.content) return null;

    // Remove tool call fenced blocks from displayed content (shown in tool cards)
    const toolBlockRegex = /```(create_file|replace_string_in_file|read_file|list_dir|grep_search|run_in_terminal)\s+[^\n]*\n[\s\S]*?```/g;
    const cleanContent = msg.content.replace(toolBlockRegex, '').trim();
    // If tool blocks consumed everything, show the raw text (fallback for small models)
    if (!cleanContent) {
      // Show raw content but collapse whitespace-only responses
      const trimmed = msg.content.trim();
      if (!trimmed) return null;
      return <span className="text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap">{trimmed}</span>;
    }

    // Parse markdown-style code blocks (only non-tool blocks)
    const parts = cleanContent.split(/(```\w*\n[\s\S]*?\n```)/g);
    
    return parts.map((part, i) => {
      const codeMatch = part.match(/```(\w*)\n([\s\S]*?)\n```/);
      if (codeMatch) {
        const lang = codeMatch[1] || 'text';
        const code = codeMatch[2];
        return (
          <div key={i} className="relative my-2 group">
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 rounded-t-lg border border-zinc-700/30 border-b-0">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${getLangColor(lang).replace('text-', 'bg-')}`} />
                <span className={`text-[10px] uppercase font-medium ${getLangColor(lang)}`}>{lang}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {msg.role === 'assistant' && onFileEdit && activeFilePath && (
                  <button
                    onClick={() => handleApplyEdit(activeFilePath, code)}
                    className="text-[10px] text-zinc-500 hover:text-indigo-400 transition-colors px-1"
                    title="Apply to editor"
                  >
                    Apply
                  </button>
                )}
                <button
                  onClick={() => navigator.clipboard.writeText(code)}
                  className="text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
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
                border: '1px solid rgba(39,39,42,0.3)',
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
        <span key={i} className="text-xs leading-relaxed text-zinc-300">
          {inlineParts.map((ip, j) => {
            if (ip.startsWith('`') && ip.endsWith('`')) {
              return <code key={j} className="bg-zinc-700/50 text-zinc-200 px-1 py-0.5 rounded text-[11px] font-mono">{ip.slice(1, -1)}</code>;
            }
            return <span key={j}>{ip}</span>;
          })}
        </span>
      );
    });
  };

  // Render an individual tool call card (expandable)
  const ToolCallCard = ({ tc, msgId }) => {
    const isExpanded = expandedToolIds.has(tc.id);
    const toggle = () => {
      setExpandedToolIds(prev => {
        const next = new Set(prev);
        if (next.has(tc.id)) next.delete(tc.id);
        else next.add(tc.id);
        return next;
      });
    };
    const borderColor = getToolBorderColor(tc.name, tc.status);
    const fp = tc.args?.filePath || tc.args?.path || '';

    return (
      <div className={`mt-1 border-l-2 ${borderColor} bg-zinc-800/30 rounded-r-md overflow-hidden`}>
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] hover:bg-zinc-800/40 transition-colors text-left"
        >
          <span className="text-xs">{getToolIcon(tc.name)}</span>
          <span className="font-medium text-zinc-300">{tc.name}</span>
          {fp && <span className="text-zinc-600 font-mono text-[10px] truncate max-w-[140px]">{fp}</span>}
          <span className="ml-auto flex-shrink-0">
            {tc.status === 'executing' ? (
              <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />
            ) : tc.status === 'error' ? (
              <span className="text-red-400 text-[10px]">✗</span>
            ) : (
              <span className="text-emerald-400 text-[10px]">✓</span>
            )}
          </span>
          <svg className={`w-3 h-3 text-zinc-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {isExpanded && (
          <div className="px-3 py-2 border-t border-zinc-700/20 text-[10px] text-zinc-500 space-y-1">
            {tc.args && Object.keys(tc.args).filter(k => k !== 'content' && k !== 'oldString' && k !== 'newString').length > 0 && (
              <div>
                <span className="text-zinc-600">Args: </span>
                {Object.entries(tc.args).filter(([k]) => k !== 'content' && k !== 'oldString' && k !== 'newString').map(([k, v]) => (
                  <span key={k} className="text-zinc-400">{k}=<span className="text-zinc-300">{String(v).slice(0, 80)}</span> </span>
                ))}
              </div>
            )}
            {tc.result?.error ? (
              <div className="text-red-400">{tc.result.error}</div>
            ) : tc.result?.content && tc.name === 'read_file' ? (
              <pre className="text-zinc-400 whitespace-pre-wrap font-mono max-h-[120px] overflow-y-auto bg-zinc-900/50 p-2 rounded">{String(tc.result.content).slice(0, 500)}</pre>
            ) : tc.result?.results && tc.name === 'grep_search' ? (
              <div className="space-y-0.5">
                {tc.result.results.slice(0, 8).map((r, i) => (
                  <div key={i} className="text-zinc-400">
                    <span className="text-zinc-600">{r.path}:{r.line}</span> — {r.content?.slice(0, 100)}
                  </div>
                ))}
              </div>
            ) : tc.result?.files && tc.name === 'list_dir' ? (
              <div className="flex flex-wrap gap-1">
                {tc.result.files.slice(0, 20).map(f => (
                  <span key={f.name || f.path} className="text-zinc-400 bg-zinc-800/50 px-1.5 py-0.5 rounded">{f.name || f.path}</span>
                ))}
              </div>
            ) : tc.status === 'done' ? (
              <div className="text-emerald-400">{getToolSummary(tc.name, tc.args, tc.result || {})}</div>
            ) : null}
          </div>
        )}
      </div>
    );
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
          {onToggleMode && (
            <button
              onClick={onToggleMode}
              className={`p-1 rounded transition-colors ${codeMode === 'vibe' ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-purple-400'}`}
              title={codeMode === 'vibe' ? 'Switch to Full Workspace' : 'Switch to Vibe Code'}
            >
              {codeMode === 'vibe' ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              )}
            </button>
          )}
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

      {/* Messages — Copilot-style flat layout */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/10 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-zinc-400 mb-1">Ask anything about your codebase</p>
            <p className="text-[11px] text-zinc-600 mb-4">I can read, search, explain, and edit files</p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {[
                { label: 'Explain this file', query: 'Explain what this file does' },
                { label: 'Find bugs', query: 'Find potential bugs and issues in this code' },
                { label: 'Add tests', query: 'Write unit tests for this code' },
                { label: 'Refactor', query: 'Suggest refactoring improvements' },
              ].map(chip => (
                <button
                  key={chip.label}
                  onClick={() => setInput(chip.query)}
                  className="px-2.5 py-1.5 bg-zinc-800/40 border border-zinc-700/30 rounded-lg text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-600/30 transition-all"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const isLastAssistant = !isUser && i === messages.length - 1;
          const isStreamingThis = isLastAssistant && isStreaming;
          const hasThinking = !isUser && msg.thinking;
          const isThinkingExpanded = expandedThinkingIds.has(msg.id);
          const toggleThinking = () => {
            setExpandedThinkingIds(prev => {
              const next = new Set(prev);
              if (next.has(msg.id)) next.delete(msg.id);
              else next.add(msg.id);
              return next;
            });
          };

          return (
          <div key={msg.id} className={`group relative ${i > 0 ? 'border-t border-zinc-800/20' : ''} ${isUser ? 'py-2' : 'py-2.5'}`}>
            {/* Checkpoint banner */}
            {msg.checkpointHash && (
              <div className="flex items-center gap-1.5 px-2 py-1 mb-1 bg-amber-950/20 border border-amber-800/20 rounded text-[10px] text-amber-400">
                <span>📸</span>
                <span>Checkpoint</span>
                <code className="text-amber-500 font-mono">{msg.checkpointHash}</code>
                <span className="text-amber-600">— auto-saved before file changes</span>
              </div>
            )}

            {/* Plan todo list */}
            {planTodos.length > 0 && i === messages.findIndex(m => m.role === 'assistant' && planTodos.length > 0) && (
              <div className="mb-2 mx-1 border-l-2 border-indigo-500/30 bg-indigo-950/10 rounded-r-md px-3 py-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-indigo-300">Plan</span>
                  <span className="text-[10px] text-zinc-500">
                    {planTodos.filter(t => t.done).length}/{planTodos.length} done
                  </span>
                </div>
                <div className="w-full h-1 bg-zinc-800 rounded-full mb-2 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                    style={{ width: `${planTodos.length > 0 ? (planTodos.filter(t => t.done).length / planTodos.length) * 100 : 0}%` }}
                  />
                </div>
                {planTodos.map(todo => (
                  <label key={todo.id} className="flex items-start gap-2 py-0.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={() => setPlanTodos(prev => prev.map(p => p.id === todo.id ? { ...p, done: !p.done } : p))}
                      className="mt-0.5 w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-indigo-500"
                    />
                    <span className={`text-[11px] ${todo.done ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                      {todo.text}
                      {todo.dependsOn && <span className="text-[10px] text-zinc-600 ml-1">← {todo.dependsOn}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* Message content */}
            <div className="px-3">
              {/* User message: simple right-aligned label */}
              {isUser && (
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="text-[10px] font-medium text-zinc-500">You</span>
                  <span className="text-[9px] text-zinc-700">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                </div>
              )}

              {/* Assistant message: model badge + thinking + content */}
              {!isUser && (
                <div>
                  {/* Model badge + timestamp + retry */}
                  <div className="flex items-center gap-2 mb-0.5">
                    {msg.iterationLabel ? (
                      <span className="text-[10px] font-medium text-indigo-400">{msg.iterationLabel}</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${sourceColorMap[currentModelInfo?.source] || 'bg-zinc-500'}`} />
                        <span className="text-[10px] font-medium text-zinc-400">
                          {msg.model || currentModelInfo?.name || 'Agent'}
                        </span>
                      </div>
                    )}
                    <span className="text-[9px] text-zinc-700">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    {msg.isError && <span className="text-[10px] text-red-400">Error</span>}
                    {/* Retry button */}
                    {!isStreaming && !msg.isError && (
                      <button
                        type="button"
                        onClick={() => handleRetry(msg.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-zinc-600 hover:text-zinc-300 transition-all flex items-center gap-1"
                        title="Retry"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Retry
                      </button>
                    )}
                  </div>

                  {/* Thinking block */}
                  {hasThinking && (
                    <div className="mb-2">
                      <button
                        type="button"
                        onClick={toggleThinking}
                        className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors w-full text-left"
                      >
                        <svg className={`w-2.5 h-2.5 transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span>{getThinkingLabel(msg.thinking, isStreamingThis)}</span>
                        {isStreamingThis && (
                          <span className="inline-flex gap-0.5 ml-0.5">
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        )}
                        {!isStreamingThis && hasThinking && (
                          <span className="text-emerald-400 ml-1">✓</span>
                        )}
                      </button>
                      {isThinkingExpanded && (
                        isStreamingThis ? (
                          <div className="mt-1.5 pl-3 border-l-2 border-zinc-700/40 relative">
                            <div className="absolute top-0 left-3 right-0 h-6 bg-gradient-to-b from-zinc-900/50 via-zinc-900/20 to-transparent z-10 pointer-events-none" />
                            <div
                              ref={thinkingContainerRef}
                              className="text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap font-mono max-h-[5rem] overflow-y-auto"
                              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            >
                              {msg.thinking}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1.5 pl-3 border-l-2 border-zinc-700/40 text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap font-mono">
                            {msg.thinking}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Message body */}
              <div className={isUser ? 'text-zinc-200' : 'text-zinc-300'}>
                {renderMessageContent(msg)}
              </div>

              {/* Tool call cards */}
              {msg.toolCalls?.map(tc => (
                <ToolCallCard key={tc.id} tc={tc} msgId={msg.id} />
              ))}
            </div>
          </div>
          );
        })}

        {/* Build complete notification */}
        {!isStreaming && (() => {
          const lastMsg = messages[messages.length - 1];
          const hasTools = messages.some(m => m.toolCalls?.length > 0);
          if (
            lastMsg?.role === 'assistant' &&
            hasTools &&
            lastMsg.content?.toLowerCase().includes('task complete') &&
            onOpenPreview
          ) {
            return (
              <div className="mx-3 mb-2 px-3 py-2 bg-indigo-950/30 border border-indigo-800/30 rounded-xl flex items-center gap-2">
                <span className="text-[11px] text-indigo-300 flex-1">
                  ✅ Build complete — Preview available
                </span>
                <button
                  onClick={onOpenPreview}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1 flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Open Preview
                </button>
              </div>
            );
          }
          return null;
        })()}

        {/* Streaming indicator — thin progress bar */}
        {isThinking && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
          <div className="px-3 py-2 border-t border-zinc-800/20">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <div className="flex-1 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500/50 animate-pulse rounded-full" style={{ width: '60%' }} />
              </div>
              <span>Agent is thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Agent mode toolbar */}
      <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-2 border-t border-zinc-800/20">
        {/* Mode pills: Chat | Plan | Agent */}
        <div className="flex items-center gap-0.5 bg-zinc-800/40 rounded-lg p-0.5">
          {[
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
                mode.id === 'plan' ? 'Plan only — no file changes'
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
        <form id="agent-input-form" onSubmit={sendMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              agentMode === 'plan' ? 'Ask for a plan...'
              : 'Ask agent to build, edit, or fix...'
            }
            disabled={isStreaming}
            className="flex-1 bg-zinc-800 border border-zinc-700/40 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="p-1.5 rounded-lg bg-red-600 hover:bg-red-500 transition-colors"
              title="Stop generation"
            >
              <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
