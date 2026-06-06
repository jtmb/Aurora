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
  codeMode,
  previewInfo
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
  const [agentMode, setAgentMode] = useState('plan');       // 'plan' | 'agent'
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('lmstudio');
  const [thinkingEffort, setThinkingEffort] = useState('high'); // 'low' | 'medium' | 'high'
  const [availableModels, setAvailableModels] = useState([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState(new Set());
  const [expandedToolIds, setExpandedToolIds] = useState(new Set());
  const [planTodos, setPlanTodos] = useState([]); // [{ id, text, done, dependsOn, complexity, phase, phaseNum }]
  const [workspaceAgentsMd, setWorkspaceAgentsMd] = useState(''); // AGENTS.md content for system prompt injection
  const planTodosRef = useRef(planTodos); // stays in sync for async loop access
  useEffect(() => { planTodosRef.current = planTodos; }, [planTodos]);
  const [planSummary, setPlanSummary] = useState('');
  const [planMessageId, setPlanMessageId] = useState(null); // id of the assistant message that contains the plan
  const modelDropdownRef = useRef(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editInput, setEditInput] = useState('');

  // ── Self-improving corpus + agent-learned skills ──
  const [corpusEntries, setCorpusEntries] = useState([]);
  const [skills, setSkills] = useState([]);
  const [showLearningsPanel, setShowLearningsPanel] = useState(false);
  const sessionErrorHashes = useRef(new Set()); // dedupe tool_error captures per session

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

  // Build PLAN.md content from parsed todos and summary
  const buildPlanMd = (todos, summary, userRequest) => {
    const lines = [
      `# Implementation Plan`,
      ``,
      `> **Request:** ${userRequest.slice(0, 200)}`,
      `> **Created:** ${new Date().toISOString()}`,
      `> **Tasks:** ${todos.length} total`,
      ``,
      `## Summary`,
      ``,
      summary || userRequest,
      ``,
      `## Tasks`,
      ``
    ];
    for (const t of todos) {
      const dep = t.dependsOn ? ` — *depends on: ${t.dependsOn}*` : '';
      const status = t.done ? 'x' : ' ';
      lines.push(`- [${status}] ${t.text}${dep}`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(`*This plan is the authoritative build specification. All tasks must be completed in order.*`);
    return lines.join('\n');
  };

  // Parse plan mode response into structured todo items (flat list, no phases)
  const parsePlanTodos = (content) => {
    const todos = [];
    let summary = '';

    // Extract summary text (between "### Summary" and "### Tasks")
    const summaryMatch = content.match(/###\s*Summary\s*\n([\s\S]*?)(?=\n###\s*Tasks|\n*$)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    // New format: - [ ] Create `path/file.ext`: description — *depends on: Task N*
    const newTaskRegex = /^\s*-\s*\[([ xX])\]\s+(.+)$/gm;
    let taskMatch;
    while ((taskMatch = newTaskRegex.exec(content)) !== null) {
      const rawText = taskMatch[2].trim();
      const done = taskMatch[1].toLowerCase() === 'x';

      // Extract depends-on annotation: — *depends on: Task N* or (depends on: Task N)
      const dependsMatch = rawText.match(/[—\-]\s*\*?\s*depends?\s+on:\s*(.+?)\*?\s*$/i);
      const text = dependsMatch
        ? rawText.slice(0, dependsMatch.index).replace(/\s*[—\-]\s*$/, '').trim()
        : rawText;

      todos.push({
        id: `plan_${todos.length}`,
        text,
        done,
        complexity: '🟢',
        phase: 'Tasks',
        phaseNum: 0,
        dependsOn: dependsMatch ? dependsMatch[1].trim() : null
      });
    }

    // Fallback: old phase-based format (backward compatibility)
    if (todos.length === 0) {
      const phaseRegex = /###\s*Phase\s*(\d+):\s*([^\n]+)\n([\s\S]*?)(?=\n###\s*Phase|$)/gi;
      let phaseMatch;
      while ((phaseMatch = phaseRegex.exec(content)) !== null) {
        const phaseNum = parseInt(phaseMatch[1]);
        const phaseName = phaseMatch[2].trim();
        const phaseContent = phaseMatch[3];
        const taskRegex = /^\s*-\s+(.+)$/gm;
        let tm;
        while ((tm = taskRegex.exec(phaseContent)) !== null) {
          let text = tm[1].trim();
          if (/^\d+\s+tasks?$/i.test(text)) continue;
          text = text.replace(/^[🟢🟡🔴]\s*/, '');
          const dependsMatch = text.match(/\*\s*depends on\s+(.+?)\*\s*$/i);
          todos.push({
            id: `plan_${todos.length}`,
            text: dependsMatch ? text.slice(0, dependsMatch.index).replace(/\s*—\s*$/, '').trim() : text,
            done: false,
            complexity: '🟢',
            phase: `${phaseNum}: ${phaseName}`,
            phaseNum,
            dependsOn: dependsMatch ? dependsMatch[1].trim() : null
          });
        }
      }
    }

    // Fallback: old flat checkbox format
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
          complexity: '🟢',
          phase: 'Plan',
          phaseNum: 0,
          dependsOn: dependsMatch ? dependsMatch[1].trim() : null
        });
      }
    }

    return { todos, summary };
  };

  // Flatten a file tree (from /api/workspace/[id]/tree) into a flat list of { name, path, type }
  const flattenTree = (node, parentPath = '') => {
    const results = [];
    if (!node) return results;
    if (Array.isArray(node)) {
      for (const child of node) {
        results.push(...flattenTree(child, parentPath));
      }
      return results;
    }
    const name = node.name || '';
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    results.push({ name, path: fullPath, type: node.type || 'file' });
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        results.push(...flattenTree(child, fullPath));
      }
    }
    return results;
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

  // Fetch workspace AGENTS.md for system prompt injection
  useEffect(() => {
    if (!workspaceId) { setWorkspaceAgentsMd(''); setCorpusEntries([]); setSkills([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'AGENTS.md' })
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setWorkspaceAgentsMd(data.content || '');
        } else if (!cancelled) {
          // AGENTS.md not found — try CLAUDE.md
          const res2 = await fetch(`/api/workspace/${workspaceId}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'CLAUDE.md' })
          });
          if (!cancelled && res2.ok) {
            const data2 = await res2.json();
            setWorkspaceAgentsMd(data2.content || '');
          } else if (!cancelled) {
            setWorkspaceAgentsMd('');
          }
        }
      } catch { if (!cancelled) setWorkspaceAgentsMd(''); }

      // Load corpus entries (per-workspace)
      let workspaceEntries = [];
      try {
        const cr = await fetch(`/api/workspace/${workspaceId}/corpus`);
        if (!cancelled && cr.ok) {
          const cd = await cr.json();
          workspaceEntries = cd.entries || [];
        }
      } catch { /* noop */ }

      // Load global corpus and merge (cross-workspace learnings persist across workspace deletions)
      try {
        const gr = await fetch('/api/corpus');
        if (!cancelled && gr.ok) {
          const gd = await gr.json();
          const seenHashes = new Set(workspaceEntries.map(e => e.hash));
          for (const e of (gd.entries || [])) {
            if (!seenHashes.has(e.hash)) {
              workspaceEntries.push(e);
              seenHashes.add(e.hash);
            }
          }
        }
      } catch { /* noop */ }
      setCorpusEntries(workspaceEntries);

      // Load skills
      try {
        const sr = await fetch(`/api/workspace/${workspaceId}/skills`);
        if (!cancelled && sr.ok) {
          const sd = await sr.json();
          setSkills(sd.skills || []);
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

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
      const restored = initialMessages.map(m => {
        const msg = {
          ...m,
          id: m.id || `restored_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          content: m.content || ''
        };
        // Detect plan messages: non-error assistant messages with ### Summary header
        if (!msg.isError && m.role === 'assistant' && m.content && /\n###\s*Summary\s*\n/.test(m.content)) {
          const { todos, summary } = parsePlanTodos(m.content);
          if (todos.length > 0) {
            msg.isPlanResult = true;
            // Set plan state from the last plan message found
            setPlanMessageId(msg.id);
            setPlanTodos(todos);
            setPlanSummary(summary);
          }
        }
        // Re-parse tool calls from persisted messages for tool card display
        if (!msg.isError && m.role === 'assistant' && m.content) {
          const toolCalls = parseToolCalls(m.content);
          if (toolCalls.length > 0) {
            msg.toolCalls = toolCalls.map((tc, i) => ({
              ...tc,
              id: `${msg.id}_tool_${i}`,
              status: 'done'
            }));
          }
        }
        return msg;
      });
      setMessages(restored);
    } else if (initialMessages && initialMessages.length === 0) {
      setMessages([]);
      setPlanTodos([]);
      setPlanSummary('');
      setPlanMessageId(null);
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
    const temp = thinkingEffort === 'high' ? 0.1 : thinkingEffort === 'low' ? 0.5 : 0.3;
    const extraParams = {};
    if (thinkingEffort === 'high') extraParams.extended_thinking = true;

    const controller = new AbortController();
    abortRef.current = controller;
    const TIMEOUT_MS = 60000;
    const timeoutId = setTimeout(() => controller.abort(new Error('Request timed out')), TIMEOUT_MS);

    let res;
    try {
      res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({ model, messages: conversation, temperature: temp, max_tokens: 4096, provider, stream: true, ...extraParams })
      });
    } finally {
      clearTimeout(timeoutId);
    }

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

  // Retry from user message: trim to that point and resubmit original text
  const handleUserRetry = (msgId) => {
    if (isStreaming) return;
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId);
      if (idx < 0) return prev;
      const trimmed = prev.slice(0, idx + 1);
      setTimeout(() => {
        setInput(prev[idx].content);
        setTimeout(() => {
          document.getElementById('agent-input-form')?.requestSubmit();
        }, 50);
      }, 50);
      return trimmed;
    });
  };

  // Start editing a user message inline
  const handleStartEdit = (msg) => {
    if (isStreaming) return;
    setEditingMessageId(msg.id);
    setEditInput(msg.content);
  };

  // Submit edited user message, trim from that point
  const handleEditSubmit = (msgId) => {
    if (!editInput.trim() || isStreaming) return;
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId);
      if (idx < 0) return prev;
      const trimmed = prev.slice(0, idx);
      setTimeout(() => {
        setInput(editInput.trim());
        setEditingMessageId(null);
        setEditInput('');
        setTimeout(() => {
          document.getElementById('agent-input-form')?.requestSubmit();
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

  // ── Conversation Compaction (token-aware, VS Code Copilot style) ──

  // Conservative heuristic: ~2.5 chars per token for code/English mix.
  // Slightly underestimates context window for safety margin.
  const estimateTokens = (text) => Math.ceil(text.length / 2.5);

  // Known context windows. Conservative values — actual windows may be larger.
  const getContextWindow = (model, provider) => {
    const m = (model || '').toLowerCase();
    const p = (provider || '').toLowerCase();
    // OpenAI models
    if (p === 'openai' || m.startsWith('gpt-')) {
      if (m.includes('gpt-4')) return 128000;
      if (m.includes('gpt-3.5')) return 16385;
      return 128000;
    }
    // Anthropic
    if (p === 'anthropic' || m.startsWith('claude-')) return 200000;
    // DeepSeek
    if (p === 'deepseek' || m.includes('deepseek')) return 65536;
    // Llama 3.1+ / 3.2+
    if (m.includes('llama-3.1') || m.includes('llama-3.2') || m.includes('llama3.1') || m.includes('llama3.2')) return 131072;
    // Qwen 2.5 / Qwen 3 (32K is standard, some have 128K but be conservative)
    if (m.includes('qwen')) return 32768;
    // Mixtral / Mistral
    if (m.includes('mixtral') || m.includes('mistral')) return 32768;
    // Gemma
    if (m.includes('gemma')) return 8192;
    // Phi
    if (m.includes('phi-') && m.includes('vision')) return 131072;
    if (m.includes('phi-')) return 32768;
    // LM Studio — model varies, default conservative
    if (p === 'lmstudio') return 32768;
    // Ollama local
    if (p === 'ollama') return 32768;
    // Unknown — assume 32K (modern minimum for local models)
    return 32768;
  };

  // Build a rich context summary that preserves all state the LLM needs to continue.
  // Flat task list format (Copilot-style) — no phases, just ordered tasks.
  const buildCompactSummary = (iter, fileManifest, todos, originalRequest, executionErrors) => {
    const doneCount = todos.filter(t => t.done).length;
    const totalCount = todos.length || 0;

    const taskLines = todos.map(t => {
      const icon = t.done ? '[x]' : '[ ]';
      return `${icon} ${t.text}${t.dependsOn ? ` (depends on: ${t.dependsOn})` : ''}`;
    });

    const pendingTodos = todos.filter(t => !t.done);
    const nextTask = pendingTodos[0];
    const nextTaskLine = nextTask ? `NEXT TASK: ${nextTask.text}` : 'ALL TASKS COMPLETE!';

    const createdFiles = fileManifest.filter(f => f.action === 'created');
    const modifiedFiles = fileManifest.filter(f => f.action === 'modified');

    const fileLines = [];
    if (createdFiles.length > 0) {
      fileLines.push('CREATED:');
      for (const f of createdFiles) {
        fileLines.push(`  ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}`);
      }
    }
    if (modifiedFiles.length > 0) {
      fileLines.push('MODIFIED:');
      for (const f of modifiedFiles) {
        fileLines.push(`  ${f.path}${f.purpose ? ` — ${f.purpose}` : ''}`);
      }
    }

    const errorLines = executionErrors.length > 0
      ? ['\nRECENT ERRORS:', ...executionErrors.slice(-3).map(e => `  ⚠️ ${e}`)]
      : [];

    return [
      `[CONTEXT SUMMARY — Step ${iter + 1}]`,
      '',
      'ORIGINAL TASK:',
      originalRequest.slice(0, 500),
      '',
      `PROGRESS: ${doneCount}/${totalCount} tasks completed`,
      nextTaskLine,
      '',
      'ALL TASKS:',
      ...taskLines,
      '',
      'FILES:',
      ...(fileLines.length > 0 ? fileLines : ['  (none yet)']),
      ...errorLines,
      '',
      'Work through tasks IN ORDER. Complete the NEXT TASK with a tool call NOW.',
      'Files listed above already exist — do NOT recreate them unless you need to modify them.',
    ].join('\n');
  };

  // ── Self-improving corpus: fire-and-forget problem capture ──
  // Posts friction events (build failures, stuck loops, etc.) to the corpus API
  // without blocking the agent loop. Dedupes per-session for tool_error types.
  const captureProblem = useCallback((type, problem, context = '', resolution = '') => {
    if (!workspaceId) return;
    const body = JSON.stringify({ type, problem, context, resolution });

    // Dedupe tool_error per session (same file+error hash)
    if (type === 'tool_error') {
      const key = `${context}|${problem}`;
      if (sessionErrorHashes.current.has(key)) return;
      sessionErrorHashes.current.add(key);
    }

    // Fire-and-forget — do NOT await
    fetch(`/api/workspace/${workspaceId}/corpus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).catch(() => {});

    // Also post to global corpus for cross-project learning
    fetch('/api/corpus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, problem, context, resolution, workspaceId })
    }).catch(() => {});
  }, [workspaceId]);

  // Fire-and-forget mark a previously-captured problem as resolved
  const markProblemResolved = useCallback((entryId, resolution) => {
    if (!workspaceId || !entryId) return;
    fetch(`/api/workspace/${workspaceId}/corpus`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, resolution })
    }).catch(() => {});
  }, [workspaceId]);

  // ── Skill auto-extraction prompt ──
  const buildSkillExtractionPrompt = (originalRequest, fileManifest, planTodos, buildPassed) => {
    const files = fileManifest.map(f => `${f.action} ${f.path}`).join('\n');
    const tasksDone = planTodos.filter(t => t.done).map(t => t.text).join('\n');
    return [
      `You just completed a build task. Review the following and determine if any REUSABLE PATTERN was demonstrated that should be saved as a skill.`,
      ``,
      `Original request: ${originalRequest.slice(0, 300)}`,
      ``,
      `Files affected:`,
      files || '(none)',
      ``,
      `Tasks completed:`,
      tasksDone || '(none)',
      ``,
      `If you found a reusable pattern, respond with EXACTLY ONE code block:`,
      `\`\`\`create_skill name="Skill Name" description="What it does" keywords="keyword1, keyword2"`,
      `Markdown instructions for reproducing this pattern...`,
      `\`\`\``,
      ``,
      `If nothing is worth saving, respond with exactly: NO_SKILL`,
    ].join('\n');
  };

  // AGENTIC LOOP: send message, parse tools, execute, feed results back to LLM, repeat
  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userContent = input.trim();
    setInput('');
    setIsStreaming(true);
    setIsThinking(true);

    // Detecting plan execution from the message is definitive — it works even if
    // React hasn't flushed setAgentMode('agent') yet (race condition with setTimeout).
    const isPlanExecution = userContent.startsWith('Execute the following plan');

    // Preserve plan todos when executing a plan (progress tracker)
    if (!isPlanExecution) {
      setPlanTodos([]);
      setPlanSummary('');
      setPlanMessageId(null);
    }

    const turnId = `turn_${++turnCounterRef.current}`;
    const userMsg = {
      id: `agent_user_${Date.now()}`, role: 'user', content: userContent,
      timestamp: new Date().toISOString(), turnId
    };
    setMessages(prev => [...prev, userMsg]);

    // Persist user message
    saveMessageToChat('user', userContent, selectedModel, selectedProvider, userMsg.id, userMsg.timestamp);

    let systemPrompt = buildSystemPrompt(workspaceId, activeFilePath, currentFileContent,
      isPlanExecution ? 'agent' : agentMode);

    // Inject plan into system prompt so the model ALWAYS knows what remains.
    // Flat task list format (Copilot-style) — no phases, just ordered tasks.
    if ((isPlanExecution || agentMode === 'agent') && planTodosRef.current.length > 0) {
      const todos = planTodosRef.current;
      const doneCount = todos.filter(t => t.done).length;
      const pending = todos.filter(t => !t.done);
      const nextTask = pending[0];

      let planBlock = `\n\n=== BUILD PLAN (${doneCount}/${todos.length} done) ===\n`;
      for (const t of todos) {
        planBlock += `${t.done ? '[x]' : '[ ]'} ${t.text}\n`;
      }
      planBlock += `\n`;
      if (nextTask) {
        planBlock += `NEXT TASK: ${nextTask.text}\n`;
        planBlock += `You MUST complete THIS task before any other. Use a tool call NOW.\n`;
      }
      planBlock += `CRITICAL: Work on tasks IN ORDER. Do NOT skip or reorder.\n`;
      planBlock += `After EVERY file write (create_file / replace_string_in_file), you MUST output a line like:\n`;
      planBlock += `  [x] Task description from the plan\n`;
      planBlock += `This marks progress. The system tracks [x] lines. Without them, progress shows 0.\n`;
      planBlock += `Do NOT stop until ALL tasks show [x]. If you think you're done but tasks remain, you are WRONG — keep going.\n`;
      systemPrompt = systemPrompt + planBlock;
    }

    // In agent mode, wrap the user message with FORCEFUL instructions
    let effectiveUserContent = userContent;
    let prefillMessages = [];
    if (isPlanExecution || agentMode === 'agent') {
      // ── FRAMEWORK DETECTION: if no framework specified, default to Next.js ──
      const frameworkKeywords = /\b(next\.?js|nextjs|next\s*16|react|vue|angular|svelte|express|django|flask|fastapi|rails|laravel|static html|plain html|html only|vanilla js|python|go|rust|sveltekit|nuxt|remix|astro|gatsby|vite)\b/i;
      const frameworkHint = frameworkKeywords.test(userContent) ? '' : '\n\nTECH STACK: Build this as a Next.js 16 + TypeScript + Tailwind CSS v3 project. Create files in the app/ directory (App Router). Do NOT use plain HTML.';

      effectiveUserContent = `USER REQUEST: ${userContent}${frameworkHint}

IMPORTANT: You are in AGENT MODE. DO NOT describe what you'll do.
DO NOT ask questions. DO NOT explain your plan. ACT NOW.
Use a TOOL CALL immediately. The workspace may be empty — create ALL needed files yourself.
If you need to see what exists, use list_dir first.`;

// On first turn in agent mode, add extra format guidance to the user message
      if (messages.length === 0) {
        effectiveUserContent = `USER REQUEST: ${userContent}${frameworkHint}

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

    // When executing a plan, start with a fresh conversation.
    // Old plan-mode messages contain restrictive rules ("NEVER use write/modify tools",
    // "Only use read_file, list_dir, grep_search") that confuse the model in agent mode.
    const contextMessages = isPlanExecution ? [] : messages.map(m => ({ role: m.role, content: m.content }));

    // ── Agent mode: auto-generate plan before execution (Copilot-style Plan → Agent) ──
    // Only when operating in pure Agent mode (not plan execution) and we don't have a plan yet.
    if (!isPlanExecution && agentMode === 'agent' && planTodosRef.current.length === 0) {
      setIsThinking(true);
      // Show a plan-generation status message
      const planGenId = `agent_plan_gen_${Date.now()}`;
      setMessages(prev => [...prev, {
        id: planGenId,
        role: 'assistant',
        content: 'Generating implementation plan...',
        isPlanGeneration: true,
        timestamp: new Date().toISOString(),
        turnId
      }]);
      try {
        // ── Framework detection for plan generation ──
        const fwKeywords = /\b(next\.?js|nextjs|next\s*16|react|vue|angular|svelte|express|django|flask|fastapi|rails|laravel|static html|plain html|html only|vanilla js|python|go|rust|sveltekit|nuxt|remix|astro|gatsby|vite)\b/i;
        const fwHint = fwKeywords.test(userContent) ? '' : ' DEFAULT STACK: Use Next.js 16 + TypeScript + Tailwind CSS v3 with app/ directory (App Router) unless specified otherwise. Plan files like package.json, tsconfig.json, app/layout.tsx, app/page.tsx, app/globals.css, tailwind.config.js, postcss.config.js.';
        const planConv = [
          { role: 'system', content: `You are a planning assistant. Given a user request, produce a structured implementation plan as a flat ordered checklist.${fwHint}

Output format — ONLY this, nothing else:
\`\`\`
1. [ ] Task description (brief, actionable)
2. [ ] Task description
...
\`\`\`

RULES:
- Each task must be a SINGLE concrete action (create file, install dep, add route, etc.)
- Tasks must be in execution ORDER (dependencies first)
- 5-15 tasks total
- No multi-step tasks — one action per task
- No "configure" or "set up" tasks — be specific about what files to create/modify
- Include build/dev server task at the end
- **⚠️ FILE CREATION**: All files MUST be created using the create_file tool. NEVER use shell commands (mkdir, touch, cat >, echo >). NEVER combine mkdir + touch in one task — split into separate create_file tasks. Each file is its own task.
- NO text outside the code block. NO explanations.` },
          { role: 'user', content: userContent.slice(0, 2000) }
        ];
        const { content: planContent } = await streamLLMCall(planConv, 'Planning', turnId);
        const { todos, summary } = parsePlanTodos(planContent);
        if (todos.length > 0) {
          setPlanTodos(todos);
          planTodosRef.current = todos;
          setPlanSummary(summary);
          setPlanMessageId(planGenId);
          // Replace the loading message with the actual plan
          setMessages(prev => prev.map(m =>
            m.id === planGenId
              ? { ...m, content: `**Implementation Plan**\n\n${todos.map((t, i) => `${i + 1}. [ ] ${t.text}`).join('\n')}`, isPlanCard: true }
              : m
          ));
        } else {
          // Plan generation failed — remove the dummy message and proceed anyway
          setMessages(prev => prev.filter(m => m.id !== planGenId));
        }
      } catch {
        setMessages(prev => prev.filter(m => m.id !== planGenId));
      }
    }

    let conversation = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
      ...prefillMessages,
      { role: 'user', content: effectiveUserContent }
    ];

    const MAX_ITERATIONS = 50;
    const originalRequest = userContent.slice(0, 500); // preserved across compactions
    let checkpointTaken = false;
    let compactedAt = -1; // track last compaction step to avoid compacting too frequently
    let noToolStreak = 0; // break if model refuses tools 3x in a row with pending tasks
    let planCompleted = false;   // plan mode finished — skip post-loop summary
    let buildAttempted = false;   // track whether model has tried dev_server_start or build command
    let buildVerificationRetries = 0; // avoid infinite injection loop
    let barrenStreak = 0; // iterations without any file writes — break if too high
    const fileManifest = []; // { path, action: 'created'|'modified', purpose }
    const executionErrors = []; // recent error messages for compaction summary
    const recentToolCalls = []; // [{ name, filePath }] for stuck detection
    const recentToolResults = []; // [{ name, summary }] for repeated-result detection

    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const label = iter > 0 ? `Step ${iter + 1}` : null;
        const { content: rawContent, thinking, assistantId } = await streamLLMCall(conversation, label, turnId);
        conversation.push({ role: 'assistant', content: rawContent });

        // Parse plan todos in plan mode (NOT during plan execution)
        if (!isPlanExecution && agentMode === 'plan' && iter === 0) {
          const { todos, summary } = parsePlanTodos(rawContent);
          if (todos.length > 0) {
            setPlanTodos(todos);
            planTodosRef.current = todos;
            setPlanSummary(summary);
            setPlanMessageId(assistantId);
            // Mark message so renderer hides raw content
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, isPlanResult: true } : m
            ));

            // Write PLAN.md to workspace (authoritative plan file, Copilot-style)
            try {
              const planMdContent = buildPlanMd(todos, summary, originalRequest);
              await executeCreateFile(workspaceId, 'PLAN.md', planMdContent);
            } catch (err) {
              console.warn('[Agent] Failed to write PLAN.md:', err.message);
            }

            // Plan is complete — stop the loop.
            // Execution will happen when the user clicks "Execute Plan".
            planCompleted = true;
            break;
          }
        }

        // Parse tool calls from the response
        // Extract natural-language purpose (text before first tool block) for compaction summary
        const purposeMatch = rawContent.match(/^([\s\S]*?)```/);
        const stepPurpose = purposeMatch ? purposeMatch[1].trim().slice(0, 100) : '';
        const toolCalls = parseToolCalls(rawContent);
        // Agent is done with tools — but check if plan has remaining tasks
        if (toolCalls.length === 0) {
          const stillPending = planTodosRef.current.filter(t => !t.done);
          if (stillPending.length > 0) {
            noToolStreak++;
            if (noToolStreak >= 3) {
              captureProblem('no_tool_streak',
                'Model stopped producing tool calls 3x with pending tasks remaining',
                `Pending: ${stillPending.map(t => t.text).join('; ')}`
              );
              // Run build verification if files were created before giving up
              if (fileManifest.length > 0 && !buildAttempted) {
                const bvResult = await runBuildVerification();
                if (bvResult === 'built') break;
              }
              break;
            }
            const nextTask = stillPending[0];
            const pendingList = stillPending.map(t => `- [ ] ${t.text}`).join('\n');
            conversation.push({
              role: 'user',
              content: `You stopped but tasks remain. Your NEXT task is: ${nextTask.text}\n\nAll pending tasks:\n${pendingList}\n\nComplete the NEXT task NOW with a tool call. Do NOT respond without a tool call.`
            });
            continue; // Keep looping — don't break
          }

          // ── Programmatic build pipeline (also called from AbortError catch) ──
          const runBuildVerification = async () => {
            if (buildVerificationRetries >= 3) return false;
            buildVerificationRetries++;
            // Check for package.json — static projects just need a dev server
            let hasPackageJson = false;
            let allFiles = [];
            try {
              const treeRes = await fetch(`/api/workspace/${workspaceId}/tree?depth=3`);
              const treeData = treeRes.ok ? await treeRes.json() : null;
              allFiles = treeData?.tree ? flattenTree(treeData.tree) : [];
              hasPackageJson = allFiles.some(f => (f.name || f) === 'package.json');
            } catch {}
            if (!hasPackageJson) {
              buildAttempted = true;
              try { const dr = await executeDevServerStart(workspaceId, null); if (dr?.running && onOpenPreview) onOpenPreview(); } catch {}
              return 'built';
            }
            // ── Hallucination audit: verify every claimed created file exists on disk ──
            const existingPaths = new Set(allFiles.map(f => f.path || f.name || ''));
            const missingFiles = fileManifest
              .filter(f => f.action === 'created')
              .filter(f => !existingPaths.has(f.path))
              .map(f => f.path);
            if (missingFiles.length > 0) {
              const mfList = missingFiles.join(', ');
              captureProblem('tool_error',
                `Hallucinated files: ${missingFiles.length} files in manifest do not exist on disk`,
                `Missing: ${mfList}`
              );
              conversation.push({
                role: 'user',
                content: `⚠️ HALLUCINATION DETECTED: You claimed to create these files but they do NOT exist on disk:\n${missingFiles.map(f => `  - ${f}`).join('\n')}\n\nRe-create ALL missing files NOW with their full content. Then respond without tool calls to retry the build.`
              });
              buildAttempted = false;
              return 'retry';
            }
            // ── Pre-build content audit: scan files for known bad patterns BEFORE running build ──
            let preBuildAuditErrors = [];
            try {
              // Read package.json to detect tech stack
              let pkg = {};
              const allFilePaths = allFiles.map(f => f.path || f.name || '');
              const pkgPath = allFilePaths.find(p => p === 'package.json' || p.endsWith('/package.json'));
              if (pkgPath) {
                try {
                  const pkgRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: pkgPath })
                  });
                  if (pkgRes.ok) {
                    const pd = await pkgRes.json();
                    try { pkg = JSON.parse(pd.content || '{}'); } catch {}
                  }
                } catch {}
              }
              const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
              const depNames = Object.keys(deps);
              const hasTailwind3 = depNames.includes('tailwindcss') && (deps.tailwindcss || '').startsWith('^3');
              const hasTailwindAny = depNames.includes('tailwindcss');

              // Check 1: Tailwind v3 without postcss.config
              if (hasTailwind3 || (hasTailwindAny && depNames.includes('postcss'))) {
                const hasPostcssConfig = allFiles.some(f => {
                  const n = (f.name || f.path || '').toLowerCase();
                  return ['postcss.config.js','postcss.config.mjs','postcss.config.cjs'].includes(n);
                });
                if (!hasPostcssConfig) {
                  preBuildAuditErrors.push('MISSING FILE: postcss.config.mjs — Tailwind v3 requires it with "tailwindcss" and "autoprefixer" as PostCSS plugins. Create it with: export default { plugins: { tailwindcss: {}, autoprefixer: {} } }');
                }
              }

              // Check 2: globals.css or any .css file with v4 @import syntax when Tailwind v3 is installed
              if (hasTailwind3) {
                const cssFiles = allFiles.filter(f => (f.name || f.path || '').endsWith('.css'));
                for (const cssFile of cssFiles.slice(0, 3)) {
                  try {
                    const fp = cssFile.path || cssFile.name;
                    const cssRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ filePath: fp })
                    });
                    if (cssRes.ok) {
                      const cd = await cssRes.json();
                      const content = cd.content || '';
                      if (/@import\s+["']tailwindcss["']/.test(content)) {
                        preBuildAuditErrors.push(`WRONG SYNTAX in ${fp}: uses @import "tailwindcss" (Tailwind v4 syntax) but Tailwind v3 is installed. Replace with:\n@tailwind base;\n@tailwind components;\n@tailwind utilities;`);
                      }
                    }
                  } catch {}
                }
              }

              // Check 3: missing tailwind.config when tailwind v3 is used
              if (hasTailwind3) {
                const hasTailwindConfig = allFiles.some(f => {
                  const n = (f.name || f.path || '').toLowerCase();
                  return ['tailwind.config.js','tailwind.config.mjs','tailwind.config.ts'].includes(n);
                });
                if (!hasTailwindConfig) {
                  preBuildAuditErrors.push('MISSING FILE: tailwind.config.js — Tailwind v3 requires it to scan source files for class names. Create it with content scanning "./app/**/*.{js,ts,jsx,tsx}"');
                }
              }

              // Check 4: "next": "latest" or unpinned
              if (deps.next === 'latest' || deps.next === '*') {
                preBuildAuditErrors.push('BAD VERSION: "next": "latest" — pin to a specific version like "^15.0.3"');
              }

              // Check 4.5: Missing critical Next.js App Router files
              // These are REQUIRED for the app to build — their absence will cause PageNotFoundError
              if (depNames.includes('next')) {
                const requiredFiles = ['app/page.tsx', 'app/page.jsx', 'src/app/page.tsx', 'src/app/page.jsx'];
                const layoutFiles = ['app/layout.tsx', 'app/layout.jsx', 'src/app/layout.tsx', 'src/app/layout.jsx'];
                const hasPage = requiredFiles.some(rf => allFiles.some(f => (f.path || f.name || '') === rf));
                const hasLayout = layoutFiles.some(lf => allFiles.some(f => (f.path || f.name || '') === lf));
                if (!hasPage) {
                  preBuildAuditErrors.push('MISSING FILE: app/page.tsx — Next.js App Router requires a root page. Create app/page.tsx with a default export component.');
                }
                if (!hasLayout) {
                  preBuildAuditErrors.push('MISSING FILE: app/layout.tsx — Next.js App Router requires a root layout. Create app/layout.tsx with default export wrapping children in <html> and <body>.');
                }
                // Also check for Pages Router files accidentally in app/ directory
                const docFiles = allFiles.filter(f => {
                  const n = (f.name || f.path || '').toLowerCase();
                  return n === 'app/_document.tsx' || n === 'app/_document.jsx' || n === 'src/app/_document.tsx';
                });
                if (docFiles.length > 0) {
                  preBuildAuditErrors.push(`WRONG FILE: ${docFiles[0].path || docFiles[0].name} — _document is a Pages Router concept. In App Router, use app/layout.tsx instead. DELETE this file.`);
                }
              }

              // Check 5: missing 'use client' in files using client features
              // ALWAYS scan — any Next.js project can have components needing 'use client'
              const tsxFiles = allFiles.filter(f => {
                const n = (f.name || f.path || '');
                return n.endsWith('.tsx') || n.endsWith('.jsx');
              });
              for (const tsxFile of tsxFiles.slice(0, 10)) {
                try {
                  const fp = tsxFile.path || tsxFile.name;
                  const tsxRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: fp })
                  });
                  if (tsxRes.ok) {
                    const cd = await tsxRes.json();
                    const content = cd.content || '';
                    const firstLine = content.trim().split('\n')[0] || '';
                    const hasUseClient = /^["']use client["']/.test(firstLine);
                    const usesClientFeatures = /\b(useState|useEffect|useRef|useCallback|useMemo|onClick\b|onChange\b|onSubmit\b|addEventListener|window\.|document\.|localStorage|sessionStorage|motion\.|AnimatePresence|framer-motion)\b/.test(content);
                    if (usesClientFeatures && !hasUseClient) {
                      preBuildAuditErrors.push(`MISSING DIRECTIVE: "${fp}" uses client features (hooks, event handlers, browser APIs, or framer-motion) but lacks "use client" at the top of the file`);
                    }
                  }
                } catch {}
              }
            } catch (auditErr) { console.error('[pre-build-audit] Error:', auditErr); }

            // If pre-build audit found violations, inject them as errors BEFORE build attempt
            if (preBuildAuditErrors.length > 0) {
              captureProblem('pre_build_audit',
                `Pre-build audit found ${preBuildAuditErrors.length} violation(s)`,
                preBuildAuditErrors.join('\n').slice(0, 500)
              );
              conversation.push({
                role: 'user',
                content: `⚠️ PRE-BUILD AUDIT found ${preBuildAuditErrors.length} problem(s) that WILL cause build or runtime failures. Fix ALL of these with tools, then respond without tool calls to retry:\n\n${preBuildAuditErrors.map((e, i) => `${i + 1}. ${e}`).join('\n\n')}`
              });
              buildAttempted = false;
              return 'retry';
            }

            // ── Stop any running dev server first (we'll restart after build passes) ──
            try {
              const r = await fetch(`/api/workspace/${workspaceId}/dev-server`, { method: 'GET' });
              if (r.ok) {
                const ds = await r.json();
                if (ds?.running) {
                  try { await fetch(`/api/workspace/${workspaceId}/dev-server`, { method: 'DELETE' }); } catch {}
                }
              }
            } catch {}
            // ── Run npm install ──
            let buildLog = '';
            try {
              const ir = await executeRunInTerminal(workspaceId, 'npm install --legacy-peer-deps');
              if (!ir.success) buildLog += `[npm install] FAILED:\n${ir.stderr || ir.stdout || 'Unknown'}\n`;
            } catch (err) { buildLog += `[npm install] Error: ${err.message}\n`; }
            // ── Run build ──
            if (!buildLog) {
              try {
                // Detect build command: check for next.config, vite.config, etc.
                let buildCmd = 'npm run build';
                try {
                  const treeRes = await fetch(`/api/workspace/${workspaceId}/tree?depth=1`);
                  const treeData = treeRes.ok ? await treeRes.json() : null;
                  const files = treeData?.tree ? flattenTree(treeData.tree) : [];
                  const fileNames = files.map(f => f.name || f);
                  if (fileNames.some(n => n === 'next.config.js' || n === 'next.config.mjs' || n === 'next.config.ts')) {
                    buildCmd = 'npx next build';
                  } else if (fileNames.some(n => n === 'vite.config.js' || n === 'vite.config.ts')) {
                    buildCmd = 'npx vite build';
                  }
                } catch {}
                const br = await executeRunInTerminal(workspaceId, buildCmd);
                if (!br.success) buildLog += `[${buildCmd}] FAILED:\n${(br.stderr || br.stdout || '').slice(0, 2000)}\n`;
              } catch (err) { buildLog += `[build] Error: ${err.message}\n`; }
            }
            if (buildLog) {
              captureProblem('build_failure',
                `Build failed on attempt ${buildVerificationRetries}/3`,
                buildLog.slice(0, 500)
              );

              // ── AUTO-FIX ENGINE: parse build errors & try to fix them programmatically ──
              const autoFixes = [];
              const autoFixErrors = [];

              // Pattern 1: "Event handlers cannot be passed to Client Component props"
              // Extract file path and add 'use client' directive
              const evtHandlerMatch = buildLog.match(/Error: Event handlers cannot be passed to Client Component props[\s\S]*?\{onClick:/);
              if (evtHandlerMatch) {
                // The error references the parent component — find it in the tree
                const errorContext = buildLog.slice(buildLog.indexOf('Event handlers'), buildLog.indexOf('Event handlers') + 2000);
                // Look for import paths in the error: "Import trace for requested module:"
                const importTrace = errorContext.match(/Import trace for requested module:[\s\S]*?\.\/(\S+)/);
                const traceFiles = [...(errorContext.match(/\.\/(\S+\.(?:tsx|jsx))/g) || [])];
                // Also parse "Export encountered an error on /page: /"
                const pageMatch = errorContext.match(/Export encountered an error on (?:\/page:\s*)?\/?([\w\-.]+)/);
                if (pageMatch || traceFiles.length > 0) {
                  // The file that needs 'use client' is the first in the import trace
                  // or the page file
                  const candidateFiles = traceFiles.map(f => f.replace(/^\.\//, ''));
                  if (pageMatch && pageMatch[1]) candidateFiles.push(`${pageMatch[1]}.tsx`);
                  // Also check src/app patterns
                  const srcMatches = [...(errorContext.match(/src\/\S+\.(?:tsx|jsx)/g) || [])];
                  candidateFiles.push(...srcMatches);

                  for (const cf of candidateFiles.slice(0, 5)) {
                    try {
                      // Try to read the file — if it exists and lacks 'use client', add it
                      const readRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: cf })
                      });
                      if (readRes.ok) {
                        const fileData = await readRes.json();
                        const fc = fileData.content || '';
                        if (!/^["']use client["']/.test(fc.trim())) {
                          const fixedContent = '"use client";\n' + fc;
                          await fetch(`/api/workspace/${workspaceId}/write`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: cf, content: fixedContent })
                          });
                          autoFixes.push(`Added "use client" directive to ${cf}`);
                        }
                      }
                    } catch (e) { autoFixErrors.push(`${cf}: ${e.message}`); }
                  }
                }
                // If no trace files found, try the manifest files
                if (autoFixes.length === 0) {
                  const tsxFiles = fileManifest.filter(f => (f.path || '').endsWith('.tsx') || (f.path || '').endsWith('.jsx'));
                  for (const mf of tsxFiles.slice(0, 5)) {
                    try {
                      const readRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: mf.path })
                      });
                      if (readRes.ok) {
                        const fileData = await readRes.json();
                        const fc = fileData.content || '';
                        const hasOnClick = /\bonClick\b/.test(fc);
                        const hasUseClient = /^["']use client["']/.test(fc.trim());
                        if (hasOnClick && !hasUseClient) {
                          const fixedContent = '"use client";\n' + fc;
                          await fetch(`/api/workspace/${workspaceId}/write`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: mf.path, content: fixedContent })
                          });
                          autoFixes.push(`Added "use client" directive to ${mf.path}`);
                        }
                      }
                    } catch (e) { autoFixErrors.push(`${mf.path}: ${e.message}`); }
                  }
                }
              }

              // Pattern 2: "You're importing a component that needs useState" or similar
              const needsHookMatch = buildLog.match(/You're importing a component that needs (useState|useEffect|useRef|useCallback|useMemo)/);
              if (needsHookMatch && autoFixes.length === 0) {
                // Similar to pattern 1 — add 'use client' to files with hooks
                const tsxFiles = fileManifest.filter(f => (f.path || '').endsWith('.tsx') || (f.path || '').endsWith('.jsx'));
                for (const mf of tsxFiles.slice(0, 5)) {
                  try {
                    const readRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ filePath: mf.path })
                    });
                    if (readRes.ok) {
                      const fileData = await readRes.json();
                      const fc = fileData.content || '';
                      const usesHooks = /\b(useState|useEffect|useRef|useCallback|useMemo)\b/.test(fc);
                      const hasUseClient = /^["']use client["']/.test(fc.trim());
                      if (usesHooks && !hasUseClient) {
                        const fixedContent = '"use client";\n' + fc;
                        await fetch(`/api/workspace/${workspaceId}/write`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: mf.path, content: fixedContent })
                        });
                        autoFixes.push(`Added "use client" directive to ${mf.path} (needs hooks)`);
                      }
                    }
                  } catch (e) { autoFixErrors.push(`${mf.path}: ${e.message}`); }
                }
              }

              // Pattern 3: Tailwind v4 @import syntax when v3 is installed
              const tailwindV4ImportMatch = buildLog.match(/@import\s+["']tailwindcss["']/);
              if (tailwindV4ImportMatch) {
                const cssFiles = fileManifest.filter(f => (f.path || '').endsWith('.css'));
                for (const cf of cssFiles.slice(0, 3)) {
                  try {
                    const readRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ filePath: cf.path })
                    });
                    if (readRes.ok) {
                      const fileData = await readRes.json();
                      const fc = fileData.content || '';
                      if (/@import\s+["']tailwindcss["']/.test(fc)) {
                        const fixedContent = fc.replace(
                          /@import\s+["']tailwindcss["']\s*;?/g,
                          '@tailwind base;\n@tailwind components;\n@tailwind utilities;'
                        );
                        await fetch(`/api/workspace/${workspaceId}/write`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: cf.path, content: fixedContent })
                        });
                        autoFixes.push(`Replaced @import "tailwindcss" with @tailwind directives in ${cf.path}`);
                      }
                    }
                  } catch (e) { autoFixErrors.push(`${cf.path}: ${e.message}`); }
                }
              }

              // Pattern 4: Missing postcss.config with tailwindcss dependency
              if (/Module not found.*autoprefixer|Error:.*PostCSS plugin.*tailwindcss.*requires.*autoprefixer|Cannot find module.*autoprefixer/i.test(buildLog)) {
                // Create postcss.config.mjs if missing
                try {
                  const postcssPath = 'postcss.config.mjs';
                  const postcssContent = 'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n';
                  await fetch(`/api/workspace/${workspaceId}/write`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: postcssPath, content: postcssContent })
                  });
                  autoFixes.push('Created missing postcss.config.mjs');
                } catch (e) { autoFixErrors.push(`postcss.config.mjs: ${e.message}`); }
              }

              // Pattern 5: _document.tsx in App Router — Pages Router file that breaks App Router builds
              if (/Cannot find module for page: \/_document|PageNotFoundError.*_document/i.test(buildLog)) {
                try {
                  // Delete the _document.tsx from app/ directory
                  const delRes = await fetch(`/api/workspace/${workspaceId}/file`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: 'app/_document.tsx' })
                  }).catch(() => null);
                  // Also try other possible locations
                  const altPaths = ['src/app/_document.tsx', '_document.tsx'];
                  for (const alt of altPaths) {
                    try {
                      await fetch(`/api/workspace/${workspaceId}/file`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: alt })
                      });
                    } catch {}
                  }
                  if (delRes?.ok) {
                    autoFixes.push('Deleted app/_document.tsx — Pages Router file that breaks App Router builds. Use app/layout.tsx instead.');
                  } else {
                    autoFixes.push('Detected _document.tsx error — deleted conflicting file. Use app/layout.tsx for App Router.');
                  }
                  // Also remove from fileManifest
                  const docIdx = fileManifest.findIndex(f => (f.path || '').includes('_document'));
                  if (docIdx >= 0) fileManifest.splice(docIdx, 1);
                } catch (e) { autoFixErrors.push(`_document cleanup: ${e.message}`); }
              }

              // Pattern 6: Missing page.tsx / page.jsx — model didn't create the main page file
              if (/Cannot find module for page: \/|PageNotFoundError.*page/i.test(buildLog)) {
                // Create a minimal page.tsx as fallback
                const pagePath = 'app/page.tsx';
                try {
                  // First check if page.tsx already exists (might be in wrong directory)
                  const checkRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath: pagePath })
                  });
                  if (!checkRes.ok) {
                    // Create a minimal hero page that matches common patterns
                    const fallbackContent = `"use client";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome</h1>
      <p className="mt-4 text-lg text-gray-600">This page was auto-generated as a fallback.</p>
    </main>
  );
}
`;
                    await fetch(`/api/workspace/${workspaceId}/write`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ path: pagePath, content: fallbackContent })
                    });
                    autoFixes.push('Created fallback app/page.tsx — original page was missing');
                    fileManifest.push({ path: pagePath, action: 'created', purpose: 'Auto-generated fallback page' });
                  }
                } catch (e) { autoFixErrors.push(`page.tsx fallback: ${e.message}`); }
              }

              // ── If auto-fixes were applied, re-run build immediately ──
              if (autoFixes.length > 0) {
                captureProblem('auto_fix',
                  `Auto-fixed ${autoFixes.length} build error(s)`,
                  autoFixes.join('; ') + (autoFixErrors.length ? ` Errors: ${autoFixErrors.join('; ')}` : ''),
                  'Applied automatically by auto-heal engine'
                );
                // Re-run build (don't count as new retry attempt since it's part of this attempt)
                let retryLog = '';
                try {
                  let buildCmd = 'npm run build';
                  try {
                    const treeRes = await fetch(`/api/workspace/${workspaceId}/tree?depth=1`);
                    const treeData = treeRes.ok ? await treeRes.json() : null;
                    const files = treeData?.tree ? flattenTree(treeData.tree) : [];
                    const fileNames = files.map(f => f.name || f);
                    if (fileNames.some(n => n === 'next.config.js' || n === 'next.config.mjs' || n === 'next.config.ts')) {
                      buildCmd = 'npx next build';
                    }
                  } catch {}
                  const br = await executeRunInTerminal(workspaceId, buildCmd);
                  if (!br.success) retryLog = `[${buildCmd}] STILL FAILED after auto-fix:\n${(br.stderr || br.stdout || '').slice(0, 1500)}`;
                } catch (err) { retryLog = `[build retry] Error: ${err.message}`; }

                if (!retryLog) {
                  // Auto-fix SUCCEEDED — build passed!
                  captureProblem('build_failure', 'Build passed after auto-fix', autoFixes.join('; '), 'Auto-fixed by engine');
                  // Fall through to build-succeeded path below
                  buildLog = ''; // Clear build log so we proceed to success
                } else {
                  // Auto-fix didn't work — tell the model with remaining errors
                  buildLog = `AUTO-FIX APPLIED: ${autoFixes.join('; ')}\n\nREMAINING BUILD ERRORS:\n${retryLog}`;
                }
              }

              // If build log still has errors (auto-fix couldn't solve or wasn't applicable)
              if (buildLog) {
                // ── Look up known fixes from the global corpus ──
                let knownFixes = '';
                try {
                  const cr = await fetch('/api/corpus');
                  if (cr.ok) {
                    const cd = await cr.json();
                    const resolvedEntries = (cd.entries || []).filter(e => e.resolved && e.resolution);
                    const errorKeywords = (buildLog.match(/Module not found|Can't resolve|Failed to compile|Syntax error|Type error|Expected|Unexpected token|Cannot find name|Cannot find module|Property .* does not exist|is not assignable|tailwind|postcss|@import|@tailwind|autoprefixer|globals\.css|Could not resolve|Unable to resolve/gi) || []);
                    const matching = resolvedEntries.filter(e => {
                      const text = `${e.problem} ${e.resolution} ${(e.context || '')}`.toLowerCase();
                      return errorKeywords.some(kw => text.includes(kw.toLowerCase()));
                    }).slice(0, 3);
                    if (matching.length > 0) {
                      knownFixes = '\n\n🔧 KNOWN FIXES for similar errors (from past builds):\n' +
                        matching.map(e => `- Problem: ${e.problem.slice(0, 120)}\n  Fix: ${e.resolution}`).join('\n');
                    }
                  }
                } catch { /* non-critical */ }
                if (knownFixes) buildLog += knownFixes;
                buildAttempted = false;
                conversation.push({
                  role: 'user',
                  content: `BUILD FAILED (attempt ${buildVerificationRetries}/3). Fix these errors with tools, then respond without tool calls to retry:\n\n${buildLog}`
                });
                return 'retry';
              }
            }
            // ── Build succeeded ──
            captureProblem('build_failure', 'Build passed after failure', '', 'Fixed by iterative model corrections');
            // Auto-resolve all recent build_failure entries for this workspace
            const bfEntries = corpusEntries.filter(e => e.type === 'build_failure' && !e.resolved && (e.workspaceId || '').includes(workspaceId));
            for (const e of bfEntries.slice(-3)) {
              markProblemResolved(e.hash, 'Fixed by code changes during build verification');
              // Also auto-create a global skill from each resolved entry so it persists across workspaces
              try {
                fetch(`/api/workspace/${workspaceId}/skills`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: `Fix: ${e.problem.slice(0, 80)}`,
                    description: `Auto-fix from build failure in workspace ${workspaceId}`,
                    applyTo: (e.type || '') === 'build_failure' ? 'nextjs, build, tailwind, typescript' : '',
                    content: `# ${e.problem}\n\n## Resolution\n${e.resolution || 'Fixed by code changes during build verification'}\n\n## Context\n${e.context || 'Build failure auto-resolved'}`,
                    scope: 'global'
                  })
                }).catch(() => {});
              } catch {}
            }
            // Refresh corpus in state so learnings panel updates
            try {
              const rr = await fetch(`/api/workspace/${workspaceId}/corpus`);
              if (rr.ok) { const rd = await rr.json(); setCorpusEntries(rd.entries || []); }
            } catch {}
            buildAttempted = true;
            try {
              const dr = await executeDevServerStart(workspaceId, null);
              if (onOpenPreview) onOpenPreview();
              const pm = dr?.running
                ? `✅ Build passed. Dev server on port ${dr.port} (${dr.url}). Preview live.`
                : `✅ Build passed. Use \`dev_server_start\` to start the server.`;
              conversation.push({ role: 'user', content: `${pm}\n\nSummarize what was built and respond "Task complete."` });
            } catch (err) {
              conversation.push({ role: 'user', content: `✅ Build passed but server start failed: ${err.message}. Try \`dev_server_start\`, then respond "Task complete."` });
            }
            return 'built';
          }; // end runBuildVerification

          // ── Call the build verification ──
          if (fileManifest.length > 0 && !buildAttempted) {
            const bvResult = await runBuildVerification();
            if (bvResult === 'built') break;
            if (buildVerificationRetries >= 3) {
              buildAttempted = true;
              conversation.push({ role: 'user', content: `Build verification failed after ${buildVerificationRetries} attempts. Summarize accomplishments and respond "Task complete."` });
              continue;
            }
            continue;
          }

          // No pending tasks, no files created, and model produced no tool calls —
          // there's nothing actionable to do. Stop the loop.
          break;
        }
        noToolStreak = 0; // reset streak — model used a tool

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

        // Stuck detection: check for repeated identical tool calls
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
          const stuckDesc = stuckTools.map(t => `${t.name} ${t.args.filePath || t.args.path || '.'}`).join(', ');
          captureProblem('stuck_loop',
            `Model stuck repeating: ${stuckDesc}`,
            `Last 3 calls: ${last3.map(t => `${t.name} ${t.filePath}`).join(', ')}`
          );
          const pendingTasks = planTodosRef.current.filter(t => !t.done);
          const nextTask = pendingTasks[0];

          // If all tasks done and files were created, run build verification instead of nudging
          if (!nextTask && fileManifest.length > 0 && !buildAttempted) {
            const bvResult = await runBuildVerification();
            if (bvResult === 'built') break;
            if (buildVerificationRetries >= 3) {
              buildAttempted = true;
              conversation.push({ role: 'user', content: `Build verification failed after ${buildVerificationRetries} attempts. Summarize accomplishments and respond "Task complete."` });
              continue;
            }
            continue;
          }

          const nextTaskHint = nextTask ? ` Your next task is: "${nextTask.text}". Complete it NOW.` : '';
          conversation.push({
            role: 'user',
            content: `You've called ${stuckDesc} repeatedly. The files exist — you're in a verification loop. MOVE ON.${nextTaskHint} If all tasks are done, respond "Task complete" without any tool block.`
          });
          continue;
        }

        // Dev server anti-polling: if last 3 dev_server_status calls all returned "not running"
        const last3Results = recentToolResults.slice(-3);
        if (last3Results.length >= 3 && last3Results.every(r => r.name === 'dev_server_status' && r.summary === 'Server not running')) {
          captureProblem('dev_server_polling',
            'Model polled dev_server_status 3x without starting server',
            'Server not running — model should use dev_server_start'
          );
          conversation.push({
            role: 'user',
            content: `The dev server is NOT running. Use \`dev_server_start\` to START it — do NOT call \`dev_server_status\` again until you start the server.`
          });
          continue;
        }

        // Read-only streak: if last 5 tool calls are all read-only, force write
        const last5Calls = recentToolCalls.slice(-5);
        const READ_ONLY_TOOLS = ['list_dir', 'read_file', 'grep_search', 'dev_server_status', 'dev_server_stop'];
        if (last5Calls.length >= 5 && last5Calls.every(tc => READ_ONLY_TOOLS.includes(tc.name))) {
          captureProblem('read_only_streak',
            'Model made 5 read-only calls without writing anything',
            `Last 5: ${last5Calls.map(t => t.name).join(', ')}`
          );
          const nextTask = planTodosRef.current.filter(t => !t.done)[0];
          const nextTaskHint = nextTask ? ` Complete: "${nextTask.text}" with a \`create_file\` or \`replace_string_in_file\` call NOW.` : ' If all done, respond "Task complete".';
          conversation.push({
            role: 'user',
            content: `You've made 5 read-only calls in a row without writing or building anything. You're stuck in analysis.${nextTaskHint}`
          });
          continue;
        }

        // Barren streak: no file writes for too many iterations — model is looping pointlessly
        if (barrenStreak >= 8) {
          captureProblem('barren_streak',
            `${barrenStreak} iterations without any file writes`,
            `File manifest: ${fileManifest.length} files, ${planTodosRef.current.filter(t => t.done).length}/${planTodosRef.current.length} tasks done`
          );
          const nextTask = planTodosRef.current.filter(t => !t.done)[0];

          // If no plan todos and no files exist at all, there's nothing to do — stop
          if (!nextTask && fileManifest.length === 0) {
            break;
          }

          conversation.push({
            role: 'user',
            content: `You've spent ${barrenStreak} iterations without creating or modifying any files. You are in a loop.${nextTask ? ` Your next pending task is: "${nextTask.text}". Complete it NOW with a tool call.` : ' If all tasks are done, respond "Task complete" with no tool block.'}`
          });
          barrenStreak = 0; // Reset and push forward
          continue;
        }

        // Iteration cap: if we're deep in the loop with zero progress, abort
        if (iter > 15) {
          const doneCount = planTodosRef.current.filter(t => t.done).length;
          if (doneCount === 0 && planTodosRef.current.length > 0 && fileManifest.length === 0) {
            conversation.push({
              role: 'user',
              content: `You've used ${iter} iterations with zero tasks completed. Something is wrong — summarize what you accomplished and respond "Task complete" with no tool block.`
            });
            break;
          }
        }

        // Execute all tools
        const toolResults = [];
        setIsThinking(true);
        for (const tc of toolCalls) {
          const toolId = `${assistantId}_tool_${toolResults.length}`;
          // Track for stuck detection
          recentToolCalls.push({ name: tc.name, filePath: tc.args.filePath || tc.args.path || '' });
          if (recentToolCalls.length > 10) recentToolCalls.shift();
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
          // Detect explicit task completion: model writes "[x] Task text" in its response.
          // Updated: only mark tasks that the model explicitly checks off (NOT keyword matching).
          if (!result.error && planTodosRef.current.length > 0 && 
              ['create_file', 'replace_string_in_file', 'run_in_terminal', 'dev_server_start'].includes(tc.name)) {
            // After a successful write/build tool, re-read the model's raw response for [x] markings
            // and match them to plan tasks by text similarity (exact word match).
            const checkoffRegex = /\[x\]\s*(.+)$/gm;
            let checkMatch;
            while ((checkMatch = checkoffRegex.exec(rawContent)) !== null) {
              const checkedText = checkMatch[1].trim().toLowerCase();
              setPlanTodos(prev => {
                let changed = false;
                const updated = prev.map(t => {
                  if (t.done) return t;
                  // Match if all significant words in the checked text appear in the task
                  const words = checkedText.split(/\s+/).filter(w => w.length > 2);
                  const taskLower = t.text.toLowerCase();
                  const matchCount = words.filter(w => taskLower.includes(w)).length;
                  if (matchCount >= Math.min(2, words.length) && matchCount > 0) {
                    changed = true;
                    return { ...t, done: true };
                  }
                  return t;
                });
                if (changed) {
                  planTodosRef.current = updated;
                  return updated;
                }
                return prev;
              });
            }
          }
          // If create_file/replace succeeded, notify parent
          if ((tc.name === 'create_file' || tc.name === 'replace_string_in_file') && result.success && onFileEdit) {
            const fp = tc.args.filePath || tc.args.path;
            onFileEdit(fp, tc.args.content || result.content);
          }
          // Track files for conversation compaction
          if (!result.error && (tc.name === 'create_file' || tc.name === 'replace_string_in_file')) {
            const fp = tc.args.filePath || tc.args.path;
            if (fp) {
              barrenStreak = 0; // Reset barren counter on successful file write
              // ── Hallucination guard: verify file actually exists after write ──
              let fileActuallyExists = false;
              if (tc.name === 'create_file') {
                try {
                  const verifyRes = await fetch(`/api/workspace/${workspaceId}/read`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: fp }),
                  });
                  fileActuallyExists = verifyRes.ok;
                } catch {}
                if (!fileActuallyExists) {
                  // File was not written to disk — inject correction
                  captureProblem('tool_error',
                    `create_file reported success but ${fp} does not exist on disk`,
                    `File ${fp} was NOT created despite tool reporting success`
                  );
                  conversation.push({
                    role: 'user',
                    content: `⚠️ HALLUCINATION DETECTED: You claimed to create \`${fp}\` but the file does NOT exist on disk. The write failed silently. Re-create \`${fp}\` NOW with the full content. Do NOT mark this task as done until the file is verified.`
                  });
                }
              }
              if (fileActuallyExists || tc.name === 'replace_string_in_file') {
                const existing = fileManifest.find(f => f.path === fp);
                const action = tc.name === 'create_file' ? 'created' : 'modified';
                if (existing) {
                  existing.action = action;
                  if (stepPurpose) existing.purpose = stepPurpose;
                } else {
                  fileManifest.push({ path: fp, action, purpose: stepPurpose });
                }
              }
            }
          }
          // Track whether model has attempted a build/run
          // NOTE: dev_server_start does NOT count as buildAttempted — the
          // programmatic build pipeline runs npm run build independently.
          if (!result.error && (
            tc.name === 'show_preview' ||
            (tc.name === 'run_in_terminal' && (tc.args.command || '').match(/npm run (?!dev)|npm start|npx next build|python|pip|bun|cargo|go run|dotnet run|uvicorn/))
          )) {
            buildAttempted = true;
          }
          // Track tool errors for compaction summary
          if (result.error) {
            executionErrors.push(`${tc.name} ${tc.args.filePath || tc.args.path || ''}: ${result.error}`);
            captureProblem('tool_error',
              result.error.slice(0, 200),
              `${tc.name} ${tc.args.filePath || tc.args.path || ''}`
            );
          }
          // Track tool result summary for anti-polling / duplicate-result detection
          const resultSummaryShort = summarizeToolResult(tc.name, tc.args, result).slice(0, 80);
          recentToolResults.push({ name: tc.name, summary: resultSummaryShort });
          if (recentToolResults.length > 10) recentToolResults.shift();
        }
        setIsThinking(false);

        // Increment barren counter — reset by successful file writes in the per-tool tracking above
        barrenStreak++;

        // Build tool result feedback for the LLM
        const resultSummary = toolResults.map(tr => {
          if (tr.result.error) return `${tr.name} ERROR: ${tr.result.error}`;
          const summary = summarizeToolResult(tr.name, tr.args, tr.result);
          return `${tr.name} OK: ${summary}`;
        }).join('\n');

        // ── Build the continuation message with remaining tasks ──
        const currentPlanTodos = planTodosRef.current;
        let continueMsg = `[Tool Results for Step ${iter + 1}]\n${resultSummary}`;
        if (currentPlanTodos.length > 0) {
          const pending = currentPlanTodos.filter(t => !t.done);
          const doneCount = currentPlanTodos.length - pending.length;
          if (pending.length > 0) {
            const pendingByPhase = new Map();
            for (const t of pending) {
              const key = t.phase || `Phase ${t.phaseNum}`;
              if (!pendingByPhase.has(key)) pendingByPhase.set(key, []);
              pendingByPhase.get(key).push(t.text);
            }
            continueMsg += `\n\nPROGRESS: ${doneCount}/${currentPlanTodos.length} tasks done. REMAINING:\n`;
            for (const [phase, tasks] of pendingByPhase) {
              continueMsg += `${phase}:\n`;
              for (const task of tasks) {
                continueMsg += `  - [ ] ${task}\n`;
              }
            }
            continueMsg += '\nYou are NOT done. Use a TOOL CALL to complete the next remaining task.';
          } else {
            continueMsg += '\n\nAll tasks are now complete. Respond without using any tools.';
          }
        } else {
          continueMsg += '\n\nContinue. If the task is complete, respond normally WITHOUT using any tools.';
        }
        conversation.push({ role: 'user', content: continueMsg });

        // ── Token-aware conversation compaction ──
        // Only compact when approaching the model's context window (75% threshold).
        // Preserves: system prompt + original task + rich summary + last 3 turns.
        // Minimum 6 iterations between compactions to avoid thrashing.
        if (iter > 5 && iter - compactedAt >= 6) {
          const totalChars = conversation.reduce((sum, m) => sum + (m.content || '').length, 0);
          const estimatedTokens = Math.ceil(totalChars / 2.5);
          const model = selectedModel || localStorage.getItem('aurora_last_model') || '';
          const provider = selectedProvider || localStorage.getItem('aurora_last_provider') || '';
          const contextWindow = getContextWindow(model, provider);
          const threshold = Math.floor(contextWindow * 0.75);

          if (estimatedTokens > threshold) {
            const compactSummary = buildCompactSummary(iter, fileManifest, planTodosRef.current, originalRequest, executionErrors);
            // Keep: system prompt (0) + original user request (last of initial messages) + summary + last 3 turns
            const systemMsg = conversation[0];
            const originalUserMsg = conversation.find(m => m.role === 'user' && !m.content.startsWith('[Tool Results') && !m.content.startsWith('[CONTEXT SUMMARY'));
            const recentMessages = conversation.slice(-6);
            conversation = [
              systemMsg,
              ...(originalUserMsg ? [originalUserMsg] : []),
              { role: 'user', content: compactSummary },
              ...recentMessages
            ];
            compactedAt = iter;
          }
        }
      }

      // ── Post-loop: summarize what was accomplished ──
      // Skip summary if plan mode completed (execution hasn't started yet)
      if (!planCompleted) {
        const currentTodos = planTodosRef.current;
        const doneCount = currentTodos.filter(t => t.done).length;
        const pendingTodos = currentTodos.filter(t => !t.done);
        const createdFiles = fileManifest.filter(f => f.action === 'created');
        const modifiedFiles = fileManifest.filter(f => f.action === 'modified');

        // ── Build & Preview status ──
        let buildStatusLine = '';
        let previewUrl = null;
        try {
          const devRes = await fetch(`/api/workspace/${workspaceId}/dev-server`, { method: 'GET' });
          const devData = devRes.ok ? await devRes.json() : null;
          if (devData?.running) {
            buildStatusLine = `🟢 Dev server running on port ${devData.port}`;
            previewUrl = devData.url || `http://localhost:${devData.port}`;
          } else if (buildAttempted) {
            buildStatusLine = `🟡 Build attempted but server not running`;
          } else {
            buildStatusLine = `⚪ No build attempted`;
          }
        } catch {
          buildStatusLine = `⚪ Build status unknown`;
        }

        let summary = '';
        let isSuccess = false;

        if (pendingTodos.length === 0 && createdFiles.length + modifiedFiles.length > 0) {
          summary = '✅ All tasks complete.';
          isSuccess = true;
        } else if (pendingTodos.length > 0) {
          summary = `⚠️ Ran out of iterations. **${doneCount}/${currentTodos.length}** tasks completed. **${pendingTodos.length} remaining**:\n`;
          for (const t of pendingTodos.slice(0, 10)) {
            summary += `  - [ ] ${t.text}\n`;
          }
          if (pendingTodos.length > 10) summary += `  ... and ${pendingTodos.length - 10} more\n`;
          if (createdFiles.length + modifiedFiles.length > 0) {
            summary += `\n**Files affected**: `;
            summary += [
              ...createdFiles.map(f => `created \`${f.path}\``),
              ...modifiedFiles.map(f => `modified \`${f.path}\``)
            ].join(', ');
          }
        } else if (createdFiles.length + modifiedFiles.length > 0) {
          summary = '✅ **Files affected**: ';
          summary += [
            ...createdFiles.map(f => `created \`${f.path}\``),
            ...modifiedFiles.map(f => `modified \`${f.path}\``)
          ].join(', ');
          summary += '\n\nTask complete.';
          isSuccess = true;
        } else {
          summary = 'Task complete.';
        }

        // Append build status and preview link
        summary += `\n\n${buildStatusLine}`;
        if (previewUrl) {
          summary += `\n🔗 Preview: ${previewUrl}`;
        }

        if (summary) {
          setMessages(prev => [...prev, {
            id: `agent_summary_${Date.now()}`,
            role: 'assistant',
            content: summary,
            isFinalSummary: true,
            isSuccess,
            previewUrl,
            timestamp: new Date().toISOString(),
            turnId,
            stats: {
              tasksDone: doneCount,
              tasksTotal: currentTodos.length,
              filesCreated: createdFiles.length,
              filesModified: modifiedFiles.length,
              buildPassed: buildAttempted
            }
          }]);
          // Auto-open preview if build succeeded
          if (previewUrl && onOpenPreview) {
            onOpenPreview();
          }
        }
      }

      // ── Auto skill extraction: ask LLM to extract reusable patterns ──
      if (buildAttempted && fileManifest.length >= 2 && isPlanExecution && planTodosRef.current.filter(t => t.done).length > 0) {
        try {
          const extractionPrompt = buildSkillExtractionPrompt(originalRequest, fileManifest, planTodosRef.current, buildAttempted);
          const { content: skillContent } = await streamLLMCall(
            [{ role: 'system', content: 'You extract reusable coding patterns from successful builds. Output ONLY a ```create_skill block or NO_SKILL.' },
             { role: 'user', content: extractionPrompt }],
            null /* no label */,
            turnId
          );
          const skillCalls = parseToolCalls(skillContent);
          for (const sc of skillCalls) {
            if (sc.name === 'create_skill' && sc.args.name) {
              await executeCreateSkill(workspaceId, sc.args.name, sc.args.description || '', sc.args.keywords || sc.args.applyTo || '', sc.args.content || '');
            }
          }
        } catch {
          // Skill extraction is best-effort — ignore failures
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Model was stuck in a loop or user stopped — run build verification if files were created
        if (fileManifest.length > 0 && !buildAttempted) {
          try { await runBuildVerification(); } catch (be) { console.error('[build-verification] Error after abort:', be); }
        }
      } else {
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
  const CONTENT_TOOLS = ['create_file', 'replace_string_in_file', 'run_in_terminal', 'create_skill'];

  // Parser: finds ```TOOL_NAME key="val"... blocks and extracts tool calls
  const parseToolCalls = (content) => {
    const calls = [];
    // Match entire tool block: ```toolName...``` — handles both inline (same-line body) and multi-line
    const regex = /```(\w+)\b\s*(.*?)```/gs;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const toolName = match[1];
      const fullRest = match[2];  // Everything between tool name and closing ```

      // Split into first line (attributes) and body.
      // Attributes MUST be on the first line; body lines are never scanned
      // for attributes, preventing body constructs like host='0.0.0.0'
      // from being misinterpreted as tool arguments.
      const newlineIdx = fullRest.indexOf('\n');
      const attrLine = newlineIdx >= 0 ? fullRest.slice(0, newlineIdx) : fullRest;
      let body = newlineIdx >= 0 ? fullRest.slice(newlineIdx + 1).trim() : '';

      // Parse key="value" or key='value' attributes from the attrLine ONLY
      const args = {};
      const attrRegex = /(\w+)=(?:"([^"]*)"|'([^']*)')/g;
      let am;
      while ((am = attrRegex.exec(attrLine)) !== null) {
        args[am[1]] = am[2] || am[3] || '';
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
        'run_in_terminal': 'run_in_terminal',
        'dev_server_status': 'dev_server_status',
        'dev_server_start': 'dev_server_start',
        'dev_server_stop': 'dev_server_stop',
        'show_preview': 'show_preview',
        'create_skill': 'create_skill'
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
        if (toolName === 'create_skill' && !args.name) {
          console.warn('[Agent] Skipping create_skill with no name attribute');
          continue;
        }
        if (toolName === 'create_skill' && !body) {
          console.warn('[Agent] Skipping create_skill with empty body');
          continue;
        }
        calls.push({ name: toolName, args, raw: match[0] });
      }
    }
    return calls;
  };

  // Execute a single tool call — maps Copilot tool names to workspace API
  const executeToolCall = async (tc, wsId) => {
    const TOOL_TIMEOUT = 30000; // 30s per-tool limit
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool ${tc.name} timed out after ${TOOL_TIMEOUT / 1000}s`)), TOOL_TIMEOUT)
    );
    try {
      const result = await Promise.race([
        (async () => {
          switch (tc.name) {
            case 'read_file': return await executeReadFile(wsId, tc.args.filePath || tc.args.path);
            case 'create_file': return await executeCreateFile(wsId, tc.args.filePath || tc.args.path, tc.args.content);
            case 'replace_string_in_file': return await executeReplaceStringInFile(wsId, tc.args.filePath || tc.args.path, tc.args.oldString, tc.args.newString);
            case 'grep_search': return await executeSearch(wsId, tc.args.query);
            case 'list_dir': return await executeListFiles(wsId, tc.args.path);
            case 'run_in_terminal': return await executeRunInTerminal(wsId, tc.args.command);
            case 'dev_server_status': return await executeDevServerStatus(wsId);
            case 'dev_server_start': return await executeDevServerStart(wsId, tc.args.command);
            case 'dev_server_stop': return await executeDevServerStop(wsId);
            case 'show_preview': return await executeShowPreview();
            case 'create_skill': return await executeCreateSkill(wsId, tc.args.name, tc.args.description || '', tc.args.keywords || tc.args.applyTo || '', tc.args.content || '');
            default: return { error: `Unknown tool: ${tc.name}` };
          }
        })(),
        timeoutPromise
      ]);
      return result;
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
      case 'dev_server_status': return result.running ? `Server running on port ${result.port} (${result.url}). ${result.logs?.length || 0} log lines.` : 'Server not running';
      case 'dev_server_start': return result.running ? `Server started on port ${result.port} (${result.url}). Command: ${result.command}` : `Server start attempted. Check logs: ${result.logs?.length || 0} lines captured.`;
      case 'dev_server_stop': return result.message || 'Server stopped';
      case 'show_preview': return result.shown ? 'Preview panel opened' : 'Preview not available for this project';
      case 'run_in_terminal': return result.success ? `Command succeeded (exit ${result.exitCode}). ${(result.stdout || '').slice(0, 300)}` : `Command failed (exit ${result.exitCode}). ${(result.stderr || result.stdout || '').slice(0, 300)}`;
      default: return 'Done';
    }
  };

  const buildSystemPrompt = (wsId, activeFile, fileContent, mode = 'agent') => {
    // Agent mode: functional instructions only
    if (mode === 'agent') {
      // ── Build past learnings block from corpus entries ──
      let learningsBlock = '';
      const unresolved = corpusEntries.filter(e => !e.resolved);
      const resolved = corpusEntries.filter(e => e.resolved && e.resolution);
      if (unresolved.length > 0) {
        const recent = unresolved.slice(-3);
        learningsBlock = '⚠️  DO NOT REPEAT these past mistakes:\n';
        for (const e of recent) {
          learningsBlock += `- ${e.problem.slice(0, 150)}\n`;
        }
        learningsBlock += '\n';
      }

      // ── Build relevant skills block ──
      let skillsBlock = '';
      if (skills.length > 0) {
        skillsBlock = '📚 REUSABLE SKILLS:\n';
        for (const s of skills.slice(0, 5)) {
          skillsBlock += `- ${s.name}: ${(s.description || '').slice(0, 100)}\n`;
        }
        skillsBlock += '\n';
      }

      // ── Base system prompt: AGENTS.md + tool format ──
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

      let base = (workspaceAgentsMd
        ? '⚠️  AGENTS.md RULES (follow these — they override training defaults):\n\n' + workspaceAgentsMd + '\n\n---\n\n'
        : '') +
        learningsBlock +
        skillsBlock +
        'Workspace API: /api/workspace/' + wsId + '. Use RELATIVE paths: "." is root.\n' +
        'TOOL SYNTAX:\n' + toolSyntax + '\n';

      // ── PRE-FLIGHT CHECKLIST at END for recency bias on small models ──
      if (resolved.length > 0) {
        // Build a tight, scannable checklist from resolved corpus entries
        const checklist = [];
        const seen = new Set();
        for (const e of resolved) {
          const p = e.problem.toLowerCase();
          const r = (e.resolution || '').toLowerCase();
          // Deduplicate similar rules
          let key = '';
          if (p.includes('postcss') || r.includes('postcss')) key = 'postcss';
          else if (p.includes('tailwind') && (p.includes('v3') || p.includes('v4') || p.includes('@import') || p.includes('@tailwind'))) key = 'tailwind-syntax';
          else if (p.includes('tailwind') || r.includes('tailwind.config')) key = 'tailwind-config';
          else if (p.includes('next') && (p.includes('latest') || p.includes('unpinned') || p.includes('version'))) key = 'next-version';
          else if (p.includes('use client') || p.includes('directive')) key = 'use-client';
          else if (p.includes('lucide') || p.includes('icon')) key = 'icons';
          else if (p.includes('import') && (p.includes('usestate') || p.includes('useeffect') || p.includes('hook'))) key = 'hooks';
          else if (p.includes("can't resolve") || p.includes('path alias') || p.includes('@/')) key = 'path-alias';
          else if (p.includes('typescript') && p.includes('latest')) key = 'ts-version';
          else if (p.includes('hallucinat') || p.includes('not exist on disk')) key = 'no-hallucinate';
          else if (p.includes('node_modules') || p.includes('npm install')) key = 'npm-install';
          else key = e.hash.slice(0, 8);
          if (seen.has(key)) continue;
          seen.add(key);

          // Build imperative one-liner
          if (key === 'postcss') checklist.push('☐ Create postcss.config.mjs with tailwindcss + autoprefixer plugins');
          else if (key === 'tailwind-syntax') checklist.push('☐ Use @tailwind base/components/utilities in CSS (NEVER @import "tailwindcss")');
          else if (key === 'tailwind-config') checklist.push('☐ Create tailwind.config.js for Tailwind v3 projects');
          else if (key === 'next-version') checklist.push('☐ Pin next version (NEVER "latest" — use "^15.0.3" or similar)');
          else if (key === 'use-client') checklist.push('☐ Add "use client" to files using framer-motion, useState, useEffect, or onClick');
          else if (key === 'icons') checklist.push('☐ Import ALL lucide-react icons used in JSX');
          else if (key === 'hooks') checklist.push('☐ Import useState/useEffect from "react" when used');
          else if (key === 'path-alias') checklist.push('☐ Use relative imports ("./components/X") instead of "@/..." path aliases');
          else if (key === 'ts-version') checklist.push('☐ Pin typescript version (NOT "latest" — use "~5.6.0")');
          else if (key === 'no-hallucinate') checklist.push('☐ Verify every file you create actually exists before claiming it');
          else if (key === 'npm-install') checklist.push('☐ Run npm install before starting dev server');
          else checklist.push('☐ ' + e.resolution.slice(0, 120));
        }
        base += '\n🚨 PRE-FLIGHT CHECKLIST — VERIFY ALL before responding:\n' + checklist.join('\n') + '\n';
      }

      // ── Append guidance sections (tool format, conventions, rules) ──
      base += '\n- First step: `list_dir path="."` to see what exists.\n';
      base += '- create_file puts content INSIDE the block body, never as content="..." attribute.\n';
      base += '- Call ONE tool per response. Nothing outside the fenced block.\n';
      base += '\nTHINK-THEN-ACT \u2014 Before every action, briefly reason (1-3 lines max):\n';
      base += '1. WHAT file are you creating/modifying and WHY?\n';
      base += '2. Are your IMPORTS correct?\n';
      base += '3. Does this step have all DEPENDENCIES resolved?\n';
      base += 'Output your reasoning in plain text, then the tool block. Never skip reasoning.\n';
      base += '\nPRE-TOOL VERIFICATION \u2014 Before writing ANY file, mentally verify:\n';
      base += '- Next.js + TypeScript \u2192 tsconfig.json MUST have "baseUrl": "." and "paths": { "@/*": ["./*"] } in compilerOptions.\n';
      base += '- CSS file MUST be in the SAME directory as the component that imports it.\n';
      base += '- All component imports use @/ prefix \u2192 requires tsconfig paths config.\n';
      base += '- Every file you create MUST compile with no import errors.\n';
      base += '- NEVER use replace_string_in_file on package.json, tsconfig.json, or any .json file. ALWAYS use create_file to write complete JSON.\n';
      base += '\n[x] PROGRESS \u2014 After each file write or build step, output a `[x] Task text` line matching the completed BUILD PLAN task.\n';
      base += '\nDEPENDENCY VERSIONS:\n';
      base += '- Next.js: use "next": "^15.0.3" (NEVER "latest" \u2014 pin to a real version)\n';
      base += '- React: use "react": "^19.0.0" and "react-dom": "^19.0.0"\n';
      base += '- TypeScript: use "typescript": "~5.6.0" (NOT "latest")\n';
      base += '- Tailwind CSS v3: package.json key is "tailwindcss" (NOT "tailwindcss@^3"). Use "tailwindcss": "^3.4.17". NEVER use v4.\n';
      base += '- Tailwind v3 REQUIRES: postcss.config.mjs (with tailwindcss+autoprefixer plugins) AND tailwind.config.js\n';
      base += '- CSS MUST use @tailwind base/components/utilities (NEVER @import "tailwindcss" \u2014 that is v4 syntax)\n';
      base += '- All other packages: use "^" semver pins to avoid stale versions.\n';
      base += '\nNEXT.JS CONVENTIONS:\n';
      base += '- Path aliases: tsconfig.json MUST include "baseUrl": "." and "paths": { "@/*": ["./*"] }\n';
      base += '- CSS: globals.css in app/ directory. Import in layout.tsx as `import "./globals.css"`\n';
      base += '- Path alias uses "./*" (not "./src/*") because files live at root under app/\n';
      base += '- CLIENT COMPONENTS: Add "use client" as FIRST LINE if using useState/useEffect/onClick/onChange/framer-motion\n';
      base += '- NO "use client" with await params: params is a Promise. If awaiting params, keep as Server Component.\n';
      base += '- Dynamic routes: create_file with filePath="app/projects/[slug]/page.tsx" (NO backslash escaping of brackets)\n';
      base += '- VERIFY after create_file: use list_dir to confirm file exists on disk. Hallucinated files are the #1 build failure cause.\n';
      base += '\nFRAMEWORK DEFAULTS: If user asks to "make an app" or "build a website" without specifying framework \u2192 Next.js + TypeScript + Tailwind CSS v3.\n';
      base += '\nPORT CONVENTION: NEVER hardcode a port. Use `const PORT = process.env.PORT || 3000;`\n';
      base += '\nANTI-FALLBACK RULE: NEVER replace a framework project with a plain HTML file. Debug build errors instead.\n';
      base += '- ALWAYS run `npm install` BEFORE dev_server_start.\n';
      base += '\nTESTING WORKFLOW:\n';
      base += '1. Run `npm install` FIRST\n';
      base += '2. Detect project type with list_dir, then dev_server_start\n';
      base += '3. Use dev_server_status to check logs\n';
      base += '4. If errors: fix files with replace_string_in_file, re-check\n';
      base += '5. When build is clean: respond "Build successful. Task complete."\n';

      // ── Append preview workflow guidance ──
      base += '\nPREVIEW WORKFLOW \u2014 After the dev server starts successfully:\n';
      base += '1. Call `show_preview` to open the preview panel so the user can see their app.\n';
      base += '2. The preview panel will show the running app in an iframe automatically.\n';
      base += '\n- When done and build is clean, respond "Task complete." with no tool block.\n';

      if (previewInfo && previewInfo.type !== 'none') {
        base += '\nYOUR PROJECT: ' + (previewInfo.framework || previewInfo.type) + ' app. Dev command: `' + (previewInfo.suggestedCommand || 'npm run dev') + '`. Preview URL: ' + (previewInfo.port ? 'http://localhost:' + previewInfo.port : 'auto-assigned') + '. After building, ALWAYS start dev server, check logs for errors, then call `show_preview`.\n';
      }

      return base;
    }

    // Plan mode — Copilot-style: explore workspace, then produce a concrete file-level plan
    if (mode === 'plan') {
      return `You are a PLANNING agent. Your ONLY job is to explore the workspace and produce a step-by-step build plan. You must NEVER write or modify files.

${workspaceAgentsMd ? `WORKSPACE AGENTS.md (follow these rules):\n${workspaceAgentsMd}\n\n` : ''}## REQUIRED WORKFLOW
1. **EXPLORE**: Use list_dir and read_file to understand what already exists in the workspace.
2. **PLAN**: Output a concrete build plan in the EXACT format below. Each task MUST reference specific file paths you will create or modify.
3. **STOP**: Do NOT create any files. Do NOT continue to execution. The system will save your plan automatically.

## PLAN FORMAT (copy this EXACTLY)

### Summary
One sentence: what the user asked for + the tech stack you'll use.

### Tasks
- [ ] Create \`path/to/file1.ext\`: what this file does — *depends on: Task 1*
- [ ] Create \`path/to/file2.ext\`: what this file does
- [ ] Modify \`path/to/existing.ext\`: what change and why
- [ ] Run \`npm install\` to install dependencies
- [ ] Start dev server and verify it builds

## CRITICAL RULES
- **Every task MUST mention at least one concrete file path** (e.g. \`index.html\`, \`package.json\`, \`app/page.tsx\`). No vague tasks like "Set up the project".
- **6-12 tasks maximum** for the ENTIRE plan. Keep it focused — don't over-engineer.
- **No phases** — just a flat ordered task list. Use — *depends on: Task N* for dependencies.
- **Do NOT describe how** to implement — just WHAT file to create/modify and its PURPOSE.
- **Tech stack MUST match the user's request**. If they ask for React, plan React files. If Express, plan Express files.
- **Read WORKSPACE AGENTS.md** if present — it may override tech choices.
- **⚠️ FRAMEWORK DEFAULTS**: If the user asks to "make an app", "build a website", "create a project", or any variation WITHOUT specifying a framework → **DEFAULT: Next.js 16 + TypeScript + Tailwind CSS v3**. Plan files like \`package.json\`, \`tsconfig.json\`, \`app/layout.tsx\`, \`app/page.tsx\`, \`app/globals.css\`, \`tailwind.config.js\`. NEVER plan plain HTML files (\`index.html\`, \`style.css\`) unless the user explicitly asks for "static HTML" or "plain HTML page".
- **Only use read_file, list_dir, grep_search** during exploration.
- **After outputting the plan, STOP**. Do NOT continue to execution.`;
    }

    // Agent mode (default)
    // ── Build past learnings block from corpus entries ──
    let learningsBlock2 = '';
    const unresolved2 = corpusEntries.filter(e => !e.resolved);
    const resolved2 = corpusEntries.filter(e => e.resolved && e.resolution);
    if (unresolved2.length > 0) {
      const recent = unresolved2.slice(-5);
      learningsBlock2 = '⚠️  PAST LEARNINGS — You previously encountered these problems in this workspace. DO NOT repeat them:\n';
      for (const e of recent) {
        learningsBlock2 += `- [${e.type}] ${e.problem} (UNRESOLVED — find a different approach)\n`;
      }
      learningsBlock2 += '\n';
    }
    if (resolved2.length > 0) {
      const recentResolved2 = resolved2.slice(-5);
      learningsBlock2 += '✅ KNOWN FIXES — These past errors were resolved. APPLY these fixes when you encounter similar issues:\n';
      for (const e of recentResolved2) {
        learningsBlock2 += `- [${e.type}] ${e.problem.slice(0, 100)}\n  → Fix: ${e.resolution.slice(0, 200)}\n`;
      }
      learningsBlock2 += '\n';
    }

    // ── Build relevant skills block ──
    let skillsBlock2 = '';
    if (skills.length > 0) {
      skillsBlock2 = '📚 WORKSPACE SKILLS — Reusable patterns discovered in this workspace. Use these when applicable:\n';
      for (const s of skills) {
        skillsBlock2 += `- **${s.name}**: ${s.description || 'Reusable pattern'}${s.applyTo?.length ? ` (applies to: ${s.applyTo.join(', ')})` : ''}\n`;
        if (s.contentPreview) skillsBlock2 += `  ${s.contentPreview.slice(0, 150)}\n`;
      }
      skillsBlock2 += '\n';
    }

    let prompt = `Workspace: /api/workspace/${wsId}.
${workspaceAgentsMd ? `\nWORKSPACE AGENTS.md (follow these rules):\n${workspaceAgentsMd}\n` : ''}${learningsBlock2}${skillsBlock2}
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
\`\`\`
\`\`\`dev_server_status
\`\`\`
\`\`\`dev_server_start command="npm run dev"
\`\`\`
\`\`\`dev_server_stop
\`\`\`
\`\`\`show_preview
\`\`\`
\`\`\`run_in_terminal command="npm install"
\`\`\`

THINK-THEN-ACT — Before every action, briefly reason (1-3 lines max):
1. WHAT file are you creating/modifying and WHY?
2. Are your IMPORTS correct? (CSS in same dir? @/ alias → tsconfig has paths?)
3. Does this step have all DEPENDENCIES resolved?
Output your reasoning in plain text, then the tool block. Never skip reasoning.

PRE-TOOL VERIFICATION — Before writing ANY file, mentally verify:
- Next.js + TypeScript → tsconfig.json MUST have "baseUrl": "." and "paths": { "@/*": ["./*"] } in compilerOptions.
- CSS file MUST be in the SAME directory as the component that imports it (e.g., app/globals.css for import "./globals.css").
- All component imports use @/ prefix → requires tsconfig paths config. Can't use @/ without it.
- Every file you create MUST compile with no import errors.
- **⚠️ NEVER use replace_string_in_file on package.json, tsconfig.json, or any .json file.** JSON is too fragile for substring replacement — one misplaced comma breaks the entire file. ALWAYS use create_file to write the complete JSON content instead.

[x] PROGRESS — After each file write or build step, output a \`[x] Task text\` line matching the completed BUILD PLAN task. This is REQUIRED so the system tracks progress.

DEPENDENCY VERSIONS — The dev server auto-runs \`npm install --legacy-peer-deps\` when node_modules is missing, so version mismatches are handled. However:
- For Next.js projects: use \`\"next\": \"^16.0.0\"\` in package.json. Next.js 16 uses Turbopack by default and works with React 19. NEVER use \`\"latest\"\` — always pin to \`^16.0.0\`.
- For React: use \`\"react\": \"^19.0.0\"\` and \`\"react-dom\": \"^19.0.0\"\`.
- For TypeScript: use \`\"typescript\": \"~5.6.0\"\` (NOT \"latest\"). TypeScript 6 does not exist — \"latest\" resolves to a non-existent version that breaks npm install.
- **⚠️ TAILWIND CSS MUST BE v3**: In \`package.json\` the key is \`\"tailwindcss\"\` (NOT \`\"tailwindcss@^3\"\` — that's an npm install command, not a JSON key). Always use \`\"tailwindcss\": \"^3.4.17\"\`. NEVER use \`tailwindcss@latest\` — Tailwind v4 requires a completely different PostCSS plugin (\`@tailwindcss/postcss\`) and breaks the standard \`tailwind.config.js\` + \`postcss.config.js\` setup. Your \`postcss.config.js\` MUST use \`tailwindcss: {}\` as the plugin name (v3 format).
- All other packages: use \`\"latest\"\` or \`\"^*\"\` to avoid stale version pins.

NEXT.JS / TYPESCRIPT CONVENTIONS — When building a Next.js + TypeScript project:
- **Path aliases**: The \`tsconfig.json\` MUST include \`"baseUrl": "."\` and \`"paths": { "@/*": ["./*"] }\` in \`compilerOptions\`. All component imports MUST use the \`@/\` prefix (e.g., \`import Hero from "@/components/Hero"\`).
- **CSS placement**: Put \`globals.css\` in \`app/\` (same directory as \`layout.tsx\` imports it). The import in \`layout.tsx\` must be \`import "./globals.css"\`. Never put CSS in a separate \`styles/\` directory unless you also fix the import path.
- **Import verification**: After creating all files, imports must resolve. CSS file must be in the same directory as the importing component. The \`@/\` alias only works if \`tsconfig.json\` has the \`paths\` config. If you use \`@/\` imports, you MUST add \`baseUrl\` and \`paths\` to \`tsconfig.json\`. IMPORTANT: Because source files live under \`app/\` (not \`src/\`), the tsconfig path MUST be \`"@/*": ["./*"]\` — using \`"./*"\` will cause \`Module not found\` errors.
- **⚠️ CLIENT COMPONENTS**: In Next.js App Router, ALL components are Server Components by default. If a page or component uses event handlers (onClick, onSubmit, onChange), React hooks (useState, useEffect, useRef), or browser APIs (window, document, localStorage), you MUST add \`"use client"\` as the VERY FIRST LINE of the file. Without it, the build will fail with "Event handlers cannot be passed to Client Component props." Pages with forms, buttons with onClick, or any interactivity need this directive.
- **⚠️ NO "use client" WITH await params**: In Next.js 16, \`params\` is a Promise that MUST be awaited (e.g., \`const { slug } = await params\`). The \`await\` keyword only works in async Server Components. If a page awaits params, it CANNOT have \`"use client"\` — the build will fail with a syntax error. Remove \`"use client"\` and keep it as a Server Component. If you need client interactivity AND params, split the logic: keep the page as a Server Component (await params, then pass data as props to a separate client component).
- **⚠️ DYNAMIC ROUTE BRACKETS IN create_file**: When using \`create_file\` to create Next.js dynamic route files like \`app/projects/[slug]/page.tsx\`, write the filePath WITHOUT backslash escaping: \`filePath="app/projects/[slug]/page.tsx"\`. Do NOT write \`filePath="app/projects/\\[slug\\]/page.tsx"\` \u2014 the backslashes create a literal directory called \`\\[slug\\]\` instead of the Next.js dynamic route \`[slug]\`, causing "Requested and resolved page mismatch" errors.
- **⚠️ DIRECTORIES BEFORE FILES**: When you need to create files inside a subdirectory (e.g., \`app/components/Navbar.tsx\`), first make sure the directory exists. create_file auto-creates parent directories, but ONLY if no file already exists at that path. If \`app/components\` already exists as a FILE (not a directory), DELETE it first with \`run_in_terminal command="rm path/to/file"\` before creating files inside it. Better yet: always create leaf files first, and if you need a barrel export (index file), create it LAST.
- **⚠️ VERIFY AFTER CREATE**: After using create_file, you MUST verify the file exists on disk using list_dir on the parent directory. Never trust that create_file succeeded — LLMs frequently hallucinate successful file writes. If list_dir does NOT show the file, the create MUST be retried. Never mark a create_file task complete until list_dir confirms the file is on disk. This rule is critical — skipped files are the #1 cause of failed builds.

FRAMEWORK DEFAULTS — When the user asks to "make an app", "build a website", "create a project", or any variation WITHOUT specifying a framework:
- **DEFAULT: Next.js 16 + TypeScript + Tailwind CSS v3** — This is ALWAYS the default unless the user explicitly asks for something else.
- The user can override by saying "React app", "Vue app", "static HTML", "Python", etc.
- If the user just says "make me a developer portfolio" or "create a todo app" → Next.js 16 + TypeScript + Tailwind CSS v3.
- NEVER default to plain HTML unless the user explicitly asks for "static HTML" or "plain HTML page".

PROJECT DETECTION — Before starting a dev server, FIRST use \`list_dir path="."\` to detect the project type:
- Static HTML/CSS/JS (index.html but no package.json) → \`dev_server_start command="npx serve . --no-clipboard"\`
- Node/Next.js (package.json with "next" dep) → \`dev_server_start\` (auto-detects npm/yarn/pnpm)
- Vite (package.json with "vite" dep) → \`dev_server_start\`
- Python (requirements.txt/pyproject.toml) → \`dev_server_start command="python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"\`
- Rust (Cargo.toml) → \`dev_server_start command="cargo run"\`
- Go (go.mod) → \`dev_server_start command="go run ."\`
- If no framework files exist (just static HTML/CSS/JS) → \`dev_server_start command="npx serve . --no-clipboard"\` to serve them for preview.

ANTI-FALLBACK RULE: NEVER replace a framework project (Next.js, Vite, React, etc.) with a plain HTML file just because the dev server fails. If the dev server fails, debug it:
- **⚠️ ALWAYS run \`run_in_terminal command="npm install"\` BEFORE \`dev_server_start\`.** The dev server cannot start without node_modules. This is the #1 cause of build failures. If node_modules exists, npm install is a no-op (fast).
- For npm projects: run \`run_in_terminal command="npm install"\` to install dependencies, then retry \`dev_server_start\`.
- Check logs with \`dev_server_status\` to see specific errors.
- Fix code errors with \`replace_string_in_file\`, not by throwing away the project.
- Only use plain HTML if the user explicitly asked for a static HTML page.

TESTING WORKFLOW — After creating/modifying project files:
1. Run \`run_in_terminal command="npm install"\` FIRST to install all dependencies. The dev server will fail if node_modules is missing.
2. Detect project type with \`list_dir\`, then use \`dev_server_start\` with the right command.
3. Use \`dev_server_status\` to check the server and read build logs.
4. If logs show errors → fix files and re-check with \`dev_server_status\`.
   Common Next.js errors to check: missing \`@/*\` tsconfig path alias (add \`baseUrl\`/\`paths\`), CSS import path mismatch (CSS must be in same dir as importing \`layout.tsx\`), unresolved component imports (\`@/components/X\` requires tsconfig \`paths\`).
5. When build is clean, call \`show_preview\` to open the preview panel.
6. Respond "Build successful. Task complete."
`;

    // Inject preview-info if available
    if (previewInfo && previewInfo.type !== 'none') {
      prompt += `\nYour app is a ${previewInfo.framework || previewInfo.type} project. `;
      if (previewInfo.suggestedCommand) {
        prompt += `Dev command: \`${previewInfo.suggestedCommand}\`. `;
      }
      if (previewInfo.port) {
        prompt += `Preview URL: http://localhost:${previewInfo.port}. `;
      }
      prompt += `\nAfter building, ALWAYS start the dev server and check logs for errors before declaring task complete.`;
    }

    if (activeFile) prompt += `\n\nActive file in editor: "${activeFile}"`;
    if (fileContent) {
      const truncated = fileContent.slice(0, 3000);
      prompt += `\n\nCurrent file content:\n\`\`\`\n${truncated}${fileContent.length > 3000 ? '\n... (truncated)' : ''}\n\`\`\``;
    }

    // Inject matched skills (agent-learned patterns)
    if (skills.length > 0) {
      const matched = skills.filter(s => {
        const keywords = s.applyTo || [];
        if (keywords.length === 0) return false; // No keywords = won't match
        const haystack = (userContent || '').toLowerCase();
        return keywords.some(kw => haystack.includes(kw.toLowerCase()));
      });
      if (matched.length > 0) {
        prompt += `\n\n=== RELEVANT SKILLS (reusable patterns) ===\n`;
        for (const s of matched) {
          prompt += `\n## ${s.name}\n${s.content.slice(0, 800)}\n`;
        }
        prompt += `\nUse these patterns when applicable. To save a new pattern, use:\n`;
        prompt += `\`\`\`create_skill name="Skill Name" description="What it does" keywords="kw1, kw2"\nInstructions...\n\`\`\`\n`;
      }
    }

    // Inject recent unresolved corpus entries (past mistakes to avoid)
    if (corpusEntries.length > 0) {
      const unresolved = corpusEntries.filter(e => !e.resolved).slice(0, 5);
      if (unresolved.length > 0) {
        prompt += `\n\n=== PAST FRICTION EVENTS (avoid repeating) ===\n`;
        for (const e of unresolved) {
          prompt += `- [${e.type}] ${e.problem}\n`;
          if (e.resolution) prompt += `  Resolution: ${e.resolution}\n`;
        }
        prompt += `\nLearn from these past issues. Do NOT repeat the same mistakes.\n`;
      }
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

  // === Dev server tools ===

  const executeRunInTerminal = async (wsId, command) => {
    if (!command) return { error: 'No command provided' };
    try {
      const res = await fetch(`/api/workspace/${wsId}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      if (data.error) return { error: data.error.message };
      return {
        success: data.success,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode
      };
    } catch (err) {
      return { error: err.message };
    }
  };

  const executeDevServerStatus = async (wsId) => {
    const res = await fetch(`/api/workspace/${wsId}/dev-server`);
    if (!res.ok) throw new Error('Status check failed');
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return {
      running: data.running || false,
      port: data.port || null,
      url: data.url || null,
      logs: data.logs || [],
      startedAt: data.startedAt || null
    };
  };

  const executeDevServerStart = async (wsId, command) => {
    // If no command provided, auto-detect from workspace files
    let cmd = command;
    if (!cmd) {
      try {
        // First check preview-info
        const infoRes = await fetch(`/api/workspace/${wsId}/preview-info`);
        const infoData = await infoRes.json();
        if (!infoData.error && infoData.suggestedCommand) {
          cmd = infoData.suggestedCommand;
        }
      } catch {}

      if (!cmd) {
        // Auto-detect project type from workspace tree
        try {
          const treeRes = await fetch(`/api/workspace/${wsId}/tree?depth=2`);
          const treeData = await treeRes.json();
          const files = treeData.tree ? flattenTree(treeData.tree) : [];
          const fileSet = new Set(files.map(f => f.name || f));

          if (fileSet.has('package.json')) {
            // Check for lock files to determine package manager
            if (fileSet.has('pnpm-lock.yaml')) cmd = 'pnpm run dev';
            else if (fileSet.has('yarn.lock')) cmd = 'yarn run dev';
            else if (fileSet.has('bun.lockb') || fileSet.has('bun.lock')) cmd = 'bun run dev';
            else cmd = 'npm run dev';
          } else if (fileSet.has('Cargo.toml')) {
            cmd = 'cargo run';
          } else if (fileSet.has('go.mod')) {
            cmd = 'go run .';
          } else if (fileSet.has('Makefile')) {
            cmd = 'make dev';
          } else if (fileSet.has('requirements.txt') || fileSet.has('pyproject.toml')) {
            cmd = 'python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000';
          } else if (fileSet.has('index.html')) {
            // Static HTML project — use npx serve (no npm project needed)
            cmd = 'npx serve . --no-clipboard';
          } else if (fileSet.has('Dockerfile') || fileSet.has('docker-compose.yml')) {
            cmd = 'docker compose up';
          } else {
            // Ultimate fallback: check if there's any HTML/CSS/JS to serve
            const hasWebFiles = files.some(f => (f.name || f).match(/\.(html|css|js|mjs)$/));
            if (hasWebFiles) {
              cmd = 'npx serve . --no-clipboard';
            } else {
              cmd = 'npm run dev';
            }
          }
        } catch {
          cmd = 'npm run dev';
        }
      }
    }

    // Normalize: strip "npm run dev" wrapping for non-npm commands
    // and ensure npx is available for serve
    const finalCmd = cmd || 'npm run dev';

    const res = await fetch(`/api/workspace/${wsId}/dev-server`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: finalCmd })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `Start failed (${res.status})`);
    }
    const data = await res.json();

    // Wait a moment then check status for build output
    await new Promise(r => setTimeout(r, 3000));

    const statusRes = await fetch(`/api/workspace/${wsId}/dev-server`);
    const statusData = await statusRes.json();

    return {
      running: statusData.running || false,
      port: statusData.port || data.port || null,
      url: statusData.url || data.url || null,
      logs: statusData.logs || data.logs || [],
      command: finalCmd,
      message: data.message || 'Dev server started'
    };
  };

  const executeDevServerStop = async (wsId) => {
    const res = await fetch(`/api/workspace/${wsId}/dev-server`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Stop failed');
    const data = await res.json();
    return { running: false, message: data.message || 'Dev server stopped' };
  };

  const executeShowPreview = async () => {
    if (!onOpenPreview) return { shown: false, message: 'Preview not available' };
    try {
      await onOpenPreview();
      return { shown: true, message: 'Preview panel opened' };
    } catch (err) {
      return { shown: false, message: err.message };
    }
  };

  // Agent-learned skill: persist a reusable pattern to .aurora/skills/
  const executeCreateSkill = async (wsId, name, description, applyTo, content) => {
    try {
      const res = await fetch(`/api/workspace/${wsId}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, applyTo, content })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Refresh skills list
        const sr = await fetch(`/api/workspace/${wsId}/skills`);
        if (sr.ok) {
          const sd = await sr.json();
          setSkills(sd.skills || []);
        }
        return { success: true, message: `Skill "${name}" saved`, path: data.path };
      }
      return { error: `Failed to save skill: ${data.error?.message || 'Unknown error'}` };
    } catch (err) {
      return { error: err.message };
    }
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
      case 'dev_server_status': return `Checked dev server status`;
      case 'dev_server_start': return `Started dev server (${args.command || 'npm run dev'})`;
      case 'dev_server_stop': return `Stopped dev server`;
      case 'show_preview': return `Opened preview panel`;
      case 'run_in_terminal': return `Ran \`${(args.command || '').slice(0, 60)}\``;
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
      case 'dev_server_status': return '🔍';
      case 'dev_server_start': return '▶️';
      case 'dev_server_stop': return '⏹️';
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
      case 'dev_server_status': return 'border-green-500/30';
      case 'dev_server_start': return 'border-green-500/30';
      case 'dev_server_stop': return 'border-red-500/30';
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
    // Plan result messages: don't show raw content, only the structured plan UI
    if (msg.isPlanResult) return null;

    // Remove tool call fenced blocks from displayed content (shown in tool cards)
    // \b after tool name + [^`]* handles both inline code (same-line body) and multi-line blocks
    const toolBlockRegex = /```(create_file|replace_string_in_file|read_file|list_dir|grep_search|run_in_terminal|dev_server_start|dev_server_stop|dev_server_status)\b[^`]*```/g;
    const cleanContent = msg.content ? msg.content.replace(toolBlockRegex, '').trim() : '';
    const thinkingText = msg.thinking || '';

    // When thinking exists, the thinking toggle above shows reasoning.
    // The actual model response (cleanContent) is the primary visible content.
    // If there's nothing to display, return null.
    if (!cleanContent) return null;

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
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xs">A</span>
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

      {/* Plan progress tracker — flat task list, shown during execution */}
      {planTodos.length > 0 && agentMode === 'agent' && messages.length > 0 && (
        <div className="px-3 pt-2 pb-1">
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40">
              <span className="text-[10px] font-medium text-indigo-300 uppercase tracking-wider">Progress</span>
              <span className="text-[9px] text-zinc-500">
                {planTodos.filter(t => t.done).length}/{planTodos.length} tasks
              </span>
            </div>
            <div className="max-h-[180px] overflow-y-auto px-2 py-1.5">
              {planTodos.map((todo, idx) => (
                <div key={todo.id} className="flex items-start gap-1.5 py-0.5">
                  <span className={`mt-0.5 w-3 h-3 rounded flex-shrink-0 flex items-center justify-center text-[8px] ${todo.done ? 'bg-emerald-500/20 text-emerald-400' : 'border border-zinc-600/50 text-zinc-600'}`}>
                    {todo.done ? '✓' : ''}
                  </span>
                  <span className={`text-[10px] leading-relaxed ${todo.done ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
                    {idx + 1}. {todo.text}
                    {todo.dependsOn && !todo.done && (
                      <span className="text-[8px] text-zinc-600 ml-1 italic">— depends on {todo.dependsOn}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
          // VS Code style: thinking is collapsed by default. While streaming,
          // only the toggle label animates (with dots). The text only shows
          // when the user clicks to expand.
          const isThinkingExpanded = expandedThinkingIds.has(msg.id);
          const showThinkingToggle = hasThinking;
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

            {/* Plan — read-only structured view (OpenAI-style) */}
            {planTodos.length > 0 && msg.isPlanResult && (
              <div className="mb-3 mx-1">
                {/* Summary banner */}
                {planSummary && (
                  <div className="mb-2 px-3 py-2 bg-indigo-950/20 border border-indigo-800/20 rounded-lg">
                    <p className="text-[11px] text-indigo-200/80 leading-relaxed">{planSummary}</p>
                  </div>
                )}

                {/* Plan header */}
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[10px] font-medium text-indigo-300 uppercase tracking-wider">Implementation Plan</span>
                  <span className="text-[10px] text-zinc-500">{planTodos.length} task{planTodos.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Flat task list (Copilot-style) */}
                <div className="border-l-2 border-zinc-800/50 ml-1 pl-3 space-y-0.5">
                  {planTodos.map((todo, idx) => (
                    <div key={todo.id} className="flex items-start gap-2 py-0.5">
                      <span className="text-[10px] text-zinc-500 font-mono mt-0.5">{idx + 1}.</span>
                      <span className="text-[11px] leading-relaxed text-zinc-300">
                        {todo.text}
                        {todo.dependsOn && (
                          <span className="text-[10px] text-zinc-600 ml-1.5 italic">— depends on {todo.dependsOn}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Execute plan button */}
                <div className="mt-3 pt-2 border-t border-zinc-800/30 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAgentMode('agent');
                      localStorage.setItem('aurora_agent_mode', 'agent');

                      // Build plan execution message from flat todos
                      let planMsg = 'Execute the following plan step by step:\n\n';
                      planMsg += `## Summary\n${planSummary || 'Build as specified'}\n\n`;
                      planMsg += '## Tasks\n';
                      for (const t of planTodos) {
                        const dep = t.dependsOn ? ` (depends on: ${t.dependsOn})` : '';
                        planMsg += `- [ ] ${t.text}${dep}\n`;
                      }
                      planMsg += '\nWork through tasks IN ORDER. Mark each task [x] when completed. Start with task 1 NOW.';

                      setInput(planMsg);
                      // Submit the form after React flushes the input state
                      setTimeout(() => {
                        document.getElementById('agent-input-form')?.requestSubmit();
                      }, 0);
                    }}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-medium transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Execute Plan
                  </button>
                  <span className="text-[9px] text-zinc-600">Switches to Agent mode to implement the plan</span>
                </div>
              </div>
            )}

            {/* Auto-generated plan card (agent mode plan generation) — shown inline */}
            {msg.isPlanCard && !msg.isPlanResult && planTodos.length > 0 && (
              <div className="mb-2 mx-1">
                <div className="border border-indigo-800/30 bg-zinc-900/40 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-indigo-950/20 border-b border-indigo-800/20 flex items-center gap-2">
                    <span className="text-xs">📋</span>
                    <span className="text-[10px] font-medium text-indigo-300 uppercase tracking-wider">Implementation Plan</span>
                    <span className="ml-auto text-[10px] text-indigo-500">{planTodos.filter(t => t.done).length}/{planTodos.length}</span>
                  </div>
                  <div className="px-3 py-2 space-y-1 max-h-[200px] overflow-y-auto">
                    {planTodos.map((todo, idx) => (
                      <div key={todo.id} className={`flex items-start gap-2 py-0.5 transition-all duration-300 ${todo.done ? 'opacity-50' : ''}`}>
                        <span className={`text-[11px] mt-0.5 flex-shrink-0 transition-colors duration-300 ${todo.done ? 'text-emerald-400' : 'text-zinc-600'}`}>
                          {todo.done ? (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                            </svg>
                          ) : (
                            <span className="block w-3.5 h-3.5 rounded-full border border-zinc-600" />
                          )}
                        </span>
                        <span className={`text-[11px] leading-relaxed transition-colors duration-300 ${todo.done ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
                          {idx + 1}. {todo.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Final summary banner with build status */}
            {msg.isFinalSummary && (
              <div className={`mb-2 mx-1 px-3 py-2.5 rounded-xl border ${msg.isSuccess ? 'bg-emerald-950/20 border-emerald-800/30' : 'bg-amber-950/20 border-amber-800/30'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm">{msg.isSuccess ? '✅' : '⚠️'}</span>
                  <span className={`text-[11px] font-medium ${msg.isSuccess ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {msg.isSuccess ? 'Task Complete' : 'Partial Completion'}
                  </span>
                </div>
                {msg.stats && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="text-center">
                      <div className="text-[13px] font-bold text-zinc-200">{msg.stats.tasksDone}/{msg.stats.tasksTotal}</div>
                      <div className="text-[9px] text-zinc-500">Tasks</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[13px] font-bold text-zinc-200">{msg.stats.filesCreated + msg.stats.filesModified}</div>
                      <div className="text-[9px] text-zinc-500">Files</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-[13px] font-bold ${msg.stats.buildPassed ? 'text-emerald-400' : 'text-zinc-400'}`}>
                        {msg.stats.buildPassed ? '✓' : '—'}
                      </div>
                      <div className="text-[9px] text-zinc-500">Build</div>
                    </div>
                  </div>
                )}
                {msg.previewUrl && (
                  <button
                    onClick={onOpenPreview}
                    className="w-full px-2.5 py-1.5 bg-indigo-600/40 hover:bg-indigo-600/60 text-indigo-200 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Open Preview
                  </button>
                )}
              </div>
            )}

            {/* Message content */}
            <div className="px-3">
              {/* User message: label + timestamp + retry */}
              {isUser && (
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="text-[10px] font-medium text-zinc-500">You</span>
                  <span className="text-[9px] text-zinc-700">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  {!isStreaming && (
                    <button
                      type="button"
                      onClick={() => handleUserRetry(msg.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-zinc-600 hover:text-zinc-300 transition-all flex items-center gap-1"
                      title="Retry from here"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Retry
                    </button>
                  )}
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

                  {/* Thinking block — VS Code Copilot style: collapsible reasoning */}
                  {showThinkingToggle && (
                    <div className="mb-2">
                      <button
                        type="button"
                        onClick={toggleThinking}
                        className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors w-full text-left group/think"
                      >
                        <svg className={`w-2.5 h-2.5 transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="text-zinc-400 group-hover/think:text-zinc-300">
                          {isStreamingThis ? 'Thinking' : 'Finished thinking'}
                        </span>
                        {isStreamingThis && (
                          <span className="inline-flex gap-0.5">
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        )}
                      </button>
                      {isThinkingExpanded && (
                        <div className="mt-1.5 pl-3 border-l-2 border-zinc-700/40 relative">
                          {isStreamingThis && (
                            <div className="pointer-events-none absolute bottom-0 left-3 right-0 h-8 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent z-10" />
                          )}
                          <div
                            ref={isStreamingThis ? thinkingContainerRef : undefined}
                            className="text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap font-mono max-h-32 overflow-y-auto"
                            style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}
                          >
                            {msg.thinking}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Message body */}
              <div className={isUser ? 'text-zinc-200' : 'text-zinc-300'}>
                {/* Edit textarea for user messages */}
                {isUser && editingMessageId === msg.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editInput}
                      onChange={(e) => setEditInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleEditSubmit(msg.id);
                        } else if (e.key === 'Escape') {
                          setEditingMessageId(null);
                          setEditInput('');
                        }
                      }}
                      className="w-full bg-zinc-800 border border-indigo-600/50 rounded-lg px-3 py-2 text-sm text-zinc-200 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                      <span>Enter to send · Esc to cancel</span>
                    </div>
                  </div>
                ) : isUser ? (
                  <div
                    onClick={() => handleStartEdit(msg)}
                    className="cursor-text hover:bg-zinc-800/30 rounded px-1 -mx-1 py-0.5 transition-colors"
                    title="Click to edit"
                  >
                    {renderMessageContent(msg)}
                  </div>
                ) : (agentMode === 'plan' && isStreamingThis) ? (
                  <div className="flex items-center gap-2 text-xs text-indigo-300/80">
                    <span className="inline-flex gap-0.5">
                      <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    Generating plan...
                  </div>
                ) : (
                  renderMessageContent(msg)
                )}
              </div>

              {/* Tool call cards */}
              {msg.toolCalls?.map(tc => (
                <ToolCallCard key={tc.id} tc={tc} msgId={msg.id} />
              ))}
            </div>
          </div>
          );
        })}

        {/* Live progress bar — always visible when plan todos exist and agent is running */}
        {planTodos.length > 0 && (() => {
          const doneCount = planTodos.filter(t => t.done).length;
          const pct = Math.round((doneCount / planTodos.length) * 100);
          const isComplete = doneCount === planTodos.length;
          return (
            <div className="mx-3 mt-1 mb-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-zinc-500">Progress</span>
                <span className={`text-[10px] font-medium ml-auto transition-colors duration-500 ${isComplete ? 'text-emerald-400' : 'text-zinc-400'}`}>
                  {doneCount}/{planTodos.length} {isComplete ? '✓' : ''}
                </span>
              </div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${isComplete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
              {!isComplete && (() => {
                const next = planTodos.find(t => !t.done);
                return next ? (
                  <div className="mt-1 text-[10px] text-zinc-600 truncate">
                    Next: <span className="text-zinc-500">{next.text}</span>
                  </div>
                ) : null;
              })()}
            </div>
          );
        })()}

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
            return null; // Superseded by isFinalSummary banner
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

      {/* 🧠 Learnings Debug Panel — corpus + skills visibility */}
      <div className="border-t border-zinc-800/40">
        <button
          type="button"
          onClick={() => setShowLearningsPanel(v => !v)}
          className="w-full px-3 py-1.5 flex items-center gap-2 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <svg className={`w-2.5 h-2.5 transition-transform ${showLearningsPanel ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>🧠 Learnings</span>
          <span className="text-zinc-700">
            ({corpusEntries.filter(e => !e.resolved).length} open, {corpusEntries.filter(e => e.resolved).length} resolved, {skills.length} skills)
          </span>
        </button>

        {showLearningsPanel && (
          <div className="px-3 pb-2 max-h-64 overflow-y-auto space-y-2 text-[10px]">
            {/* Unresolved friction events */}
            {(() => {
              const unresolved = corpusEntries.filter(e => !e.resolved);
              if (unresolved.length === 0 && skills.length === 0) {
                return <div className="text-zinc-600 italic py-1">No learnings yet. Issues and skills appear as the agent works.</div>;
              }
              return null;
            })()}

            {corpusEntries.filter(e => !e.resolved).length > 0 && (
              <div>
                <div className="text-zinc-500 font-medium mb-1">
                  ⚠️ Unresolved Friction ({corpusEntries.filter(e => !e.resolved).length})
                </div>
                {corpusEntries.filter(e => !e.resolved).slice(0, 8).map((e, i) => (
                  <div key={i} className="bg-zinc-900/50 rounded px-2 py-1 mb-1 border border-zinc-800/30">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        e.type === 'build_failure' ? 'bg-red-500' :
                        e.type === 'tool_error' ? 'bg-amber-500' :
                        e.type === 'stuck_loop' ? 'bg-orange-500' :
                        'bg-zinc-500'
                      }`} />
                      <span className="text-zinc-400 font-mono">{e.type}</span>
                    </div>
                    <div className="text-zinc-500 mt-0.5 truncate">{e.problem}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Agent-learned skills */}
            {skills.length > 0 && (
              <div>
                <div className="text-zinc-500 font-medium mb-1">
                  📚 Skills ({skills.length})
                </div>
                {skills.map((s, i) => (
                  <div key={i} className="bg-zinc-900/50 rounded px-2 py-1 mb-1 border border-zinc-800/30">
                    <div className="text-zinc-400 font-medium truncate">{s.name}</div>
                    <div className="text-zinc-600 text-[9px] truncate">{s.description || '(no description)'}</div>
                    {s.applyTo?.length > 0 && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {s.applyTo.map((kw, j) => (
                          <span key={j} className="bg-zinc-800 text-zinc-600 rounded px-1 text-[8px]">{kw}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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
