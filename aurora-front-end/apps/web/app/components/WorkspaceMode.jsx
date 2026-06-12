// @aurora/web - WorkspaceMode container: code-server iframe + StatusBar

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import DocumentsWorkspace from './DocumentsWorkspace';

export default function WorkspaceMode({ onWorkspaceDeleted, pendingWorkspace, onWorkspaceOpened }) {
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
  const [creationType, setCreationType] = useState('code'); // 'code' | 'documents'
  const [codeMode, setCodeMode] = useState(() => pendingWorkspace?.codeMode || 'full'); // active workspace's mode
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
  const [leftPanelView, setLeftPanelView] = useState('explorer'); // 'explorer' | 'git'
  const [gitStatus, setGitStatus] = useState(null);

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

  // Open workspace from sidebar navigation
  useEffect(() => {
    if (!pendingWorkspace) return;
    openWorkspace(pendingWorkspace);
    onWorkspaceOpened?.();
  }, [pendingWorkspace]);

  const loadWorkspaces = async () => {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/workspace/list', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      const list = data.workspaces || [];
      setWorkspaces(list);
      setWorkspacePage(1);
      // Cache metadata for URL param handler (sync codeMode reads)
      try {
        const cache = {};
        for (const w of list) {
          cache[w.id] = { id: w.id, name: w.name, codeMode: w.codeMode, type: w.type, primaryLanguage: w.primaryLanguage, isGitRepo: w.isGitRepo };
        }
        localStorage.setItem('aurora_ws_meta_cache', JSON.stringify(cache));
      } catch {}
    } catch (err) {
      console.error('Load workspaces error:', err);
    }
  };

  const openWorkspace = async (ws) => {
    // Skip full load if metadata hasn't arrived yet (cold cache sentinel)
    if (ws.codeMode === '_loading') {
      setActiveWorkspace(ws);
      setCodeMode('_loading');
      return;
    }
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
    setLeftPanelView('explorer');
    setGitStatus(null);

    // Parallelize ALL fetches: file tree + git + preview + chat messages
    // This prevents chat messages from loading sequentially after the file tree
    const token = localStorage.getItem('auth_token');
    const [treeResult, chatResult] = await Promise.allSettled([
      // 1. File tree
      (async () => {
        const res = await fetch(`/api/workspace/${ws.id}/tree`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        return data.tree || [];
      })(),
      // 2. Workspace chat messages (load in parallel with tree)
      loadWorkspaceChatData(ws),
    ]);

    // Process file tree result
    if (treeResult.status === 'fulfilled') {
      setFileTree(treeResult.value);
    } else {
      setError(treeResult.reason?.message || 'Failed to load workspace');
    }

    // Process chat result (loaded in parallel with tree)
    if (chatResult.status === 'fulfilled' && chatResult.value) {
      if (chatResult.value.chatId) setWorkspaceChatId(chatResult.value.chatId);
      setWorkspaceMessages(chatResult.value.messages || []);
    }

    // Fire-and-forget: git status (non-blocking)
    fetch(`/api/workspace/${ws.id}/git/status`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setGitStatus(d); })
      .catch(() => {});

    // Fire-and-forget: preview info (non-blocking)
    fetch(`/api/workspace/${ws.id}/preview-info`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setPreviewInfo(d); })
      .catch(() => {});

    setIsLoading(false);
  };

  // Fetch workspace chat data (returns {chatId, messages}) — used in parallel with tree fetch
  const loadWorkspaceChatData = async (ws) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return { chatId: null, messages: [] };

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
        return { chatId, messages: chatData.messages || [] };
      }
      // Chat was deleted — remove stale mapping
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
        chatId = existingChats[0].id;
        wsChats[ws.id] = chatId;
        localStorage.setItem('aurora_ws_chats', JSON.stringify(wsChats));

        const chatRes = await fetch(`/api/chats/${chatId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (chatRes.ok) {
          const chatData = await chatRes.json();
          return { chatId, messages: chatData.messages || [] };
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
      return { chatId, messages: [] };
    }

    return { chatId: null, messages: [] };
  };

  // Load or create a chat for the given workspace, then update state
  const loadWorkspaceChat = async (ws) => {
    try {
      const { chatId, messages } = await loadWorkspaceChatData(ws);
      if (chatId) setWorkspaceChatId(chatId);
      if (messages) setWorkspaceMessages(messages);
    } catch (err) {
      console.error('Load workspace chat error:', err);
    }
  };

  // Called when a file is clicked in the GitPanel (opens diff vs working tree)
  const handleGitFileClick = async (filePath, staged) => {
    if (!activeWorkspace) return;
    setActiveFile(filePath);
    // Open in editor if not already
    if (!openFiles.find(f => f.path === filePath)) {
      const fileName = filePath.split('/').pop();
      const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
      setOpenFiles(prev => [...prev, { path: filePath, name: fileName, language: ext }]);
    }
    try {
      const token = localStorage.getItem('auth_token');
      const diffRes = await fetch(`/api/workspace/${activeWorkspace.id}/git/diff?path=${encodeURIComponent(filePath)}&staged=${staged ? 'true' : 'false'}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const diffData = await diffRes.json();
      if (!diffData.error) {
        setFileContents(prev => ({ ...prev, [filePath]: diffData.diff || '(no changes)' }));
      } else {
        // Fallback: read the file normally
        const readRes = await fetch(`/api/workspace/${activeWorkspace.id}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ path: filePath })
        });
        const readData = await readRes.json();
        if (!readData.error) {
          setFileContents(prev => ({ ...prev, [filePath]: readData.content }));
        }
      }
    } catch (err) {
      console.error('Git diff read error:', err);
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
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${activeWorkspace.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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

  const handleDeleteFile = async (node) => {
    if (!activeWorkspace) return;
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${activeWorkspace.id}/write`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ path: node.path })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
        return;
      }
      // Close the file tab if it's open
      if (openFiles.find(f => f.path === node.path)) {
        setOpenFiles(prev => {
          const filtered = prev.filter(f => f.path !== node.path);
          if (activeFile === node.path && filtered.length > 0) {
            setActiveFile(filtered[filtered.length - 1].path);
          } else if (filtered.length === 0) {
            setActiveFile(null);
          }
          return filtered;
        });
      }
      // Remove from file contents
      setFileContents(prev => {
        const next = { ...prev };
        delete next[node.path];
        return next;
      });
      // Refresh the file tree
      try {
        const token = localStorage.getItem('auth_token');
        const treeRes = await fetch(`/api/workspace/${activeWorkspace.id}/tree`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const treeData = await treeRes.json();
        if (treeData.tree) setFileTree(treeData.tree);
      } catch {}
    } catch (err) {
      setError('Failed to delete file');
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
        const token = localStorage.getItem('auth_token');
        await fetch(`/api/workspace/${activeWorkspace.id}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${activeWorkspace.id}/tree`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.tree) setFileTree(data.tree);
    } catch {} // non-critical — tree just won't update until next refresh
  }, [activeWorkspace, openFiles]);

  // ── Refresh file tree (called by AgentPanel when agent writes files) ──
  const refreshTree = useCallback(async () => {
    if (!activeWorkspace) {
      console.warn('[refreshTree] Skipped — no activeWorkspace');
      return;
    }
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${activeWorkspace.id}/tree?_t=${Date.now()}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        console.warn(`[refreshTree] API returned ${res.status} — retrying after 500ms delay`);
        // Single retry after delay (filesystem may not have flushed yet)
        await new Promise(r => setTimeout(r, 500));
        const retryRes = await fetch(`/api/workspace/${activeWorkspace.id}/tree?_t=${Date.now()}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!retryRes.ok) {
          console.warn(`[refreshTree] Retry also failed: ${retryRes.status}`);
          return;
        }
        const retryData = await retryRes.json();
        if (retryData.tree) setFileTree(retryData.tree);
        return;
      }
      const data = await res.json();
      if (data.tree) setFileTree(data.tree);
    } catch (err) {
      console.warn('[refreshTree] Failed:', err.message);
    }
  }, [activeWorkspace]);

  const handleCloneRepo = async (e) => {
    e.preventDefault();
    if (!cloneUrl.trim() || !cloneName.trim()) return;
    
    setCloneLoading(true);
    setError('');
    
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: cloneName.trim(), repoUrl: cloneUrl.trim(), type: 'git', codeMode: creationMode, workspaceType: creationType })
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
    
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: createName.trim(), type: 'blank', codeMode: creationMode, workspaceType: creationType })
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

  // ── Create documents workspace + document from hub landing ──
  const handleCreateDocumentsHub = async (docType, docLabel) => {
    if (createName.trim() || cloneLoading) return;
    setCloneLoading(true);
    setError('');

    const token = localStorage.getItem('auth_token');
    try {
      // 1. Create the documents workspace
      const wsRes = await fetch('/api/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: `New ${docLabel}`, type: 'blank', workspaceType: 'documents' })
      });
      const wsData = await wsRes.json();
      if (wsData.error) throw new Error(wsData.error.message);

      // 2. Create the document inside it
      const docRes = await fetch(`/api/workspace/${wsData.id}/documents/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type: docType, name: `New ${docLabel}` })
      });
      const docData = await docRes.json();
      if (docData.error) throw new Error(docData.error.message);

      // 3. Open the workspace (DocumentsWorkspace will auto-open the doc)
      await loadWorkspaces();
      openWorkspace({ ...wsData, _pendingDoc: docData.path });
    } catch (err) {
      setError(err.message);
    } finally {
      setCloneLoading(false);
    }
  };

  const handleDeleteWorkspace = async (wsId) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/workspace/${wsId}/delete`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
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
      const token = localStorage.getItem('auth_token');
      await fetch(`/api/workspace/${activeWorkspace.id}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ codeMode: newMode })
      });
      setCodeMode(newMode);
      // Update localStorage cache so URL loads pick up new mode
      try {
        const cache = JSON.parse(localStorage.getItem('aurora_ws_meta_cache') || '{}');
        if (cache[activeWorkspace.id]) {
          cache[activeWorkspace.id].codeMode = newMode;
          localStorage.setItem('aurora_ws_meta_cache', JSON.stringify(cache));
        }
      } catch {}
      // When switching to full mode, reload the file tree and preview info
      if (newMode === 'full') {
        const token = localStorage.getItem('auth_token');
        try {
          const treeRes = await fetch(`/api/workspace/${activeWorkspace.id}/tree`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const treeData = await treeRes.json();
          if (!treeData.error) setFileTree(treeData.tree || []);
        } catch {}
        try {
          const previewRes = await fetch(`/api/workspace/${activeWorkspace.id}/preview-info`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const previewData = await previewRes.json();
          if (!previewData.error) setPreviewInfo(previewData);
        } catch {}
      }
    } catch (err) {
      console.error('Toggle mode error:', err);
    }
  };

  // No workspace selected — show document hub + code
  if (!activeWorkspace) {
    const docWorkspaces = workspaces.filter(w => w.workspaceType === 'documents');
    const codeWorkspaces = workspaces.filter(w => w.workspaceType !== 'documents');
    const DOC_HUB_TYPES = [
      { type: 'docx', label: 'Document', icon: '📄', desc: 'Word processor' },
      { type: 'xlsx', label: 'Spreadsheet', icon: '📊', desc: 'Sheets & tables' },
      { type: 'pptx', label: 'Presentation', icon: '📽️', desc: 'Slides & decks' },
    ];

    return (
      <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-8">

            {/* ── Header ── */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-zinc-100 mb-1">Documents</h1>
              <p className="text-sm text-zinc-500">
                Create and edit Office documents with AI assistance
              </p>
            </div>

            {/* ── Error banner ── */}
            {error && (
              <div className="mb-4 p-3 bg-red-900/40 border border-red-800/50 rounded-lg text-sm text-red-300 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError('')} className="text-red-400 hover:text-red-200 ml-2">✕</button>
              </div>
            )}

            {/* ── New Document buttons ── */}
            {creationStep === null && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Create New</h2>
                <div className="grid grid-cols-3 gap-3">
                  {DOC_HUB_TYPES.map(({ type, label, icon, desc }) => (
                    <button
                      key={type}
                      onClick={() => handleCreateDocumentsHub(type, label)}
                      disabled={cloneLoading}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border border-zinc-800/60 bg-zinc-900/60 hover:bg-zinc-800/60 hover:border-zinc-700/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                    >
                      <span className="text-3xl">{icon}</span>
                      <div className="text-center">
                        <div className="text-sm font-medium text-zinc-200">{label}</div>
                        <div className="text-[11px] text-zinc-500">{desc}</div>
                      </div>
                      {cloneLoading && (
                        <span className="text-[11px] text-blue-400 animate-pulse mt-1">Creating…</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Recent Document Workspaces ── */}
            {creationStep === null && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Recent Documents {docWorkspaces.length > 0 && `(${docWorkspaces.length})`}
                </h2>
                {docWorkspaces.length === 0 ? (
                  <div className="text-sm text-zinc-600 py-4">
                    No documents yet. Create one above to get started.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {docWorkspaces.slice(0, 6).map((ws, i) => (
                      <button
                        key={ws.id}
                        onClick={() => openWorkspace(ws)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left group"
                      >
                        <span className="text-lg flex-shrink-0">📄</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-300 group-hover:text-zinc-100 truncate">
                            {ws.name}
                          </div>
                          <div className="text-[11px] text-zinc-600">
                            {ws.updatedAt ? new Date(ws.updatedAt).toLocaleDateString() : ''}
                          </div>
                        </div>
                        {i < docWorkspaces.slice(0, 6).length - 1 && (
                          <span className="text-zinc-700">·</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Divider ── */}
            <div className="border-t border-zinc-800/40 my-8" />

            {/* ── Code header ── */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-zinc-100 mb-1">Code</h1>
              <p className="text-sm text-zinc-500">
                Build and deploy production applications with AI
              </p>
            </div>

            {/* ── Code: Create New ── */}
            {creationStep === null && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Create New</h2>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => { setCreationType('code'); setCreationMode('vibe'); setCreationStep('form'); }}
                    className="group relative bg-zinc-900/60 border border-zinc-800/60 hover:border-purple-500/40 rounded-xl p-4 text-left transition-all hover:bg-zinc-800/60"
                  >
                    <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center mb-3 group-hover:bg-purple-500/20 transition-colors">
                      <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-white mb-1">Vibe Code</h4>
                    <p className="text-[11px] text-zinc-400">Chat with AI to build your app</p>
                  </button>
                  <button
                    onClick={() => { setCreationType('code'); setCreationMode('full'); setCreationStep('form'); }}
                    className="group relative bg-zinc-900/60 border border-zinc-800/60 hover:border-indigo-500/40 rounded-xl p-4 text-left transition-all hover:bg-zinc-800/60"
                  >
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-3 group-hover:bg-indigo-500/20 transition-colors">
                      <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    <h4 className="text-sm font-semibold text-white mb-1">Full Workspace</h4>
                    <p className="text-[11px] text-zinc-400">File tree, editor, terminal + AI</p>
                  </button>
                </div>
              </div>
            )}

            {/* ── Recent Projects ── */}
            {creationStep === null && (
              <div className="mb-8">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  Recent Projects {codeWorkspaces.length > 0 && `(${codeWorkspaces.length})`}
                </h2>
                {codeWorkspaces.length === 0 ? (
                  <div className="text-sm text-zinc-600 py-4">
                    No projects yet. Create one above to get started.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {codeWorkspaces.slice(0, 6).map((ws, i) => (
                      <button
                        key={ws.id}
                        onClick={() => openWorkspace(ws)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left group"
                      >
                        <span className="flex-shrink-0">{getLanguageIcon(ws)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-300 group-hover:text-zinc-100 truncate">
                            {ws.name}
                          </div>
                          <div className="text-[11px] text-zinc-600">
                            {getWorkspaceSubtitle(ws)}{'  ·  '}{ws.updatedAt ? new Date(ws.updatedAt).toLocaleDateString() : ''}
                          </div>
                        </div>
                        {i < codeWorkspaces.slice(0, 6).length - 1 && (
                          <span className="text-zinc-700">·</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Code workspace form ── */}
            {creationStep === 'form' && (
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

          </div>
        </div>

        {/* Bottom status bar */}
        <div className="flex items-center justify-between px-3 py-1 bg-zinc-900 border-t border-zinc-800/40 flex-shrink-0">
          <span className="text-[10px] text-zinc-500">Documents</span>
          <span className="text-[10px] text-zinc-600">Powered by OnlyOffice</span>
        </div>
      </div>
    );
  }

  // Computed for Git badge
  const changedCount = gitStatus?.files?.length || 0;

  // Documents layout
  if (activeWorkspace?.workspaceType === 'documents') {
    return (
      <DocumentsWorkspace
        workspace={activeWorkspace}
        onWorkspaceDeleted={() => {
          setActiveWorkspace(null);
          loadWorkspaces();
        }}
        onBack={() => setActiveWorkspace(null)}
      />
    );
  }

  if (codeMode === '_loading') {
    // Cold cache — waiting for API to return workspace metadata
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <div className="flex items-center gap-3 text-zinc-500">
          <div className="w-5 h-5 border-2 border-zinc-600 border-t-indigo-500 rounded-full animate-spin" />
          <span className="text-sm">Loading workspace…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Code-server iframe — native VS Code with Cline */}
      <div className="flex-1 min-h-0 relative">
        <iframe
          src={`http://localhost:3090/?folder=/workspaces/${activeWorkspace.id}`}
          className="absolute inset-0 w-full h-full border-0"
          title="Code Server"
        />
      </div>
      {/* Bottom status bar — always visible, VS Code style */}
      <StatusBar
        workspaceId={activeWorkspace.id}
        isGitRepo={activeWorkspace?.isGitRepo}
        activeFile={activeFile}
        openFiles={openFiles}
        onRefreshTree={async () => {
          const token = localStorage.getItem('auth_token');
          try {
            const gitRes = await fetch(`/api/workspace/${activeWorkspace.id}/git/status`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const gitData = await gitRes.json();
            if (!gitData.error) setGitStatus(gitData);
          } catch {}
          try {
            const res = await fetch(`/api/workspace/${activeWorkspace.id}/tree`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.tree) setFileTree(data.tree);
          } catch {}
        }}
      />
    </div>
  );
}

// VS Code-style bottom status bar with branch switching
function StatusBar({ workspaceId, isGitRepo, activeFile, openFiles, onRefreshTree }) {
  const [gitStatus, setGitStatus] = useState(null);
  const [branches, setBranches] = useState([]);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const [switchError, setSwitchError] = useState('');

  // Always fetch git status — detect isGitRepo from the response itself
  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/api/workspace/${workspaceId}/git/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!cancelled && !data.error) setGitStatus(data);
      } catch {}
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [workspaceId]);

  // Fetch branches when dropdown opens
  const fetchBranches = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspaceId}/git/branches`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!data.error) setBranches(data.branches || []);
    } catch {}
  };

  const handleSwitchBranch = async (branchName) => {
    setSwitchError('');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspaceId}/git/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', branchName })
      });
      const data = await res.json();
      if (data.error) {
        setSwitchError(data.error.message);
      } else {
        setShowBranchDropdown(false);
        onRefreshTree?.();
      }
    } catch (err) {
      setSwitchError('Failed to switch branch');
    }
  };

  const handleCreateBranch = async (e) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    setSwitchError('');
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', newBranchName: newBranchName.trim() })
      });
      const data = await res.json();
      if (data.error) {
        setSwitchError(data.error.message);
      } else {
        setNewBranchName('');
        setShowNewBranchInput(false);
        setShowBranchDropdown(false);
        onRefreshTree?.();
      }
    } catch (err) {
      setSwitchError('Failed to create branch');
    }
  };

  const currentBranch = gitStatus?.branch || (gitStatus?.isGitRepo ? 'main' : null);
  const currentFile = openFiles?.find(f => f.path === activeFile);
  const langLabel = currentFile?.language || 'plaintext';
  const changedCount = gitStatus?.files?.length || 0;
  const repoDetected = gitStatus?.isGitRepo;

  return (
    <div className="h-7 flex items-center justify-between px-3 bg-zinc-900 border-t border-zinc-800/40 text-[10px] text-zinc-500 select-none flex-shrink-0">
      {/* Left: Branch (like VS Code) */}
      <div className="flex items-center gap-3">
        {repoDetected && currentBranch ? (
          <div className="relative">
            <button
              onClick={() => { setShowBranchDropdown(!showBranchDropdown); if (!showBranchDropdown) fetchBranches(); }}
              className="flex items-center gap-1 hover:text-zinc-300 transition-colors cursor-pointer"
              title="Switch branch"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span>{currentBranch}</span>
              <svg className={`w-2.5 h-2.5 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* Error */}
            {switchError && (
              <div className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-red-950/90 border border-red-900/40 rounded text-[9px] text-red-400 whitespace-nowrap z-30">
                {switchError}
              </div>
            )}
            {/* Branch dropdown — opens upward from bottom-left */}
            {showBranchDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowBranchDropdown(false)} />
                <div className="absolute bottom-full left-0 mb-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto min-w-[180px]">
                  {branches.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => handleSwitchBranch(b.name)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                        b.current
                          ? 'bg-indigo-600/20 text-indigo-300'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      <span className="truncate">{b.name}</span>
                      {b.current && <span className="text-[9px] text-indigo-400 ml-auto">HEAD</span>}
                    </button>
                  ))}
                  <div className="border-t border-zinc-700/40 mt-0.5 pt-0.5">
                    {showNewBranchInput ? (
                      <form onSubmit={handleCreateBranch} className="flex items-center gap-1 px-2 py-1">
                        <input
                          autoFocus
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleCreateBranch(e); }
                            else if (e.key === 'Escape') { setNewBranchName(''); setShowNewBranchInput(false); }
                          }}
                          placeholder="Branch name..."
                          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                          onBlur={() => { if (!newBranchName.trim()) setShowNewBranchInput(false); }}
                        />
                        <button type="submit" className="flex-shrink-0 p-1 rounded text-indigo-400 hover:bg-indigo-600/20 transition-colors" title="Create branch">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      </form>
                    ) : (
                      <button
                        onClick={() => { setShowNewBranchInput(true); setNewBranchName(''); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Create new branch...
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1" title="Not a git repository">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </span>
        )}
        {gitStatus?.ahead > 0 && <span className="text-sky-400">↑{gitStatus.ahead}</span>}
        {gitStatus?.behind > 0 && <span className="text-orange-400">↓{gitStatus.behind}</span>}
        {changedCount > 0 && <span className="text-amber-400">{changedCount} changed</span>}
      </div>

      {/* Right: File info */}
      <div className="flex items-center gap-3">
        {activeFile && (
          <span className="hover:text-zinc-300 cursor-default">{langLabel}</span>
        )}
        <span>UTF-8</span>
        <span>Spaces: 2</span>
      </div>
    </div>
  );
}
