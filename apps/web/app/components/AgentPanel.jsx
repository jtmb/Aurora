// @aurora/web - AgentPanel: AI coding agent chat sidebar

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  previewInfo,
  onFileTreeChange
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const streamAbortRef = useRef(null);    // abort controller for SSE streams (Chat mode)
  const agentStreamAbortRef = useRef(null); // abort controller for agent SSE stream
  const messagesRef = useRef([]);          // latest messages for async access
  const thinkingContainerRef = useRef(null);
  const turnCounterRef = useRef(0);
  const retryTrimAfterIdRef = useRef(null);  // message ID to trim DB history after on retry

  // --- Copilot-style agent controls ---
  const [agentMode, setAgentMode] = useState('chat');       // 'chat' | 'plan' | 'agent'
  const agentModeRef = useRef('chat');                       // synchronous mirror for sendMessage
  useEffect(() => { agentModeRef.current = agentMode; }, [agentMode]);
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
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Auto-resize textarea as user types
  const textareaRef = useRef(null);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [input]);
  const [planSummary, setPlanSummary] = useState('');
  const [planMessageId, setPlanMessageId] = useState(null); // id of the assistant message that contains the plan
  const modelDropdownRef = useRef(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editInput, setEditInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null); // server-side agent job ID
  const pollingRef = useRef(null); // polling interval ref

  // ── Self-improving corpus + agent-learned skills ──
  const [corpusEntries, setCorpusEntries] = useState([]);
  const [skills, setSkills] = useState([]);
  const [showLearningsPanel, setShowLearningsPanel] = useState(false);
  const sessionErrorHashes = useRef(new Set()); // dedupe tool_error captures per session

  // Count reasoning "steps" from thinking text (Copilot-style: "Finished with X steps")
  const countSteps = (thinking) => {
    if (!thinking) return 0;
    const text = thinking.trim();
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    const stepLines = text.split('\n').filter(line => {
      const trimmed = line.trim();
      return /^\d+[\.\)]\s/.test(trimmed) || /^[-*•]\s/.test(trimmed) || /^(Step|Phase|Task)\s*\d/i.test(trimmed);
    });
    if (stepLines.length >= 2) return stepLines.length;
    return paragraphs.length || 1;
  };

  // Dynamic thinking label based on content (VS Code Copilot-style: Thinking → Analyzing → Finished)
  const getThinkingLabel = (thinking, streaming) => {
    if (!streaming) {
      const steps = countSteps(thinking);
      return `Finished with ${steps} step${steps !== 1 ? 's' : ''}`;
    }
    const t = (thinking || '').toLowerCase();
    if (!t) return 'Thinking';
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

  // ── Polling: fetch new messages and job status while a server-side job is active ──
  const pollingGraceRef = useRef(0);
  useEffect(() => {
    if (!isStreaming || !workspaceChatId) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      return;
    }

    pollingGraceRef.current = Date.now() + 4000; // 4-second grace period before accepting "no active job"

    const poll = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;

        // Fetch latest messages
        const msgRes = await fetch(`/api/chats/${workspaceChatId}/messages`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          const serverMessages = msgData.messages || [];
          // Merge server messages into local state — add new, update existing content/thinking
          setMessages(prev => {
            const existingById = new Map(prev.map(m => [m.id, m]));
            let changed = false;
            let merged = [...prev];

            for (const sm of serverMessages) {
              const existing = existingById.get(sm.id);
              if (existing) {
                // Update existing message if content or thinking has changed (streaming incremental updates)
                if (existing.role === 'assistant') {
                  if (existing.content !== sm.content || (existing.thinking || '') !== (sm.thinking || '')) {
                    existing.content = sm.content;
                    existing.thinking = sm.thinking || '';
                    existing.timestamp = sm.timestamp;
                    changed = true;
                  }
                  // Detect plan content on existing messages (may have been added by SSE before polling saw it)
                  if (!existing.isPlanResult && existing.content && /\n###\s*Summary\s*\n/.test(existing.content)) {
                    const planResult = parsePlanTodos(existing.content);
                    if (planResult.todos.length > 0) {
                      existing.isPlanResult = true;
                      setPlanTodos(planResult.todos);
                      setPlanSummary(planResult.summary);
                      setPlanMessageId(existing.id);
                      changed = true;
                    }
                  }
                }
              } else {
                // New message
                if (sm.role === 'assistant') {
                  const msgObj = {
                    id: sm.id,
                    role: sm.role,
                    content: sm.content,
                    thinking: sm.thinking || '',
                    timestamp: sm.timestamp,
                    model: sm.model,
                    provider: sm.provider,
                    isFinalSummary: sm.content?.startsWith?.('✅') || sm.content?.startsWith?.('⚠️') || sm.content?.startsWith?.('Task complete'),
                  };
                  // Detect plan content in newly merged messages
                  if (msgObj.content && /\n###\s*Summary\s*\n/.test(msgObj.content)) {
                    const planResult = parsePlanTodos(msgObj.content);
                    if (planResult.todos.length > 0) {
                      msgObj.isPlanResult = true;
                      setPlanTodos(planResult.todos);
                      setPlanSummary(planResult.summary);
                      setPlanMessageId(msgObj.id);
                    }
                  }
                  // Parse tool calls from agent-mode messages for tool card display
                  const toolCalls = parseToolCalls(sm.content);
                  if (toolCalls.length > 0) {
                    msgObj.toolCalls = toolCalls.map((tc, i) => ({
                      ...tc,
                      id: `${msgObj.id}_tool_${i}`,
                      status: 'done'
                    }));
                  }
                  merged.push(msgObj);
                  changed = true;
                } else if (sm.role === 'user') {
                  merged.push({ id: sm.id, role: 'user', content: sm.content, timestamp: sm.timestamp, turnId: sm.id });
                  changed = true;
                }
              }
            }

            // Filter out SSE ephemeral messages that have DB-backed equivalents
            // (SSE messages use agent_asst_* prefix, DB messages use agent_* prefix)
            const hasDbAssistant = serverMessages.some(sm => sm.role === 'assistant' && !sm.id.startsWith('agent_asst_'));
            if (hasDbAssistant) {
              merged = merged.filter(m => !m.id.startsWith('agent_asst_'));
              changed = true;
            }

            return changed ? [...merged] : prev;
          });
        }

        // Fetch job status
        if (!workspaceId) return;
        const statusRes = await fetch(`/api/workspace/${workspaceId}/agent/status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (!statusData.active) {
            // Don't kill polling during the grace period — the job may not be created yet
            if (Date.now() < pollingGraceRef.current) return;
            // Job finished (completed or failed)
            setIsStreaming(false);
            setIsThinking(false);
            setActiveJobId(null);
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
            return;
          }
          // ── Handle awaiting_input (clarification pause) ──
          if (statusData.status === 'awaiting_input') {
            setIsStreaming(false);
            setIsThinking(false);
            // Don't clear activeJobId — we need it to cancel/resume
            setActiveJobId(statusData.jobId);
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
            // Show the question as an assistant message if not already shown
            if (statusData.pendingQuestion) {
              const qId = `clarify_${statusData.jobId}`;
              setMessages(prev => {
                if (prev.some(m => m.id === qId)) return prev;
                return [...prev, {
                  id: qId,
                  role: 'assistant',
                  content: statusData.pendingQuestion,
                  isClarification: true,
                  timestamp: new Date().toISOString()
                }];
              });
            }
            return;
          }
          // Update todos from job status
          if (statusData.planTodos && statusData.planTodos.length > 0) {
            setPlanTodos(statusData.planTodos);
            planTodosRef.current = statusData.planTodos;
            // Mark the assistant message containing the plan as isPlanResult
            if (statusData.planSummary) setPlanSummary(statusData.planSummary);
            setMessages(prev => {
              // Find the last assistant message with plan content and flag it
              let planMsgId = null;
              for (let i = prev.length - 1; i >= 0; i--) {
                const m = prev[i];
                if (m.role === 'assistant' && m.content && /\n###\s*Summary\s*\n/.test(m.content)) {
                  planMsgId = m.id;
                  if (!m.isPlanResult) m.isPlanResult = true;
                  break;
                }
              }
              if (planMsgId) setPlanMessageId(planMsgId);
              return planMsgId ? [...prev] : prev;
            });
          } else if (statusData.planSummary) {
            setPlanSummary(statusData.planSummary);
          }
          setActiveJobId(statusData.jobId);
        }
      } catch (err) {
        console.error('[AgentPanel] Poll error:', err.message);
      }
    };

    pollingRef.current = setInterval(poll, 200);
    poll(); // Immediate first poll

    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [isStreaming, workspaceChatId, workspaceId]);

  // ── On mount: reconnect to running/interrupted/awaiting jobs ──
  useEffect(() => {
    if (!workspaceId || !workspaceChatId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/agent/status?resume=true`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.active) {
          if (data.status === 'awaiting_input') {
            // Show the pending question without starting polling
            console.log('[AgentPanel] Reconnecting to paused job:', data.jobId);
            setActiveJobId(data.jobId);
            if (data.pendingQuestion) {
              const qId = `clarify_${data.jobId}`;
              setMessages(prev => {
                if (prev.some(m => m.id === qId)) return prev;
                return [...prev, {
                  id: qId,
                  role: 'assistant',
                  content: data.pendingQuestion,
                  isClarification: true,
                  timestamp: new Date().toISOString()
                }];
              });
            }
            return;
          }
          console.log('[AgentPanel] Reconnecting to active job:', data.jobId);
          setActiveJobId(data.jobId);
          setIsStreaming(true);
          setIsThinking(true);
          if (data.planTodos && data.planTodos.length > 0) {
            setPlanTodos(data.planTodos);
            planTodosRef.current = data.planTodos;
            if (data.planSummary) setPlanSummary(data.planSummary);
            // Mark the plan message on reconnect too
            setMessages(prev => {
              for (let i = prev.length - 1; i >= 0; i--) {
                const m = prev[i];
                if (m.role === 'assistant' && m.content && /\n###\s*Summary\s*\n/.test(m.content)) {
                  if (!m.isPlanResult) m.isPlanResult = true;
                  setPlanMessageId(m.id);
                  break;
                }
              }
              return [...prev];
            });
          } else if (data.planSummary) setPlanSummary(data.planSummary);
        }
      } catch (err) {
        console.error('[AgentPanel] Reconnect error:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, workspaceChatId]);

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
    let provider = selectedProvider || localStorage.getItem('aurora_last_provider') || 'openai';
    // Override provider based on model name patterns (even if models API reports wrong source)
    if ((model || '').startsWith('deepseek-')) provider = 'deepseek';
    else if ((model || '').startsWith('claude-')) provider = 'anthropic';
    else if ((model || '').startsWith('gpt-')) provider = 'openai';
    // Thinking effort → temperature mapping, with provider-specific params
    const temp = thinkingEffort === 'high' ? 0.1 : thinkingEffort === 'low' ? 0.5 : 0.3;
    const extraParams = {};
    if (provider === 'deepseek' && thinkingEffort === 'high') {
      // DeepSeek OpenAI-format thinking: reasoning_effort + thinking: { type: "enabled" }
      // No temperature/top_p in thinking mode (DeepSeek ignores them)
      extraParams.reasoning_effort = thinkingEffort;
      extraParams.thinking_type = 'enabled';
    } else if (provider !== 'deepseek' && thinkingEffort === 'high') {
      // LM Studio / Anthropic-format thinking
      extraParams.extended_thinking = true;
    }

    // For DeepSeek thinking mode, omit temperature from the body
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
        body: JSON.stringify(bodyObj)
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
      let currentProvider = selectedProvider || localStorage.getItem('aurora_last_provider') || '';
      // Override provider based on model name patterns
      if ((currentModel || '').startsWith('deepseek-')) currentProvider = 'deepseek';
      else if ((currentModel || '').startsWith('claude-')) currentProvider = 'anthropic';
      else if ((currentModel || '').startsWith('gpt-')) currentProvider = 'openai';
      saveMessageToChat('assistant', content, currentModel, currentProvider, assistantId, new Date().toISOString(), thinking);
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
  const handleRetry = async (msgId) => {
    if (isStreaming) return;
    // Snapshot messages outside of setMessages to avoid stale closure
    const snapshot = messagesRef.current;
    const idx = snapshot.findIndex(m => m.id === msgId);
    if (idx < 0) return;
    // Find the user message that preceded this assistant message
    let userMsg = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (snapshot[i].role === 'user' && !snapshot[i].isToolResult) { userMsg = snapshot[i]; break; }
    }
    if (!userMsg) return;
    const userIdx = snapshot.indexOf(userMsg);

    // Restore workspace files to the state before this message's agent work
    if (workspaceId && userMsg.id) {
      fetch(`/api/workspace/${workspaceId}/checkpoint/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: userMsg.id })
      }).catch(() => {});
    }

    // Tell the server to only use history up to the message before this user message
    const trimAfterId = userIdx > 0 ? snapshot[userIdx - 1].id : null;
    retryTrimAfterIdRef.current = trimAfterId;

    // Trim DB messages to match — delete everything after the trim point
    if (workspaceChatId) {
      try {
        const token = localStorage.getItem('auth_token');
        await fetch(`/api/chats/${workspaceChatId}/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ beforeId: trimAfterId || undefined })
        });
      } catch (_) {}
    }

    // Remove from the user message onward in frontend state
    const trimmed = snapshot.slice(0, userIdx);
    setMessages(trimmed);

    // Re-trigger with the same user content
    let retryContent = userMsg.content;
    setInput(retryContent);
    // Submit after state settles — use requestSubmit for reliable React onSubmit trigger
    setTimeout(() => {
      document.getElementById('agent-input-form')?.requestSubmit();
    }, 100);
  };

  // Retry from user message: trim to that point and resubmit original text
  const handleUserRetry = async (msgId) => {
    if (isStreaming) return;
    const snapshot = messagesRef.current;
    const idx = snapshot.findIndex(m => m.id === msgId);
    if (idx < 0) return;

    // Restore workspace files to the state before this message
    if (workspaceId) {
      fetch(`/api/workspace/${workspaceId}/checkpoint/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: msgId })
      }).catch(() => {});
    }

    // Tell server to trim history after this user message (keep up to and including it)
    retryTrimAfterIdRef.current = msgId;

    // Trim DB messages to match
    if (workspaceChatId) {
      try {
        const token = localStorage.getItem('auth_token');
        await fetch(`/api/chats/${workspaceChatId}/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ beforeId: msgId })
        });
      } catch (_) {}
    }

    const trimmed = snapshot.slice(0, idx + 1);
    setMessages(trimmed);
    setInput(snapshot[idx].content);
    setTimeout(() => {
      document.getElementById('agent-input-form')?.requestSubmit();
    }, 100);
  };

  // Start editing a user message inline
  const handleStartEdit = (msg) => {
    if (isStreaming) return;
    setEditingMessageId(msg.id);
    setEditInput(msg.content);
  };

  // Submit edited user message, trim from that point
  const handleEditSubmit = async (msgId) => {
    if (!editInput.trim() || isStreaming) return;
    const snapshot = messagesRef.current;
    const idx = snapshot.findIndex(m => m.id === msgId);
    if (idx < 0) return;

    // Tell server to trim after the message before this one (keep up to that point)
    const trimAfterId = idx > 0 ? snapshot[idx - 1].id : null;
    retryTrimAfterIdRef.current = trimAfterId;

    // Trim DB messages to match
    if (workspaceChatId) {
      try {
        const token = localStorage.getItem('auth_token');
        await fetch(`/api/chats/${workspaceChatId}/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ beforeId: trimAfterId || undefined })
        });
      } catch (_) {}
    }

    const trimmed = snapshot.slice(0, idx);
    setMessages(trimmed);
    setInput(editInput.trim());
    setEditingMessageId(null);
    setEditInput('');
    setTimeout(() => {
      document.getElementById('agent-input-form')?.requestSubmit();
    }, 100);
  };

  // Stop generation
  const handleStop = async () => {
    // Abort any in-flight SSE stream (Chat mode)
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }

    // Abort agent SSE stream (Agent/Plan mode)
    if (agentStreamAbortRef.current) {
      agentStreamAbortRef.current.abort();
      agentStreamAbortRef.current = null;
    }

    // Cancel server-side agent job (Plan/Agent mode)
    if (activeJobId && workspaceId) {
      try {
        const token = localStorage.getItem('auth_token');
        await fetch(`/api/workspace/${workspaceId}/agent/run`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (err) {
        console.error('[AgentPanel] Failed to cancel job:', err.message);
      }
    }

    // Stop streaming state (polling useEffect will clean up interval)
    setIsStreaming(false);
    setIsThinking(false);
    setActiveJobId(null);
    // Remove any clarification messages
    setMessages(prev => prev.filter(m => !m.isClarification));
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  // Save a message to the workspace's chat via the API
  // Auto-creates a workspace chat if none exists yet (matching page.js behavior)
  const saveMessageToChat = async (role, content, model, provider, msgId, timestamp, thinking = '') => {
    let chatId = workspaceChatId;

    // Auto-create workspace chat if needed (workspaceChatId may be null on first load)
    if (!chatId && workspaceId) {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) { console.error('[saveMessageToChat] No auth_token available'); return; }
        const createRes = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `Workspace: ${workspaceId}`, workspaceId })
        });
        if (!createRes.ok) { console.error('[saveMessageToChat] Failed to create chat:', createRes.status); return; }
        const createData = await createRes.json();
        chatId = createData.id;
        // Cache the mapping so loadWorkspaceChat finds it on next load
        try {
          const wsChats = JSON.parse(localStorage.getItem('aurora_ws_chats') || '{}');
          wsChats[workspaceId] = chatId;
          localStorage.setItem('aurora_ws_chats', JSON.stringify(wsChats));
        } catch {}
      } catch (err) {
        console.error('[saveMessageToChat] Chat creation error:', err);
        return;
      }
    }

    if (!chatId) { console.error('[saveMessageToChat] No chatId available'); return; }

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) { console.error('[saveMessageToChat] No auth_token for message save'); return; }
      await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msgId, role, content, thinking, model: model || '', provider: provider || '', timestamp: timestamp || new Date().toISOString() })
      });
    } catch (err) {
      console.error('[saveMessageToChat] Failed to save message:', err);
    }
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

  // SERVER-DRIVEN AGENT: sends job to server-side runner, polls for updates
  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userContent = input.trim();
    setInput('');
    setIsStreaming(true);
    setIsThinking(true);

    // Detecting plan execution from the message is definitive — it works even if
    // React hasn't flushed setAgentMode('agent') yet (race condition with setTimeout).
    const isPlanExecution = userContent.startsWith('Execute the following plan')
      || userContent === 'Continue implementing the plan.';

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

    // Persist user message (with model-name-based provider override)
    const msgProvider = (selectedModel || '').startsWith('deepseek-') ? 'deepseek'
      : (selectedModel || '').startsWith('claude-') ? 'anthropic'
      : (selectedModel || '').startsWith('gpt-') ? 'openai'
      : selectedProvider;
    saveMessageToChat('user', userContent, selectedModel, msgProvider, userMsg.id, userMsg.timestamp);

    const effectiveMode = isPlanExecution ? 'agent' : agentModeRef.current;
    let systemPrompt = buildSystemPrompt(workspaceId, activeFilePath, currentFileContent, effectiveMode);

    // Inject plan into system prompt so the model ALWAYS knows what remains.
    if ((isPlanExecution || agentModeRef.current === 'agent') && planTodosRef.current.length > 0) {
      const todos = planTodosRef.current;
      const doneCount = todos.filter(t => t.done).length;
      const pending = todos.filter(t => !t.done);
      const nextTask = pending[0];

      let planBlock = `\n\nDONE: ${doneCount}/${todos.length} | NEXT: `;
      if (nextTask) {
        planBlock += `${nextTask.text}`;
      } else {
        planBlock += `ALL DONE — respond "Task complete"`;
      }
      planBlock += `\n`;
      for (const t of todos) {
        planBlock += `${t.done ? '[x]' : '[ ]'} ${t.text}\n`;
      }
      planBlock += `\nWork on the NEXT task above. Use a tool call NOW.`;
      systemPrompt = systemPrompt + planBlock;
    }

    // ── Chat mode: Direct SSE streaming (no server-side agent loop) ──
    if (effectiveMode === 'chat') {
      try {
        const chatMessages = messagesRef.current.concat([userMsg]).map(m => ({
          role: m.role === 'error' ? 'assistant' : m.role,
          content: m.content
        }));

        // Prepend system prompt if present
        if (systemPrompt) {
          chatMessages.unshift({ role: 'system', content: systemPrompt });
        }

        // Build headers with API keys from localStorage
        const headers = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('auth_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const openaiKey = localStorage.getItem('OPENAI_API_KEY');
        const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
        const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
        const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
        let lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
        const lmStudioHost = localStorage.getItem('LM_STUDIO_HOST');
        const lmStudioPort = localStorage.getItem('LM_STUDIO_PORT');
        const lmStudioApiKeyD = localStorage.getItem('LM_STUDIO_API_KEY');
        if (!lmStudioUrl && lmStudioHost && lmStudioPort) {
          lmStudioUrl = `http://${lmStudioHost}:${lmStudioPort}/v1`;
        }
        if (openaiKey) headers['x-openai-key'] = openaiKey;
        if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
        if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
        if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
        if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
        if (lmStudioHost) headers['x-lmstudio-host'] = lmStudioHost;
        if (lmStudioPort) headers['x-lmstudio-port'] = lmStudioPort;
        if (lmStudioApiKeyD) headers['x-lmstudio-api-key'] = lmStudioApiKeyD;

        // Create abort controller for stop
        const controller = new AbortController();
        streamAbortRef.current = controller;

        const temp = thinkingEffort === 'high' ? 0.1 : thinkingEffort === 'low' ? 0.5 : 0.3;
        const extraParams = {};
        if (msgProvider === 'deepseek' && thinkingEffort === 'high') {
          extraParams.reasoning_effort = thinkingEffort;
          extraParams.thinking_type = 'enabled';
        } else if (msgProvider !== 'deepseek' && thinkingEffort === 'high') {
          extraParams.extended_thinking = true;
        }

        const bodyObj = {
          model: selectedModel,
          messages: chatMessages,
          provider: msgProvider,
          stream: true,
          max_tokens: null,
          ...extraParams,
        };
        if (!(msgProvider === 'deepseek' && thinkingEffort === 'high')) {
          bodyObj.temperature = temp;
          bodyObj.top_p = 1;
        }

        const res = await fetch('/api/v1/chat/completions', {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify(bodyObj)
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `Failed to get response from ${selectedModel}`);
        }

        // Read SSE stream for real-time thinking + content
        const assistantId = `agent_asst_${Date.now()}`;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';
        let streamedContent = '';
        let streamedThinking = '';
        let messageCreated = false;

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
              const delta = data.choices?.[0]?.delta;
              if (!delta) continue;

              const think = delta.thinking || delta.reasoning_content || delta.reasoning || '';
              if (think) streamedThinking += think;

              const contentChunk = delta.content || '';
              if (contentChunk) streamedContent += contentChunk;

              if (!messageCreated) {
                messageCreated = true;
                setMessages(prev => [...prev, {
                  id: assistantId,
                  role: 'assistant',
                  content: streamedContent,
                  thinking: streamedThinking || undefined,
                  timestamp: new Date().toISOString(),
                  model: data.model || selectedModel,
                  provider: msgProvider,
                  turnId
                }]);
              } else {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: streamedContent, thinking: streamedThinking || m.thinking }
                    : m
                ));
              }
            } catch {}
          }
        }

        // Strip echoed plan content — model may repeat the injected build plan verbatim
        let finalContent = streamedContent;
        const finalThinking = streamedThinking;
        if (finalContent && /^(?:\s*(?:\[x\]|\[ \])\s+.+(?:\n|$)){3,}/m.test(finalContent)) {
          // Content is mostly echoed plan lines — strip them out
          finalContent = finalContent.replace(/^\s*(?:\[x\]|\[ \])\s+.+\n?/gm, '').trim();
          // Also strip the BUILD PLAN header if present
          finalContent = finalContent.replace(/={2,}\s*BUILD PLAN[\s\S]*?={2,}\n?/g, '').trim();
          // Also strip the NEXT TASK / CRITICAL lines
          finalContent = finalContent.replace(/^(?:NEXT TASK|CRITICAL|IMPORTANT):.+\n?/gm, '').trim();
        }
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: finalContent, thinking: finalThinking || undefined }
            : m
        ));

        // Persist assistant message to chat — use cleaned content
        if (finalContent) {
          saveMessageToChat('assistant', finalContent, selectedModel, msgProvider, assistantId, new Date().toISOString(), finalThinking);

          // Auto-detect plan format from Chat mode responses — render plan card without page refresh
          if (effectiveMode === 'chat') {
            const planResult = parsePlanTodos(finalContent);
            if (planResult.todos.length > 0) {
              setPlanTodos(planResult.todos);
              setPlanSummary(planResult.summary);
              setPlanMessageId(assistantId);
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, isPlanResult: true } : m
              ));
            }
          }
        }

        setIsStreaming(false);
        setIsThinking(false);
      } catch (err) {
        if (err.name === 'AbortError') {
          setIsStreaming(false);
          setIsThinking(false);
          return;
        }
        setIsStreaming(false);
        setIsThinking(false);
        setMessages(prev => [...prev, {
          id: `agent_err_${Date.now()}`,
          role: 'assistant',
          content: `Error: ${err.message}`,
          isError: true,
          timestamp: new Date().toISOString(),
          turnId
        }]);
      }
      return;
    }

    // ── Start the server-side agent job (Plan/Agent modes) ──
    try {
      const token = localStorage.getItem('auth_token');
      // Collect API keys from localStorage so the server-side runner can use them
      const apiKeys = {
        lmStudioUrl: localStorage.getItem('LM_STUDIO_URL') || '',
        lmStudioHost: localStorage.getItem('LM_STUDIO_HOST') || '',
        lmStudioPort: localStorage.getItem('LM_STUDIO_PORT') || '',
        lmStudioApiKey: localStorage.getItem('LM_STUDIO_API_KEY') || '',
        deepseekKey: localStorage.getItem('DEEPSEEK_API_KEY') || '',
        openaiKey: localStorage.getItem('OPENAI_API_KEY') || '',
        anthropicKey: localStorage.getItem('ANTHROPIC_API_KEY') || '',
      };
      const res = await fetch(`/api/workspace/${workspaceId}/agent/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chatId: workspaceChatId,
          userContent,
          userMessageId: userMsg.id,
          model: selectedModel,
          provider: msgProvider,
          thinkingEffort,
          agentMode: effectiveMode,
          systemPrompt,
          apiKeys,
          trimAfterMessageId: retryTrimAfterIdRef.current || undefined
        })
      });
      retryTrimAfterIdRef.current = null;  // clear for next send

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Failed to start agent job (${res.status})`);
      }

      const data = await res.json();
      setActiveJobId(data.jobId);
      // Re-affirm streaming — polling may have been killed by an early poll that saw no job yet
      setIsStreaming(true);
      setIsThinking(true);

      // ── Connect to real-time SSE stream for letter-by-letter thinking/content ──
      let streamIterId = 0;
      let streamAssistId = `agent_asst_${Date.now()}`;
      let streamedThinking = '';
      let streamedContent = '';
      let streamMessageCreated = false;

      // Create abort controller for agent SSE stream
      const agentStreamController = new AbortController();
      agentStreamAbortRef.current = agentStreamController;

      (async () => {
        try {
          const streamRes = await fetch(
            `/api/workspace/${workspaceId}/agent/stream?jobId=${encodeURIComponent(data.jobId)}`,
            { signal: agentStreamController.signal }
          );
          if (!streamRes.ok) return;
          const reader = streamRes.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue;
              try {
                const evt = JSON.parse(jsonStr);
                if (evt.type === 'done' || evt.type === 'error' || evt.type === 'stop') {
                  // Detect plan content so Execute Plan button shows immediately
                  if (streamedContent && /\n###\s*Summary\s*\n/.test(streamedContent)) {
                    const planResult = parsePlanTodos(streamedContent);
                    if (planResult.todos.length > 0) {
                      setPlanTodos(planResult.todos);
                      setPlanSummary(planResult.summary);
                      setPlanMessageId(streamAssistId);
                      setMessages(prev => prev.map(m =>
                        m.id === streamAssistId ? { ...m, isPlanResult: true } : m
                      ));
                    }
                  }
                  return;
                }
                if (evt.type === 'iteration_end') {
                  // Current iteration's stream content is done; reset for next
                  // (server-side agent-runner persists to DB, polling will sync)
                  if (streamedContent && /\n###\s*Summary\s*\n/.test(streamedContent)) {
                    const planResult = parsePlanTodos(streamedContent);
                    if (planResult.todos.length > 0) {
                      setPlanTodos(planResult.todos);
                      setPlanSummary(planResult.summary);
                      setPlanMessageId(streamAssistId);
                      setMessages(prev => prev.map(m =>
                        m.id === streamAssistId ? { ...m, isPlanResult: true, isPlanCard: true } : m
                      ));
                    }
                  }
                  streamIterId++;
                  streamAssistId = `agent_asst_${Date.now()}`;
                  streamedThinking = '';
                  streamedContent = '';
                  streamMessageCreated = false;
                  continue;
                }
                if (evt.type === 'files_changed') {
                  // Agent wrote files — trigger file tree refresh in parent
                  onFileTreeChange?.();
                  continue;
                }
                if (evt.type === 'thinking') {
                  streamedThinking += evt.text;
                } else if (evt.type === 'content') {
                  streamedContent += evt.text;
                }
                if (!streamMessageCreated && (streamedThinking || streamedContent)) {
                  streamMessageCreated = true;
                  setMessages(prev => [...prev, {
                    id: streamAssistId,
                    role: 'assistant',
                    content: streamedContent,
                    thinking: streamedThinking || undefined,
                    timestamp: new Date().toISOString(),
                    model: selectedModel,
                    provider: msgProvider,
                    turnId
                  }]);
                } else if (streamMessageCreated) {
                  const curId = streamAssistId;
                  const curThinking = streamedThinking;
                  const curContent = streamedContent;
                  setMessages(prev => prev.map(m =>
                    m.id === curId
                      ? { ...m, content: curContent, thinking: curThinking || m.thinking }
                      : m
                  ));
                }
              } catch {}
            }
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.error('[AgentPanel] Agent stream error:', err.message);
          }
        } finally {
          agentStreamAbortRef.current = null;
        }
      })();

      // Polling will start via the useEffect that watches isStreaming
    } catch (err) {
      setIsStreaming(false);
      setIsThinking(false);
      setMessages(prev => [...prev, {
        id: `agent_err_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err.message}`,
        isError: true,
        timestamp: new Date().toISOString(),
        turnId
      }]);
    }
  };

  // Tool names that take a block body (the content is the body of the fenced block)
  const CONTENT_TOOLS = ['create_file', 'replace_string_in_file', 'run_in_terminal', 'create_skill'];

  // Parser: finds ```TOOL_NAME key="val"... blocks and extracts tool calls
  const parseToolCalls = (content) => {
    const calls = [];

    // ── XML-format tool calls ──
    // Handles three variants used by DeepSeek v4 and other models:
    //   1. <toolName>\n<param>value</param>\n</toolName>  (child-element params)
    //   2. <toolName attr="val">body text</toolName>      (attribute params + raw body)
    //   3. <toolName attr="val"/>                          (self-closing, attributes only)

    const KNOWN_TOOL_NAMES = new Set([
      'list_dir', 'read_file', 'grep_search', 'create_file',
      'replace_string_in_file', 'run_in_terminal', 'dev_server_status',
      'dev_server_start', 'dev_server_stop', 'show_preview', 'create_skill'
    ]);
    const parseAttrs = (attrString) => {
      const a = {};
      const re = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(attrString)) !== null) a[m[1]] = m[2];
      // Canonicalize filePath/path
      if (a.filePath === undefined && a.path !== undefined) a.filePath = a.path;
      if (a.path === undefined && a.filePath !== undefined) a.path = a.filePath;
      return a;
    };

    // ── Variant 3: Self-closing tags <toolName attr="val"/> ──
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

    // ── Variants 1 & 2: <toolName ...attrs...>body</toolName> ──
    const xmlRegex = /<(\w+)((?:\s+\w+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/gi;
    let xmlMatch;
    while ((xmlMatch = xmlRegex.exec(content)) !== null) {
      const toolName = xmlMatch[1].toLowerCase();
      if (!KNOWN_TOOL_NAMES.has(toolName)) continue;
      const args = parseAttrs(xmlMatch[2]);   // attributes on opening tag (Variant 2)
      const innerContent = xmlMatch[3];         // everything between tags

      // Parse child elements as key-value pairs: <filePath>value</filePath> or <path>.</path>
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

      // Any text NOT inside child tags is the raw body (e.g. create_file content)
      const bodyText = innerContent.slice(lastChildEnd).trim();
      if (bodyText && args.content === undefined) args.content = bodyText;

      // Canonicalize after child-parsing too
      if (args.filePath === undefined && args.path !== undefined) args.filePath = args.path;

      // Validate required args
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

    // ── Bracket syntax: [toolName arg="val"] ... [/toolName] ──
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

    // ── Bare tool calls: toolName arg="val"\nbody ──
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

    // ── Fenced-code-block tool calls: ```toolName arg="value"\nbody\n``` ──
    // Match entire tool block: ```toolName...``` — handles both inline (same-line body) and multi-line
    const regex = /```\s*(\w+)\b\s*(.*?)```/gs;
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

    // Chat mode — conversational assistant with workspace awareness
    if (mode === 'chat') {
      // ── Build past learnings block from corpus entries ──
      let chatLearnings = '';
      const chatUnresolved = corpusEntries.filter(e => !e.resolved);
      const chatResolved = corpusEntries.filter(e => e.resolved && e.resolution);
      if (chatUnresolved.length > 0) {
        const recent = chatUnresolved.slice(-3);
        chatLearnings = '⚠️  PAST LEARNINGS (avoid repeating these):\n';
        for (const e of recent) chatLearnings += `- ${e.problem.slice(0, 150)}\n`;
        chatLearnings += '\n';
      }
      if (chatResolved.length > 0) {
        chatLearnings += '✅ KNOWN FIXES:\n';
        for (const e of chatResolved.slice(-3)) chatLearnings += `- ${e.problem.slice(0, 100)} → ${e.resolution.slice(0, 150)}\n`;
        chatLearnings += '\n';
      }

      // ── Build relevant skills block ──
      let chatSkills = '';
      if (skills.length > 0) {
        chatSkills = '📚 AVAILABLE SKILLS:\n';
        for (const s of skills.slice(0, 5)) chatSkills += `- ${s.name}: ${(s.description || '').slice(0, 100)}\n`;
        chatSkills += '\n';
      }

      return `${workspaceAgentsMd ? '⚠️  AGENTS.md RULES:\n\n' + workspaceAgentsMd + '\n\n---\n\n' : ''}${chatLearnings}${chatSkills}You are a helpful AI assistant chatting with a developer in their workspace. The workspace is at /api/workspace/${wsId}.

You are in CHAT MODE — this is a free conversation. You can:
- **Ask clarifying questions** about what the user wants to build.
- **Discuss approaches, tradeoffs, and architecture**.
- **Explain code, concepts, and best practices**.
- **Suggest next steps** — but do NOT write files or execute actions unless the user explicitly asks you to switch to Agent mode.

**⚠️ CROSS-MODE CONTEXT:** This conversation is shared across all modes. When the user switches to **Plan mode** or **Agent mode**, the new mode WILL see everything you discuss here. Be thorough — your discussion here becomes the specification for planning and execution.

When the user is ready to build, tell them to switch to **Plan mode** (📋 tab) to generate a structured step-by-step plan. After the plan is reviewed, they can switch to **Agent mode** (🤖 tab) for autonomous execution.

Be concise but thorough. Ask questions when the user's request is ambiguous — it's better to clarify NOW than build the wrong thing later.`;
    }

    // Plan mode — conversational planning with workspace exploration and structured output
    if (mode === 'plan') {
      // ── Build past learnings block for Plan mode ──
      let planLearnings = '';
      const planUnresolved = corpusEntries.filter(e => !e.resolved);
      const planResolved = corpusEntries.filter(e => e.resolved && e.resolution);
      if (planUnresolved.length > 0) {
        const recent = planUnresolved.slice(-3);
        planLearnings = '⚠️  PAST LEARNINGS (avoid repeating these):\n';
        for (const e of recent) planLearnings += `- ${e.problem.slice(0, 150)}\n`;
        planLearnings += '\n';
      }
      if (planResolved.length > 0) {
        planLearnings += '✅ KNOWN FIXES:\n';
        for (const e of planResolved.slice(-3)) planLearnings += `- ${e.problem.slice(0, 100)} → ${e.resolution.slice(0, 150)}\n`;
        planLearnings += '\n';
      }

      // ── Build relevant skills block ──
      let planSkills = '';
      if (skills.length > 0) {
        planSkills = '📚 AVAILABLE SKILLS:\n';
        for (const s of skills.slice(0, 5)) planSkills += `- ${s.name}: ${(s.description || '').slice(0, 100)}\n`;
        planSkills += '\n';
      }

      return `${workspaceAgentsMd ? '⚠️  AGENTS.md RULES:\n\n' + workspaceAgentsMd + '\n\n---\n\n' : ''}${planLearnings}${planSkills}You are a helpful AI assistant in PLAN MODE working with a developer in their workspace. The workspace is at /api/workspace/${wsId}.

You are in PLAN MODE — your goal is to explore the workspace and produce a structured implementation plan. You must NEVER write or modify files in this mode. You CAN use exploration tools (list_dir, read_file, grep_search) to understand the codebase.

**Other available modes (all share the same conversation — you can see messages from any mode):**
- **Chat mode** — for free discussion, questions, and brainstorming. The user may have discussed their project here first — check the conversation history.
- **Agent mode** — for autonomous file creation and editing once a plan is ready.

**⚠️ CRITICAL — CROSS-MODE CONTEXT:** The messages in this conversation may include prior discussions from Chat mode. If you see detailed feature discussions, tech choices, or clarifications in earlier messages, USE THEM. Do NOT re-ask questions that were already answered. The user expects you to pick up where Chat mode left off and generate a plan from what was already discussed.

## WORKFLOW
1. **Read the conversation history first** — especially messages marked as [USER] and [ASSISTANT] from before this message. They contain the user's requirements, preferences, and prior discussion.
2. **Discuss & clarify** ONLY if critical information is missing. If the conversation history already answers the questions, proceed directly to planning.
3. **Explore the workspace** using tools like list_dir, read_file, and grep_search to understand what already exists.
4. **Produce a concrete plan** in the format below. Every task MUST reference specific file paths.

## EXPLORATION TOOL FORMAT
Use fenced code blocks. Do NOT use XML tags:

\`\`\`list_dir path="."
\`\`\`

\`\`\`read_file filePath="src/index.ts"
\`\`\`

\`\`\`grep_search query="your search pattern"
\`\`\`

- Print ONLY ONE tool per response.
- After getting results, briefly state what you found, then either explore more OR output the plan.

## PLAN FORMAT (output this EXACTLY)

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
- **After outputting the plan, STOP**. The system will surface it to the user with an "Execute Plan" button.`;
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

    let prompt = `You are in AGENT MODE — you autonomously create and modify files in this workspace. The user can switch to Chat mode for discussion or Plan mode to generate a structured task list before execution.

**⚠️ CROSS-MODE CONTEXT:** This conversation includes messages from all modes (Chat, Plan, Agent). If you see prior discussions, plans, or task lists in the conversation history, USE THEM. The user expects continuity across modes. If a plan was already generated in Plan mode, you should see it in the messages and follow it.

Workspace: /api/workspace/${wsId}.
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
    const baseName = fp.split('/').pop() || fp;
    switch (name) {
      case 'read_file': return `Read \`${fp}\` (${result.size || result.content?.length || 0} bytes)`;
      case 'create_file': {
        // Use result data first, fall back to counting args.content
        const n = result.linesAdded || result.totalLines || (typeof args.content === 'string' ? args.content.split('\n').length : 0);
        return n ? `Created \`${baseName}+${n}\`` : `Created \`${baseName}\``;
      }
      case 'replace_string_in_file': {
        // Total lines swapped: +newLines-oldLines (Copilot-style)
        const newLines = result.newLines ?? (args.newString ? args.newString.split('\n').length : 0);
        const oldLines = result.oldLines ?? (args.oldString ? args.oldString.split('\n').length : 0);
        return `Edited \`${baseName}+${newLines}-${oldLines}\``;
      }
      case 'grep_search': return `Found ${result.results?.length || 0} matches for "${args.query}"`;
      case 'list_dir': return `Listed ${fp}`;
      case 'run_in_terminal': return `Ran \`${(args.command || '').slice(0, 60)}\``;
      case 'dev_server_status': return `Checked dev server status`;
      case 'dev_server_start': return `Started dev server (${args.command || 'npm run dev'})`;
      case 'dev_server_stop': return `Stopped dev server`;
      case 'show_preview': return `Opened preview panel`;
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

  // Decode HTML entities (e.g. &lt; → <, &gt; → >, &amp; → &)
  const decodeHTMLEntities = (text) => {
    if (!text) return text;
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x2F;/g, '/');
  };

  // Shared code-block-aware text renderer — parses fenced code blocks and renders
  // with SyntaxHighlighter + ReactMarkdown. Used for both message content and thinking.
  const renderCodeAwareText = (text, opts = {}) => {
    if (!text || !text.trim()) return null;
    const { fontSize = 'text-xs', showApply = false, compact = false } = opts;

    // Decode HTML entities first so code renders correctly
    const decoded = decodeHTMLEntities(text);

    // Parse fenced code blocks
    const parts = decoded.split(/(```[^\n]*\n[\s\S]*?\n```)/g);

    return (
      <div className={fontSize}>
        {parts.map((part, i) => {
          const codeMatch = part.match(/```(\w*)[^\n]*\n([\s\S]*?)\n```/);
          if (codeMatch) {
            const lang = codeMatch[1] || 'text';
            const code = codeMatch[2];
            if (!code.trim()) return null;
            return (
              <div key={i} className={`relative ${compact ? 'my-1' : 'my-2'} group`}>
                <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 rounded-t-lg border border-zinc-700/30 border-b-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${getLangColor(lang).replace('text-', 'bg-')}`} />
                    <span className={`text-[10px] uppercase font-medium ${getLangColor(lang)}`}>{lang}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {showApply && onFileEdit && activeFilePath && (
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
                    fontSize: compact ? '10px' : '11px',
                    lineHeight: 1.5,
                    background: '#0d0d0d',
                  }}
                >
                  {code}
                </SyntaxHighlighter>
              </div>
            );
          }

          // Regular text — use ReactMarkdown for rich formatting
          if (!part.trim()) return null;
          return (
            <div key={i} className="prose prose-invert prose-zinc max-w-none prose-code:bg-zinc-700/50 prose-code:text-zinc-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-700/40 prose-pre:rounded-xl prose-pre:text-xs prose-headings:text-zinc-100 prose-a:text-indigo-400 prose-strong:text-zinc-100 prose-li:marker:text-zinc-500 prose-p:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {part}
              </ReactMarkdown>
            </div>
          );
        })}
      </div>
    );
  };

  // Render message content with syntax highlighting + ReactMarkdown for rich text
  const renderMessageContent = (msg) => {
    if (msg.isError) {
      return <div className="text-red-400 text-xs">{msg.content}</div>;
    }
    // Plan result messages: don't show raw content, only the structured plan UI
    if (msg.isPlanResult) return null;

    // Remove tool call fenced blocks AND XML-format tool tags from displayed content
    const toolBlockRegex = /```(create_file|replace_string_in_file|read_file|list_dir|grep_search|run_in_terminal|dev_server_start|dev_server_stop|dev_server_status|show_preview|create_skill)\b[\s\S]*?\n```/g;
    const xmlToolRegex = /<(read_file|list_dir|grep_search|create_file|replace_string_in_file|run_in_terminal|dev_server_start|dev_server_stop|dev_server_status|show_preview|create_skill)(\s+[^>]*)?\/?>[\s\S]*?<\/\1>|<(read_file|list_dir|grep_search|create_file|replace_string_in_file|run_in_terminal|dev_server_start|dev_server_stop|dev_server_status|show_preview|create_skill)(\s+[^>]*)?\s*\/>/gi;
    let cleanContent = msg.content ? msg.content.replace(toolBlockRegex, '').replace(xmlToolRegex, '').trim() : '';
    // Also strip leftover self-closing tags and empty fenced code blocks (info-string-only blocks with no body)
    cleanContent = cleanContent.replace(/<\w+(\s+\w+="[^"]*")*\s*\/>/g, '').replace(/```[^\n]+\n\s*```/g, '').trim();
    // Strip [x] progress/task lines that LLMs output following the system prompt
    // (catches both streaming and history-loaded/db-persisted messages)
    cleanContent = cleanContent.replace(/^\s*\[x\]\s+(?:PROGRESS|Task|task)\b[^\n]*\n?/gmi, '').trim();

    // If there's nothing to display, return null.
    if (!cleanContent) return null;

    return renderCodeAwareText(cleanContent, {
      showApply: msg.role === 'assistant',
      fontSize: 'text-xs',
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
    const baseName = fp.split('/').pop() || fp;

    // Compute diff annotation for file write operations (VS Code Copilot-style)
    // Uses tc.args since tool calls parsed from text content don't have execution results.
    let diffAnnotation = null;
    if (tc.status === 'done' && tc.name === 'create_file') {
      const content = tc.args?.content || '';
      const n = typeof content === 'string' ? content.split('\n').length : 0;
      if (n > 0) diffAnnotation = { text: `+${n}`, color: 'text-emerald-400' };
    } else if (tc.status === 'done' && tc.name === 'replace_string_in_file') {
      const oldLines = (tc.args?.oldString || '').split('\n').length;
      const newLines = (tc.args?.newString || '').split('\n').length;
      if (oldLines > 0 || newLines > 0) {
        diffAnnotation = { text: `+${newLines}-${oldLines}`, color: newLines > oldLines ? 'text-emerald-400' : oldLines > newLines ? 'text-amber-400' : 'text-amber-400' };
      }
    }

    return (
      <div className={`mt-1.5 border-l-[3px] ${borderColor} bg-zinc-800/60 rounded-r-md overflow-hidden shadow-sm`}>
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700/50 transition-colors text-left"
        >
          <span className="text-sm">{getToolIcon(tc.name)}</span>
          <span className="font-semibold text-zinc-200">{tc.name}</span>
          {baseName && <span className="text-zinc-400 font-mono text-[10px] truncate max-w-[160px]">{baseName}</span>}
          {diffAnnotation && (
            <span className={`font-mono text-[10px] font-medium ${diffAnnotation.color}`}>{diffAnnotation.text}</span>
          )}
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
          <div className="px-3 py-2.5 border-t border-zinc-700/30 text-[11px] text-zinc-400 space-y-1.5 bg-zinc-900/30">
            {tc.args && Object.keys(tc.args).filter(k => k !== 'content' && k !== 'oldString' && k !== 'newString').length > 0 && (
              <div>
                <span className="text-zinc-500 font-medium">Args: </span>
                {Object.entries(tc.args).filter(([k]) => k !== 'content' && k !== 'oldString' && k !== 'newString').map(([k, v]) => (
                  <span key={k} className="text-zinc-400">{k}=<span className="text-zinc-200">{String(v).slice(0, 80)}</span> </span>
                ))}
              </div>
            )}
            {tc.result?.error ? (
              <div className="text-red-400">{tc.result.error}</div>
            ) : tc.result?.content && tc.name === 'read_file' ? (
              <pre className="text-zinc-300 whitespace-pre-wrap font-mono max-h-[120px] overflow-y-auto bg-zinc-950/60 p-2 rounded text-[10px]">{String(tc.result.content).slice(0, 500)}</pre>
            ) : tc.result?.results && tc.name === 'grep_search' ? (
              <div className="space-y-0.5">
                {tc.result.results.slice(0, 8).map((r, i) => (
                  <div key={i} className="text-zinc-400">
                    <span className="text-zinc-500">{r.path}:{r.line}</span> — {r.content?.slice(0, 100)}
                  </div>
                ))}
              </div>
            ) : tc.result?.files && tc.name === 'list_dir' ? (
              <div className="flex flex-wrap gap-1">
                {tc.result.files.slice(0, 20).map(f => (
                  <span key={f.name || f.path} className="text-zinc-300 bg-zinc-800/70 px-1.5 py-0.5 rounded text-[10px]">{f.name || f.path}</span>
                ))}
              </div>
            ) : tc.status === 'done' ? (
              <div className="text-emerald-400 font-medium">{getToolSummary(tc.name, tc.args, tc.result || {})}</div>
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
          {onToggleMode && codeMode === 'vibe' ? (
            <button
              onClick={onToggleMode}
              className="p-1 rounded text-zinc-500 hover:text-purple-400 transition-colors"
              title="Switch to Full Workspace"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          ) : onToggleMode ? (
            <button
              onClick={onToggleMode}
              className="p-1 rounded text-zinc-500 hover:text-purple-400 transition-colors"
              title="Switch to Vibe Code"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </button>
          ) : null}
          {messages.length > 0 && (
            <button
              onClick={async () => {
                if (!isStreaming) {
                  // Reset workspace files to clean state
                  if (workspaceId) {
                    try {
                      const res = await fetch(`/api/workspace/${workspaceId}/checkpoint/reset`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                      });
                      if (!res.ok) {
                        console.error('[ClearChat] Reset failed:', res.status);
                      }
                    } catch (err) {
                      console.error('[ClearChat] Reset error:', err);
                    }
                  }
                  // Clear all messages from DB
                  if (workspaceChatId) {
                    try {
                      const token = localStorage.getItem('auth_token');
                      if (token) {
                        await fetch(`/api/chats/${workspaceChatId}/messages`, {
                          method: 'DELETE',
                          headers: { 'Authorization': `Bearer ${token}` }
                        });
                      }
                    } catch {}
                  }
                  setMessages([]);
                }
              }}
              className="p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
              title="Clear chat and revert files"
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
          // VS Code style: thinking auto-expands while streaming, collapses when finished.
          // User can manually toggle to override (stored in expandedThinkingIds).
          const isThinkingExpanded = isStreamingThis ? hasThinking : expandedThinkingIds.has(msg.id);
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

                      // Plan state is already in the system prompt — just tell the
                      // agent to continue. No need to paste plan text as a user message.
                      setInput('Continue implementing the plan.');
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

                  {/* Thinking block — VS Code Copilot style: collapsible reasoning (matches chat page) */}
                  {showThinkingToggle && (
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={toggleThinking}
                        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors w-full text-left"
                      >
                        <svg className={`w-3 h-3 transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span>{getThinkingLabel(msg.thinking, isStreamingThis)}</span>
                        {isStreamingThis && (
                          <span className="inline-flex gap-0.5">
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        )}
                      </button>
                      {isThinkingExpanded && (
                        <div className="mt-2 pl-4 border-l-2 border-zinc-600/50 relative rounded-lg rounded-l-none bg-zinc-900/60 py-2">
                          {isStreamingThis && (msg.thinking || '').length > 150 && (
                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-zinc-900/80 via-zinc-900/30 to-transparent z-10 rounded-b-lg" />
                          )}
                          <div
                            ref={isStreamingThis ? thinkingContainerRef : undefined}
                            className="text-[11px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto tracking-tight"
                            style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}
                          >
                            <div className="py-0.5">
                              {msg.thinking}
                            </div>
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
            { id: 'chat', icon: '💬', label: 'Chat' },
            { id: 'plan', icon: '📋', label: 'Plan' },
            { id: 'agent', icon: '🤖', label: 'Agent' },
          ].map(mode => (
            <button
              key={mode.id}
              type="button"
              onClick={() => { setAgentMode(mode.id); agentModeRef.current = mode.id; }}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                agentMode === mode.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={
                mode.id === 'chat' ? 'Chat mode — free conversation, ask questions'
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
        <form id="agent-input-form" onSubmit={sendMessage} className="flex items-start gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isStreaming) sendMessage(e);
              }
            }}
            placeholder={
              activeJobId && messages.some(m => m.isClarification) ? 'Answer the question... (Shift+Enter for newline)'
              : agentMode === 'chat' ? 'Ask anything... (Shift+Enter for newline)'
              : agentMode === 'plan' ? 'Ask for a plan... (Shift+Enter for newline)'
              : 'Ask agent to build, edit, or fix... (Shift+Enter for newline)'
            }
            disabled={isStreaming}
            rows={1}
            className="flex-1 bg-zinc-800 border border-zinc-700/40 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all disabled:opacity-50 resize-none min-h-[32px] max-h-[120px]"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="p-1.5 rounded-lg bg-red-600 hover:bg-red-500 transition-colors flex-shrink-0"
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
              className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
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
