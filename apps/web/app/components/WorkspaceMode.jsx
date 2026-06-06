// @aurora/web - WorkspaceMode container: FileTree + Editor + AgentPanel

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import FileTree from './FileTree';
import MonacoEditor from './MonacoEditor';
import FileTabs from './FileTabs';
import AgentPanel from './AgentPanel';
import PreviewPanel from './PreviewPanel';

// xterm.js uses browser APIs, must be client-only
const TerminalPanel = dynamic(() => import('./TerminalPanel'), { ssr: false });

export default function WorkspaceMode({ onWorkspaceDeleted }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacePage, setWorkspacePage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(4);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContents, setFileContents] = useState({}); // { path: content }
  const [treeSearch, setTreeSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [creationStep, setCreationStep] = useState(null); // null | 'select' | 'form'
  const [creationMode, setCreationMode] = useState('full'); // 'full' | 'vibe'
  const [codeMode, setCodeMode] = useState('full'); // active workspace's mode
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [createName, setCreateName] = useState('');
  const [previewInfo, setPreviewInfo] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState('');
  const [workspaceChatId, setWorkspaceChatId] = useState(null);
  const [workspaceMessages, setWorkspaceMessages] = useState(null);

  // === Resizable pane state ===
  const MIN_LEFT = 200;     // minimum file tree width
  const MIN_RIGHT = 280;    // minimum agent panel width
  const MIN_TERMINAL = 120; // minimum terminal height
  const DEFAULT_LEFT = 260;
  const DEFAULT_RIGHT = 360;
  const DEFAULT_TERMINAL = 220;

  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL);
  const draggingRef = useRef(null); // { handle: 'left'|'right'|'terminal', startX, startY, startSize }

  // Attach global mouse handlers for resize dragging
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!draggingRef.current) return;
      const { handle, startX, startY, startSize } = draggingRef.current;

      if (handle === 'left') {
        const delta = e.clientX - startX;
        setLeftWidth(Math.max(MIN_LEFT, startSize + delta));
      } else if (handle === 'right') {
        const delta = startX - e.clientX; // drag left = wider panel
        setRightWidth(Math.max(MIN_RIGHT, startSize + delta));
      } else if (handle === 'terminal') {
        const delta = startY - e.clientY; // drag up = taller terminal
        setTerminalHeight(Math.max(MIN_TERMINAL, startSize + delta));
      }
    };

    const onMouseUp = () => {
      draggingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startDrag = (handle, e, currentSize) => {
    e.preventDefault();
    draggingRef.current = { handle, startX: e.clientX, startY: e.clientY, startSize: currentSize };
    document.body.style.cursor = handle === 'terminal' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  };
  // === End resizable pane state ===

  // Load workspaces on mount
  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const res = await fetch('/api/workspace/list');
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
      setWorkspacePage(1);
    } catch (err) {
      console.error('Load workspaces error:', err);
    }
  };

  const openWorkspace = async (ws) => {
    setActiveWorkspace(ws);
    setIsLoading(true);
    setError('');
    setOpenFiles([]);
    setActiveFile(null);
    setFileContents({});
    setShowPreview(false);
    setPreviewInfo(null);
    setShowTerminal(false);
    setTerminalCommand('');
    setWorkspaceChatId(null);
    setWorkspaceMessages(null);
    setCodeMode(ws.codeMode || 'full');

    try {
      const res = await fetch(`/api/workspace/${ws.id}/tree`);
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setFileTree(data.tree || []);
      }
    } catch (err) {
      setError('Failed to load workspace');
    } finally {
      setIsLoading(false);
    }

    // Fetch preview info
    try {
      const previewRes = await fetch(`/api/workspace/${ws.id}/preview-info`);
      const previewData = await previewRes.json();
      if (!previewData.error) {
        setPreviewInfo(previewData);
      }
    } catch {}

    // Load or create workspace chat
    await loadWorkspaceChat(ws);
  };

  // Load or create a chat for the given workspace, then load its messages
  const loadWorkspaceChat = async (ws) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    try {
      // Check localStorage for existing workspace→chat mapping
      const wsChats = JSON.parse(localStorage.getItem('aurora_ws_chats') || '{}');
      let chatId = wsChats[ws.id];

      // If we have a chatId, verify it still exists and load messages
      if (chatId) {
        const chatRes = await fetch(`/api/chats/${chatId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (chatRes.ok) {
          const chatData = await chatRes.json();
          setWorkspaceChatId(chatId);
          setWorkspaceMessages(chatData.messages || []);
          return;
        }
        // Chat was deleted — remove stale mapping and create new
        delete wsChats[ws.id];
        localStorage.setItem('aurora_ws_chats', JSON.stringify(wsChats));
      }

      // No localStorage mapping — query server for chats by workspace_id
      const listRes = await fetch(`/api/chats?workspaceId=${encodeURIComponent(ws.id)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        const existingChats = listData.chats || [];
        if (existingChats.length > 0) {
          // Found an existing chat for this workspace — use the newest one
          chatId = existingChats[0].id;
          wsChats[ws.id] = chatId;
          localStorage.setItem('aurora_ws_chats', JSON.stringify(wsChats));
          setWorkspaceChatId(chatId);

          // Load its messages
          const chatRes = await fetch(`/api/chats/${chatId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (chatRes.ok) {
            const chatData = await chatRes.json();
            setWorkspaceMessages(chatData.messages || []);
            return;
          }
        }
      }

      // Create a new chat for this workspace
      const createRes = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Workspace: ${ws.name}`, workspaceId: ws.id })
      });
      if (createRes.ok) {
        const createData = await createRes.json();
        chatId = createData.id;
        wsChats[ws.id] = chatId;
        localStorage.setItem('aurora_ws_chats', JSON.stringify(wsChats));
        setWorkspaceChatId(chatId);
        setWorkspaceMessages([]);
      }
    } catch (err) {
      console.error('Load workspace chat error:', err);
    }
  };

  const handleFileClick = async (node) => {
    if (node.type !== 'file' || !activeWorkspace) return;

    // If already open, just switch to it
    if (openFiles.find(f => f.path === node.path)) {
      setActiveFile(node.path);
      return;
    }

    // Load file content
    setActiveFile(node.path);
    setOpenFiles(prev => [...prev, { path: node.path, name: node.name, language: node.language }]);

    try {
      const res = await fetch(`/api/workspace/${activeWorkspace.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setFileContents(prev => ({ ...prev, [node.path]: data.content }));
      }
    } catch (err) {
      setError('Failed to read file');
    }
  };

  const handleTabClick = (filePath) => {
    setActiveFile(filePath);
  };

  const handleTabClose = (filePath) => {
    setOpenFiles(prev => {
      const filtered = prev.filter(f => f.path !== filePath);
      if (activeFile === filePath && filtered.length > 0) {
        setActiveFile(filtered[filtered.length - 1].path);
      } else if (filtered.length === 0) {
        setActiveFile(null);
      }
      return filtered;
    });
    setFileContents(prev => {
      const next = { ...prev };
      delete next[filePath];
      return next;
    });
  };

  const handleContentChange = useCallback(async (content, filePath) => {
    if (!activeWorkspace || !filePath) return;
    
    setFileContents(prev => ({ ...prev, [filePath]: content }));

    // Auto-save after a short delay
    if (window._saveTimeout) clearTimeout(window._saveTimeout);
    window._saveTimeout = setTimeout(async () => {
      try {
        await fetch(`/api/workspace/${activeWorkspace.id}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, content })
        });
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, 1000);
  }, [activeWorkspace]);

  const handleFileEdit = useCallback(async (filePath, content) => {
    if (!activeWorkspace) return;
    
    setFileContents(prev => ({ ...prev, [filePath]: content }));
    
    // Open in editor if not already open
    if (!openFiles.find(f => f.path === filePath)) {
      const fileName = filePath.split('/').pop();
      const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
      setOpenFiles(prev => [...prev, { path: filePath, name: fileName, language: ext }]);
    }
    setActiveFile(filePath);

    // Refresh the file tree so new files appear immediately
    try {
      const res = await fetch(`/api/workspace/${activeWorkspace.id}/tree`);
      const data = await res.json();
      if (data.tree) setFileTree(data.tree);
    } catch {} // non-critical — tree just won't update until next refresh
  }, [activeWorkspace, openFiles]);

  const handleCloneRepo = async (e) => {
    e.preventDefault();
    if (!cloneUrl.trim() || !cloneName.trim()) return;
    
    setCloneLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cloneName.trim(), repoUrl: cloneUrl.trim(), type: 'git', codeMode: creationMode })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setCreationStep(null);
        setCloneUrl('');
        setCloneName('');
        await loadWorkspaces();
        openWorkspace(data);
      }
    } catch (err) {
      setError('Failed to clone repository');
    } finally {
      setCloneLoading(false);
    }
  };

  const handleCreateBlank = async (e) => {
    e.preventDefault();
    if (!createName.trim()) return;
    
    setCloneLoading(true);
    setError('');
    
    try {
      const res = await fetch('/api/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName.trim(), type: 'blank', codeMode: creationMode })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setCreateName('');
        setCreationStep(null);
        await loadWorkspaces();
        openWorkspace(data);
      }
    } catch (err) {
      setError('Failed to create workspace');
    } finally {
      setCloneLoading(false);
    }
  };

  const handleDeleteWorkspace = async (wsId) => {
    try {
      await fetch(`/api/workspace/${wsId}/delete`, { method: 'DELETE' });
      if (activeWorkspace?.id === wsId) {
        setActiveWorkspace(null);
        setOpenFiles([]);
        setActiveFile(null);
        setFileContents({});
        setFileTree([]);
      }
      await loadWorkspaces();
      onWorkspaceDeleted?.();
    } catch (err) {
      setError('Failed to delete workspace');
    }
  };

  // Map workspace language to an SVG icon
  const getLanguageIcon = (ws, size = 'small') => {
    const lang = (ws.primaryLanguage || '').toLowerCase();
    const badgeCls = size === 'large' ? 'text-[11px] px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5';
    const badges = {
      javascript: <span className={`${badgeCls} rounded font-mono font-semibold text-yellow-400 bg-yellow-400/10`}>JS</span>,
      typescript: <span className={`${badgeCls} rounded font-mono font-semibold text-blue-400 bg-blue-400/10`}>TS</span>,
      python: <span className={`${badgeCls} rounded font-mono font-semibold text-blue-400 bg-blue-400/10`}>PY</span>,
      rust: <span className={`${badgeCls} rounded font-mono font-semibold text-orange-400 bg-orange-400/10`}>RS</span>,
      go: <span className={`${badgeCls} rounded font-mono font-semibold text-cyan-400 bg-cyan-400/10`}>GO</span>,
      ruby: <span className={`${badgeCls} rounded font-mono font-semibold text-red-400 bg-red-400/10`}>RB</span>,
      java: <span className={`${badgeCls} rounded font-mono font-semibold text-red-500 bg-red-500/10`}>JV</span>,
      c: <span className={`${badgeCls} rounded font-mono font-semibold text-purple-400 bg-purple-400/10`}>C</span>,
      'c++': <span className={`${badgeCls} rounded font-mono font-semibold text-blue-600 bg-blue-600/10`}>C+</span>,
      cpp: <span className={`${badgeCls} rounded font-mono font-semibold text-blue-600 bg-blue-600/10`}>C+</span>,
      php: <span className={`${badgeCls} rounded font-mono font-semibold text-indigo-400 bg-indigo-400/10`}>PHP</span>,
      html: <span className={`${badgeCls} rounded font-mono font-semibold text-orange-500 bg-orange-500/10`}>HT</span>,
      docker: <span className={`${badgeCls} rounded font-mono font-semibold text-blue-400 bg-blue-400/10`}>DK</span>,
      dockerfile: <span className={`${badgeCls} rounded font-mono font-semibold text-blue-400 bg-blue-400/10`}>DK</span>,
      css: <span className={`${badgeCls} rounded font-mono font-semibold text-sky-400 bg-sky-400/10`}>CS</span>,
      shell: <span className={`${badgeCls} rounded font-mono font-semibold text-emerald-400 bg-emerald-400/10`}>SH</span>,
      json: <span className={`${badgeCls} rounded font-mono font-semibold text-zinc-400 bg-zinc-400/10`}>{'{ }'}</span>,
      markdown: <span className={`${badgeCls} rounded font-mono font-semibold text-zinc-400 bg-zinc-400/10`}>MD</span>,
      yaml: <span className={`${badgeCls} rounded font-mono font-semibold text-zinc-400 bg-zinc-400/10`}>YM</span>,
    };
    if (badges[lang]) return badges[lang];
    if (ws.isGitRepo) {
      return <svg className={`${size === 'large' ? 'w-5 h-5' : 'w-4 h-4'} text-zinc-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>;
    }
    return <svg className={`${size === 'large' ? 'w-5 h-5' : 'w-4 h-4'} text-zinc-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>;
  };

  const getWorkspaceSubtitle = (ws) => {
    if (ws.repoUrl) return ws.repoUrl;
    if (ws.primaryLanguage) {
      const name = ws.primaryLanguage.charAt(0).toUpperCase() + ws.primaryLanguage.slice(1);
      return `${name} Project`;
    }
    return 'Blank workspace';
  };

  const handleToggleMode = async () => {
    if (!activeWorkspace) return;
    const newMode = codeMode === 'vibe' ? 'full' : 'vibe';
    try {
      await fetch(`/api/workspace/${activeWorkspace.id}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeMode: newMode })
      });
      setCodeMode(newMode);
      // When switching to full mode, reload the file tree and preview info
      if (newMode === 'full') {
        try {
          const treeRes = await fetch(`/api/workspace/${activeWorkspace.id}/tree`);
          const treeData = await treeRes.json();
          if (!treeData.error) setFileTree(treeData.tree || []);
        } catch {}
        try {
          const previewRes = await fetch(`/api/workspace/${activeWorkspace.id}/preview-info`);
          const previewData = await previewRes.json();
          if (!previewData.error) setPreviewInfo(previewData);
        } catch {}
      }
    } catch (err) {
      console.error('Toggle mode error:', err);
    }
  };

  // No workspace selected — show workspace picker
  if (!activeWorkspace) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <div className="max-w-lg w-full mx-4">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Workspace</h2>
            <p className="text-sm text-zinc-500">Create a new workspace or open an existing one</p>
          </div>

          {/* Workspace actions */}
          {creationStep === null && (
            <div className="flex gap-3 mb-8 justify-center">
              <button
                onClick={() => setCreationStep('select')}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
                Create Workspace
              </button>
            </div>
          )}

          {/* Mode Selection Screen */}
          {creationStep === 'select' && (
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-5 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => setCreationStep(null)}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h3 className="text-sm font-semibold text-white">Choose your workflow</h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Vibe Code */}
                <button
                  onClick={() => { setCreationMode('vibe'); setCreationStep('form'); }}
                  className="group relative bg-zinc-800/60 border border-zinc-700/40 hover:border-purple-500/40 rounded-xl p-4 text-left transition-all hover:bg-zinc-800"
                >
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center mb-3 group-hover:bg-purple-500/20 transition-colors">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">Vibe Code</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">Chat with AI to build your app. See results instantly without writing code.</p>
                </button>

                {/* Full Workspace */}
                <button
                  onClick={() => { setCreationMode('full'); setCreationStep('form'); }}
                  className="group relative bg-zinc-800/60 border border-zinc-700/40 hover:border-indigo-500/40 rounded-xl p-4 text-left transition-all hover:bg-zinc-800"
                >
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-3 group-hover:bg-indigo-500/20 transition-colors">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">Full Workspace</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">File tree, code editor, terminal, and AI chat. Full control over your project.</p>
                </button>
              </div>
            </div>
          )}

          {/* Clone/Create Form */}
          {creationStep === 'form' && (
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-5 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => setCreationStep('select')}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h3 className="text-sm font-semibold text-white">
                  {creationMode === 'vibe' ? 'Create Vibe Code Workspace' : 'Create Full Workspace'}
                </h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-zinc-400 bg-zinc-800">
                  {creationMode === 'vibe' ? 'Vibe Code' : 'Full Workspace'}
                </span>
              </div>
              <form onSubmit={handleCloneRepo} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">Repository URL</label>
                  <input
                    type="text"
                    value={cloneUrl}
                    onChange={(e) => {
                      setCloneUrl(e.target.value);
                      if (!cloneName) {
                        const parts = e.target.value.replace(/\.git$/, '').split('/');
                        const last = parts[parts.length - 1];
                        if (last && last !== '') setCloneName(last);
                      }
                    }}
                    placeholder="https://github.com/user/repo.git"
                    className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">Workspace Name</label>
                  <input
                    type="text"
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    placeholder="my-project"
                    className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={cloneLoading || !cloneUrl.trim() || !cloneName.trim()}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {cloneLoading ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : null}
                    Clone
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreationStep(null)}
                    className="px-4 py-2.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>

              <div className="mt-4 pt-4 border-t border-zinc-800/40">
                <p className="text-[11px] text-zinc-500 mb-3">Or create a blank workspace</p>
                <form onSubmit={handleCreateBlank} className="flex gap-2">
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Workspace name..."
                    className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!createName.trim()}
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded-xl text-sm transition-colors"
                  >
                    Create
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Existing workspaces */}
          {workspaces.length > 0 && (() => {
            const totalPages = Math.ceil(workspaces.length / rowsPerPage);
            return (
            <div>
              {/* Header row: label + view toggle + rows-per-page */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Recent Workspaces</p>
                <div className="flex items-center gap-2">
                  {/* Rows per page selector */}
                  <select
                    value={rowsPerPage}
                    onChange={(e) => { setRowsPerPage(Number(e.target.value)); setWorkspacePage(1); }}
                    className="bg-zinc-800 border border-zinc-700/50 rounded-lg px-2 py-1 text-[10px] text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 cursor-pointer"
                  >
                    {[4, 8, 12, 16].map(n => (
                      <option key={n} value={n}>{n} / page</option>
                    ))}
                  </select>
                  {/* List / Grid toggle */}
                  <div className="flex bg-zinc-800 border border-zinc-700/50 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                      title="List view"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                      title="Grid view"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-1'}>
                {workspaces.slice((workspacePage - 1) * rowsPerPage, workspacePage * rowsPerPage).map((ws) => (
                  viewMode === 'grid' ? (
                    <div
                      key={ws.id}
                      onClick={() => openWorkspace(ws)}
                      className="relative flex flex-col items-center gap-2 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/40 hover:border-zinc-700/40 transition-colors group text-center cursor-pointer"
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws.id); }}
                        className="absolute top-1.5 right-1.5 p-1 rounded-lg text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/20 transition-all"
                        title="Delete workspace"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center flex-shrink-0">
                        {getLanguageIcon(ws, 'large')}
                      </div>
                      <div className="min-w-0 w-full">
                        <p className="text-xs text-zinc-200 font-medium truncate">{ws.name}</p>
                        <div className="flex items-center justify-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-zinc-500 truncate">{getWorkspaceSubtitle(ws)}</p>
                          {(ws.codeMode === 'vibe') && (
                            <span className="text-[9px] px-1 py-0.5 rounded font-medium text-purple-400 bg-purple-500/10 flex items-center gap-0.5 flex-shrink-0">
                              <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                              </svg>
                              Vibe
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={ws.id}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800/40 hover:border-zinc-700/40 transition-colors group"
                    >
                      <button
                        onClick={() => openWorkspace(ws)}
                        className="flex-1 flex items-center gap-3 text-left min-w-0"
                      >
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                          {getLanguageIcon(ws)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-zinc-200 font-medium truncate">{ws.name}</p>
                          <div className="flex items-center gap-2">
                            <p className="text-[11px] text-zinc-500 truncate">{getWorkspaceSubtitle(ws)}</p>
                            {(ws.codeMode === 'vibe') && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-purple-400 bg-purple-500/10 flex items-center gap-1 flex-shrink-0">
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                </svg>
                                Vibe
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => handleDeleteWorkspace(ws.id)}
                        className="p-1.5 rounded-lg text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/20 transition-all"
                        title="Delete workspace"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 pt-2">
                  {/* Prev arrow */}
                  <button
                    onClick={() => setWorkspacePage(p => Math.max(1, p - 1))}
                    disabled={workspacePage === 1}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Previous page"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {/* Numbered page buttons */}
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setWorkspacePage(i + 1)}
                      className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${
                        workspacePage === i + 1
                          ? 'bg-indigo-600 text-white'
                          : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  {/* Next arrow */}
                  <button
                    onClick={() => setWorkspacePage(p => Math.min(totalPages, p + 1))}
                    disabled={workspacePage === totalPages}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Next page"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )})()}
        </div>
      </div>
    );
  }

  // IDE layout — Vibe Code or Full Workspace
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {codeMode === 'vibe' ? (
        /* ===== VIBE CODE LAYOUT ===== */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Workspace header */}
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800/40 flex-shrink-0">
            <button
              onClick={() => setActiveWorkspace(null)}
              className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium truncate">{activeWorkspace.name}</span>
            </button>
            <div className="flex items-center gap-0.5">
              {/* Preview toggle — always visible in vibe mode */}
              <button
                onClick={async () => {
                  if (showPreview) {
                    setShowPreview(false);
                    return;
                  }
                  // Detect/re-detect preview info, then show if valid
                  try {
                    const previewRes = await fetch(`/api/workspace/${activeWorkspace.id}/preview-info`);
                    const previewData = await previewRes.json();
                    if (!previewData.error) {
                      setPreviewInfo(previewData);
                      if (previewData.type && previewData.type !== 'none') {
                        setShowPreview(true);
                      }
                    }
                  } catch {}
                }}
                className={`p-1 rounded transition-colors ${showPreview ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                title={showPreview ? 'Hide preview' : 'Preview app'}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
              <button
                onClick={() => loadWorkspaces().then(() => openWorkspace(activeWorkspace))}
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Refresh"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Preview + Agent */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Preview panel */}
            {showPreview && previewInfo && previewInfo.type !== 'none' && (
              <div className="flex-shrink-0" style={{ height: '55%' }}>
                <PreviewPanel
                  workspaceId={activeWorkspace.id}
                  previewInfo={previewInfo}
                  onClose={() => setShowPreview(false)}
                  onStartServer={(cmd) => {
                    setTerminalCommand(cmd);
                    setShowTerminal(true);
                  }}
                />
              </div>
            )}
            {/* Agent panel — full width */}
            <div className={`flex-1 min-h-0 ${!showPreview ? 'border-t border-zinc-800/40' : ''}`}>
              <AgentPanel
                workspaceId={activeWorkspace.id}
                workspaceChatId={workspaceChatId}
                initialMessages={workspaceMessages}
                activeFilePath={null}
                onFileEdit={handleFileEdit}
                onReadFile={async (path) => {
                  if (!activeWorkspace) return null;
                  const res = await fetch(`/api/workspace/${activeWorkspace.id}/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                  });
                  return res.json();
                }}
                currentFileContent={null}
                onOpenPreview={async () => {
                  // Refresh preview info, then ALWAYS open panel
                  try {
                    const previewRes = await fetch(`/api/workspace/${activeWorkspace.id}/preview-info`);
                    const previewData = await previewRes.json();
                    if (!previewData.error) {
                      setPreviewInfo(previewData);
                    }
                  } catch {}
                  setShowPreview(true);
                }}
                onToggleMode={handleToggleMode}
                codeMode={codeMode}
                previewInfo={previewInfo}
              />
            </div>
          </div>
        </div>
      ) : (
        /* ===== FULL WORKSPACE LAYOUT ===== */
        <div className="flex-1 flex min-h-0">
          {/* File Tree — border-r + border-t on inner edge */}
          <div className="flex-shrink-0 relative border-r border-t border-zinc-800/40" style={{ width: leftWidth }}>
            {/* Workspace header */}
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800/40">
              <button
                onClick={() => setActiveWorkspace(null)}
                className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="font-medium truncate">{activeWorkspace.name}</span>
              </button>
              <div className="flex items-center gap-0.5">
                {/* Preview toggle — always visible, auto-detects on click */}
              <button
                onClick={async () => {
                  if (showPreview) {
                    setShowPreview(false);
                    return;
                  }
                  // Always refresh preview info, then open panel
                  try {
                    const previewRes = await fetch(`/api/workspace/${activeWorkspace.id}/preview-info`);
                    const previewData = await previewRes.json();
                    if (!previewData.error) {
                      setPreviewInfo(previewData);
                    }
                  } catch {}
                  // ALWAYS open the preview panel — detection is informational
                  setShowPreview(true);
                }}
                className={`p-1 rounded transition-colors ${showPreview ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                title={showPreview ? 'Show code editor' : `Preview ${previewInfo?.framework || 'app'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
                {/* Terminal toggle */}
                <button
                  onClick={() => setShowTerminal(!showTerminal)}
                  className={`p-1 rounded transition-colors ${showTerminal ? 'text-green-400 bg-green-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                  title={showTerminal ? 'Hide terminal' : 'Show terminal'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <button
                  onClick={() => loadWorkspaces().then(() => openWorkspace(activeWorkspace))}
                  className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Refresh"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>
            <FileTree
              tree={fileTree}
              onFileClick={handleFileClick}
              activeFile={activeFile}
              searchQuery={treeSearch}
              onSearchChange={setTreeSearch}
            />
            {/* Left resize sash — absolute overlay, VS Code style */}
            <div
              className="absolute top-0 bottom-0 z-10 cursor-col-resize group"
              style={{ right: 0, width: '6px', transform: 'translateX(50%)' }}
              onMouseDown={(e) => startDrag('left', e, leftWidth)}
            >
              <div className="w-px h-full mx-auto bg-transparent group-hover:bg-indigo-500 group-active:bg-indigo-500 transition-colors" />
            </div>
          </div>

          {/* Editor + Agent */}
          <div className="flex-1 flex min-w-0">
            {/* Editor Panel */}
            <div className="flex-1 flex flex-col min-w-0 border-t border-zinc-800/40">
              {!showPreview && (
                <FileTabs
                  openFiles={openFiles}
                  activeFile={activeFile}
                  onTabClick={handleTabClick}
                  onTabClose={handleTabClose}
                />
              )}
              <div className="flex-1 min-h-0 relative">
                <div className={showPreview && previewInfo ? 'absolute inset-0' : 'hidden'}>
                  <PreviewPanel
                    workspaceId={activeWorkspace.id}
                    previewInfo={previewInfo}
                    onClose={() => setShowPreview(false)}
                    onStartServer={(cmd) => {
                      setTerminalCommand(cmd);
                      setShowTerminal(true);
                    }}
                  />
                </div>
                <div className={!showPreview || !previewInfo ? 'absolute inset-0' : 'hidden'}>
                  <MonacoEditor
                    content={activeFile ? fileContents[activeFile] : null}
                    language={activeFile ? openFiles.find(f => f.path === activeFile)?.language : null}
                    filePath={activeFile}
                    onContentChange={handleContentChange}
                    readOnly={false}
                  />
                </div>
              </div>
              {/* Git status bar */}
              {activeWorkspace?.isGitRepo && (
                <GitStatusBar workspaceId={activeWorkspace.id} />
              )}

              {/* Terminal (inside editor column — only spans middle pane) */}
              {showTerminal && activeWorkspace && (
                <div className="flex-shrink-0 relative" style={{ height: terminalHeight }}>
                  {/* Terminal resize sash — absolute overlay, VS Code style */}
                  <div
                    className="absolute left-0 right-0 z-10 cursor-row-resize group flex items-center"
                    style={{ top: 0, height: '6px', transform: 'translateY(-50%)' }}
                    onMouseDown={(e) => startDrag('terminal', e, terminalHeight)}
                  >
                    <div className="h-px w-full bg-transparent group-hover:bg-indigo-500 group-active:bg-indigo-500 transition-colors" />
                  </div>
                  <TerminalPanel
                    workspaceId={activeWorkspace.id}
                    initialCommand={terminalCommand || undefined}
                    resizeKey={terminalHeight}
                    onClose={() => {
                      setShowTerminal(false);
                      setTerminalCommand('');
                    }}
                  />
                </div>
              )}
            </div>

            {/* Agent Panel — border-l + border-t on inner edge */}
            <div className="flex-shrink-0 relative border-l border-t border-zinc-800/40" style={{ width: rightWidth }}>
              {/* Right resize sash — absolute overlay, invisible until hovered */}
              <div
                className="absolute top-0 bottom-0 z-10 cursor-col-resize group"
                style={{ left: 0, width: '6px', transform: 'translateX(-50%)' }}
                onMouseDown={(e) => startDrag('right', e, rightWidth)}
              >
                <div className="w-px h-full mx-auto bg-transparent group-hover:bg-indigo-500 group-active:bg-indigo-500 transition-colors" />
              </div>
              <AgentPanel
                workspaceId={activeWorkspace.id}
                workspaceChatId={workspaceChatId}
                initialMessages={workspaceMessages}
                activeFilePath={activeFile}
                onFileEdit={handleFileEdit}
                onReadFile={async (path) => {
                  if (!activeWorkspace) return null;
                  const res = await fetch(`/api/workspace/${activeWorkspace.id}/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                  });
                  return res.json();
                }}
                currentFileContent={activeFile ? fileContents[activeFile] : null}
                onOpenPreview={async () => {
                  // Detect/re-detect preview info, then show
                  try {
                    const previewRes = await fetch(`/api/workspace/${activeWorkspace.id}/preview-info`);
                    const previewData = await previewRes.json();
                    if (!previewData.error) {
                      setPreviewInfo(previewData);
                      if (previewData.type && previewData.type !== 'none') {
                        setShowPreview(true);
                      }
                    }
                  } catch {}
                }}
                onToggleMode={handleToggleMode}
                codeMode={codeMode}
                previewInfo={previewInfo}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Git status bar component
function GitStatusBar({ workspaceId }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/git/status`);
        const data = await res.json();
        if (!data.error) setStatus(data);
      } catch {}
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [workspaceId]);

  if (!status || !status.isGitRepo) return null;

  const changedCount = (status.modified?.length || 0) + (status.created?.length || 0) + (status.deleted?.length || 0);

  return (
    <div className="h-7 flex items-center justify-between px-3 bg-zinc-900 border-t border-zinc-800/40 text-[10px] text-zinc-500">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
          </svg>
          {status.branch}
        </span>
        {changedCount > 0 && (
          <span className="text-amber-400">{changedCount} changed</span>
        )}
        {status.ahead > 0 && <span className="text-sky-400">↑{status.ahead}</span>}
        {status.behind > 0 && <span className="text-orange-400">↓{status.behind}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span>UTF-8</span>
        <span>Spaces: 2</span>
      </div>
    </div>
  );
}
