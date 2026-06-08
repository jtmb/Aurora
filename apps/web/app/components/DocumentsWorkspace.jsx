// @aurora/web - DocumentsWorkspace: Document viewer + Chat/Agent/Checkpoints panel

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { transformFortuneToExcel } from '@corbe30/fortune-excel';
import AgentPanel from './AgentPanel';

const MIN_PANEL = 280;
const MAX_PANEL_RATIO = 0.5;

export default function DocumentsWorkspace({
  workspace,
  onWorkspaceDeleted,
  onBack,
  workspaceChatId: initialChatId,
  initialMessages,
}) {
  // ── Panel layout state ──
  const [chatPanelPosition, setChatPanelPosition] = useState('right'); // 'right' | 'bottom'
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(380);
  const [panelHeight, setPanelHeight] = useState(280); // for bottom mode
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'agent' | 'checkpoints'

  // ── Document state ──
  const [workspaceFiles, setWorkspaceFiles] = useState([]); // [{ path, name, type }]
  const [activeDocument, setActiveDocument] = useState(null); // { path, name, type }
  const [documentContent, setDocumentContent] = useState(null); // { type, html?, sheets? }
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [spreadsheetSaving, setSpreadsheetSaving] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingWorkspace, setClearingWorkspace] = useState(false);
  const [workbookVersion, setWorkbookVersion] = useState(0); // bump to remount Workbook on panel resize

  // ── Checkpoint state ──
  const [checkpoints, setCheckpoints] = useState([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [restoringCheckpoint, setRestoringCheckpoint] = useState(null);

  // ── Chat state ──
  const [workspaceChatId, setWorkspaceChatId] = useState(initialChatId || null);
  const [workspaceMessages, setWorkspaceMessages] = useState(initialMessages || null);

  // ── Refs ──
  const panelDragRef = useRef(null);
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const workbookRef = useRef(null);

  // ── Clear workspace handler ──
  const handleClearWorkspace = async () => {
    if (!workspace) return;
    setClearingWorkspace(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspace.id}/clear`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.error) {
        console.error('[DocumentsWorkspace] Clear failed:', data.error.message);
      } else {
        // Reset all document state
        setWorkspaceFiles([]);
        setActiveDocument(null);
        setDocumentContent(null);
      }
    } catch (err) {
      console.error('[DocumentsWorkspace] Clear error:', err.message);
    } finally {
      setClearingWorkspace(false);
      setShowClearConfirm(false);
    }
  };

  // ── Load workspace files on mount ──
  useEffect(() => {
    if (!workspace) return;
    loadWorkspaceFiles();
    loadWorkspaceChatData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // Load checkpoints when switching to checkpoints tab
  useEffect(() => {
    if (activeTab === 'checkpoints' && workspace) {
      loadCheckpoints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, workspace]);

  const loadWorkspaceFiles = async () => {
    if (!workspace) return;
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspace.id}/tree`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      const tree = data.tree || [];

      // Flatten tree to find .docx and .xlsx files
      const docFiles = [];
      const walk = (nodes, prefix = '') => {
        for (const node of nodes) {
          const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
          if (node.type === 'file') {
            const ext = node.name.split('.').pop()?.toLowerCase();
            if (ext === 'docx' || ext === 'xlsx') {
              docFiles.push({ path: fullPath, name: node.name, type: ext });
            }
          } else if (node.type === 'directory' && node.children) {
            walk(node.children, fullPath);
          }
        }
      };
      walk(tree);

      setWorkspaceFiles(docFiles);

      // Auto-select first document if none active
      if (!activeDocument && docFiles.length > 0) {
        await loadDocument(docFiles[0]);
      }
    } catch (err) {
      console.error('[DocumentsWorkspace] Failed to load files:', err);
    }
  };

  const loadDocument = async (file) => {
    if (!workspace) return;
    setDocumentLoading(true);
    setDocumentError('');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspace.id}/document/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ filePath: file.path })
      });
      const data = await res.json();
      if (data.error) {
        setDocumentError(data.error.message);
      } else {
        setDocumentContent(data);
        setActiveDocument(file);
      }
    } catch (err) {
      setDocumentError(`Failed to read document: ${err.message}`);
    } finally {
      setDocumentLoading(false);
    }
  };

  const loadCheckpoints = async () => {
    if (!workspace) return;
    setCheckpointsLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspace.id}/checkpoint/list`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (!data.error) {
        setCheckpoints(data.checkpoints || []);
      }
    } catch (err) {
      console.error('[DocumentsWorkspace] Failed to load checkpoints:', err);
    } finally {
      setCheckpointsLoading(false);
    }
  };

  const handleRestoreCheckpoint = async (tag) => {
    if (!workspace) return;
    setRestoringCheckpoint(tag);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspace.id}/checkpoint/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tag })
      });
      const data = await res.json();
      if (data.error) {
        console.error('Restore failed:', data.error.message);
      } else {
        // Refresh document and checkpoints list
        if (activeDocument) {
          await loadDocument(activeDocument);
        }
        await loadCheckpoints();
      }
    } catch (err) {
      console.error('Restore error:', err);
    } finally {
      setRestoringCheckpoint(null);
    }
  };

  const loadWorkspaceChatData = async () => {
    if (!workspace || initialChatId) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    try {
      const wsChats = JSON.parse(localStorage.getItem('aurora_ws_chats') || '{}');
      let chatId = wsChats[workspace.id];

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
        delete wsChats[workspace.id];
        localStorage.setItem('aurora_ws_chats', JSON.stringify(wsChats));
      }

      const listRes = await fetch(`/api/chats?workspaceId=${encodeURIComponent(workspace.id)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.chats?.length > 0) {
          chatId = listData.chats[0].id;
          wsChats[workspace.id] = chatId;
          localStorage.setItem('aurora_ws_chats', JSON.stringify(wsChats));
          setWorkspaceChatId(chatId);
        }
      }
    } catch (err) {
      console.error('[DocumentsWorkspace] Chat load error:', err);
    }
  };

  // ── Panel drag handlers ──
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!panelDragRef.current) return;
      const { position, startX, startY, startSize } = panelDragRef.current;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      if (position === 'right') {
        const delta = startX - e.clientX;
        const maxWidth = containerRect.width * MAX_PANEL_RATIO;
        setPanelWidth(Math.max(MIN_PANEL, Math.min(maxWidth, startSize + delta)));
      } else if (position === 'bottom') {
        const delta = startY - e.clientY;
        const maxHeight = containerRect.height * MAX_PANEL_RATIO;
        setPanelHeight(Math.max(120, Math.min(maxHeight, startSize + delta)));
      }
    };

    const onMouseUp = () => {
      const wasDragging = !!panelDragRef.current;
      panelDragRef.current = null;
      // FortuneSheet renders to a <canvas> at initial size and doesn't
      // auto-redraw when the container resizes. Bumping the key forces
      // React to remount the Workbook at the new dimensions.
      if (wasDragging) {
        setWorkbookVersion(v => v + 1);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startPanelDrag = (position, e, currentSize) => {
    e.preventDefault();
    panelDragRef.current = { position, startX: e.clientX, startY: e.clientY, startSize: currentSize };
  };

  const togglePanelPosition = () => {
    setChatPanelPosition(prev => prev === 'right' ? 'bottom' : 'right');
    setChatPanelCollapsed(false);
  };

  const togglePanelCollapse = () => {
    setChatPanelCollapsed(prev => !prev);
  };

  // ── Tab buttons ──
  const tabs = [
    { id: 'chat', label: 'Chat', icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    )},
    { id: 'agent', label: 'Agent', icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    )},
    { id: 'checkpoints', label: 'Checkpoints', icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )}
  ];

  // ── Auto-refresh on agent file changes ──
  const handleAgentFileChange = useCallback(async () => {
    if (!activeDocument || !workspace) return;
    await loadDocument(activeDocument);
    await loadWorkspaceFiles(); // refresh file list in case of new files
    if (activeTab === 'checkpoints') {
      await loadCheckpoints();
    }
  }, [activeDocument, workspace, activeTab]);

  // ── File upload handler ──
  const handleFileUpload = async (file) => {
    if (!workspace || !file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'docx' && ext !== 'xlsx') {
      setDocumentError('Only .docx and .xlsx files are supported.');
      return;
    }
    setUploading(true);
    setDocumentError('');
    try {
      const token = localStorage.getItem('auth_token');
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/workspace/${workspace.id}/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Upload failed');
      }
      const data = await res.json();
      // Refresh file list and auto-open the uploaded file
      await loadWorkspaceFiles();
      if (data.file) {
        await loadDocument(data.file);
      }
    } catch (err) {
      setDocumentError(err.message || 'Failed to upload file.');
    } finally {
      setUploading(false);
      setDragOver(false);
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileUpload(file);
  }, [workspace]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  // ── Spreadsheet save handler ──
  const handleSaveSpreadsheet = useCallback(async () => {
    if (!workspace || !activeDocument || !workbookRef.current) return;
    setSpreadsheetSaving(true);
    try {
      // Export fortune-sheet data to .xlsx blob
      const blob = await transformFortuneToExcel(workbookRef.current, 'xlsx', false);

      const token = localStorage.getItem('auth_token');
      const formData = new FormData();
      formData.append('file', blob, activeDocument.path);
      formData.append('filePath', activeDocument.path);

      const res = await fetch(`/api/workspace/${workspace.id}/document/write`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Save failed');
      }

      // Reload to pick up checkpoint
      if (activeTab === 'checkpoints') {
        await loadCheckpoints();
      }
    } catch (err) {
      console.error('[DocumentsWorkspace] Save error:', err);
      setDocumentError(`Save failed: ${err.message}`);
    } finally {
      setSpreadsheetSaving(false);
    }
  }, [workspace, activeDocument, activeTab]);

  // ── Keyboard shortcut: Ctrl+S / Cmd+S ──
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        // Only intercept when spreadsheet is active
        if (activeDocument?.type === 'xlsx') {
          e.preventDefault();
          handleSaveSpreadsheet();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleSaveSpreadsheet, activeDocument]);

  // ── Render ──
  const isRightPanel = chatPanelPosition === 'right';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-zinc-950" ref={containerRef}>
      {/* ── Header Bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800/40 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Back button */}
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="font-medium truncate max-w-[140px]">{workspace?.name || 'Documents'}</span>
          </button>

          {/* Document selector dropdown */}
          {workspaceFiles.length > 0 && (
            <div className="relative">
              <select
                value={activeDocument?.path || ''}
                onChange={(e) => {
                  const selected = workspaceFiles.find(f => f.path === e.target.value);
                  if (selected) loadDocument(selected);
                }}
                className="appearance-none bg-zinc-800 border border-zinc-700/50 rounded-lg pl-3 pr-8 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all cursor-pointer"
              >
                {workspaceFiles.map(f => (
                  <option key={f.path} value={f.path}>
                    {f.name}
                  </option>
                ))}
              </select>
              <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Panel position toggle */}
          <button
            onClick={togglePanelPosition}
            className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title={isRightPanel ? 'Move panel to bottom' : 'Move panel to right'}
          >
            {isRightPanel ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            )}
          </button>

          {/* Panel collapse toggle */}
          <button
            onClick={togglePanelCollapse}
            className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title={chatPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {chatPanelCollapsed ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            )}
          </button>

          {/* Save button (xlsx only) */}
          {activeDocument?.type === 'xlsx' && (
            <button
              onClick={handleSaveSpreadsheet}
              disabled={spreadsheetSaving}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
              title="Save spreadsheet (Ctrl+S)"
            >
              {spreadsheetSaving ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save
                </>
              )}
            </button>
          )}
          {/* Clear workspace button */}
          {workspaceFiles.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Clear all files from workspace"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Main Content Area ── */}
      <div className={`flex-1 min-h-0 flex ${isRightPanel ? 'flex-row' : 'flex-col'}`}>
        {/* ── Document Viewer ── */}
        <div
          className={`${isRightPanel ? 'flex-1' : 'flex-1'} flex flex-col min-h-0 min-w-0 relative`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Drag overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-50 bg-indigo-500/10 border-2 border-dashed border-indigo-400 rounded-xl m-2 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <svg className="w-10 h-10 text-indigo-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-indigo-300 font-medium">Drop file to upload</p>
                <p className="text-xs text-indigo-400/60 mt-0.5">.docx or .xlsx</p>
              </div>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 z-50 bg-zinc-950/60 flex items-center justify-center">
              <div className="flex items-center gap-3 text-zinc-400">
                <div className="w-5 h-5 border-2 border-zinc-600 border-t-indigo-500 rounded-full animate-spin" />
                <span className="text-sm">Uploading…</span>
              </div>
            </div>
          )}
          {(() => {
            if (documentLoading) {
              return (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-3 text-zinc-500">
                    <div className="w-5 h-5 border-2 border-zinc-600 border-t-indigo-500 rounded-full animate-spin" />
                    <span className="text-sm">Loading document…</span>
                  </div>
                </div>
              );
            }
            if (documentError) {
              return (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <svg className="w-10 h-10 text-red-400/60 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <p className="text-sm text-red-400 mb-2">{documentError}</p>
                    <button
                      onClick={() => activeDocument && loadDocument(activeDocument)}
                      className="text-xs text-zinc-400 hover:text-zinc-200 underline transition-colors"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              );
            }
            if (!activeDocument) {
              return (
                <div
                  className="flex items-center justify-center h-full cursor-pointer group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-center max-w-sm p-8 rounded-2xl border-2 border-dashed border-zinc-700/50 group-hover:border-indigo-500/40 group-hover:bg-indigo-500/[0.03] transition-all">
                    <svg className="w-12 h-12 text-zinc-600 mx-auto mb-4 group-hover:text-indigo-400/60 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-zinc-500 mb-1 group-hover:text-zinc-300 transition-colors">
                      {workspaceFiles.length === 0
                        ? 'Drop a .docx or .xlsx file here'
                        : 'Select a document from the dropdown above.'}
                    </p>
                    <p className="text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">
                      {workspaceFiles.length === 0
                        ? 'or click to browse files on your system'
                        : 'or drop a new file here to add it'}
                    </p>
                  </div>
                </div>
              );
            }
            if (documentContent?.type === 'docx') {
              return (
                <div className="flex-1 min-h-0 overflow-auto">
                  <div className="max-w-[210mm] mx-auto my-6 bg-white text-zinc-900 shadow-2xl rounded-sm">
                    <div
                      className="p-12 [&_p]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4 [&_td]:border [&_td]:border-zinc-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-zinc-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-zinc-100 [&_th]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_strong]:font-semibold [&_em]:italic"
                      style={{ fontFamily: 'Calibri, sans-serif', fontSize: '11pt', lineHeight: '1.5', minHeight: '297mm' }}
                      dangerouslySetInnerHTML={{ __html: documentContent.html }}
                    />
                  </div>
                </div>
              );
            }
            if (documentContent?.type === 'xlsx') {
              // absolute inset-0 gives this wrapper explicit computed dimensions
              // from the relative-positioned document viewer parent. This is necessary
              // because FortuneSheet's .fortune-container uses "height: 100%" which
              // only resolves from explicit computed heights — flex-1 gives a used
              // height but keeps computed as "auto", making 100% collapse to 0.
              return (
                <div className="absolute inset-0 overflow-hidden">
                  {documentContent.fortuneData ? (
                    <Workbook
                      key={workbookVersion}
                      ref={workbookRef}
                      data={documentContent.fortuneData}
                      showSheetTabs={true}
                      showToolbar={true}
                      showFormulaBar={true}
                      defaultColumnWidth={100}
                      defaultRowHeight={22}
                      rowHeaderWidth={46}
                      columnHeaderHeight={20}
                    />
                  ) : (
                    <div className="overflow-auto max-h-[calc(100vh-220px)] p-4">
                      <div className="inline-block min-w-full bg-zinc-900 border border-zinc-700/50 rounded-xl overflow-hidden">
                        {documentContent.sheets?.slice(0, 1).map((sheet, sIdx) => (
                          <table key={sIdx} className="border-collapse text-xs">
                            <tbody>
                              {sheet.rows?.map((row, rIdx) => (
                                <tr key={rIdx} className={rIdx === 0 ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}>
                                  {row.map((cell, cIdx) => (
                                    <td
                                      key={cIdx}
                                      className={`border border-zinc-700/40 px-3 py-1.5 whitespace-nowrap ${rIdx === 0 ? 'text-zinc-200 font-semibold' : 'text-zinc-300'}`}
                                    >
                                      {cell !== null && cell !== undefined ? String(cell) : ''}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })()}
          {/* Hidden file input for click-to-browse */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = ''; // reset so same file can be re-selected
            }}
          />
        </div>

        {/* ── Resize Handle ── */}
        {!chatPanelCollapsed && (
          <div
            className={`flex-shrink-0 ${isRightPanel ? 'w-1.5 cursor-col-resize hover:bg-indigo-500/30' : 'h-1.5 cursor-row-resize hover:bg-indigo-500/30'} bg-transparent transition-colors`}
            onMouseDown={(e) => startPanelDrag(chatPanelPosition, e, isRightPanel ? panelWidth : panelHeight)}
          />
        )}

        {/* ── Chat / Agent / Checkpoints Panel ── */}
        {!chatPanelCollapsed ? (
          <div
            className={`flex-shrink-0 flex flex-col min-h-0 bg-zinc-900 border-zinc-800/40 ${isRightPanel ? 'border-l' : 'border-t'}`}
            style={isRightPanel ? { width: panelWidth } : { height: panelHeight }}
          >
            {/* Tab bar */}
            <div className="flex items-center border-b border-zinc-800/40 px-2 flex-shrink-0">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-[1px] ${
                    activeTab === tab.id
                      ? 'text-indigo-400 border-indigo-500'
                      : 'text-zinc-500 border-transparent hover:text-zinc-300'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-auto">
              {/* Chat + Agent tabs */}
              {(activeTab === 'chat' || activeTab === 'agent') && (
                <AgentPanel
                  workspaceId={workspace?.id}
                  workspaceChatId={workspaceChatId}
                  initialMessages={workspaceMessages}
                  activeFilePath={activeDocument?.path || null}
                  onFileEdit={async (filePath, content) => {
                    // Save document content after agent writes
                    await handleAgentFileChange();
                  }}
                  onFileTreeChange={handleAgentFileChange}
                  onReadFile={async (path) => {
                    if (!workspace) return null;
                    const token = localStorage.getItem('auth_token');
                    const res = await fetch(`/api/workspace/${workspace.id}/read`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                      body: JSON.stringify({ path })
                    });
                    return res.json();
                  }}
                  currentFileContent={activeDocument ? (documentContent?.text || JSON.stringify(documentContent?.sheets?.[0]?.rows || [])) : null}
                  onOpenPreview={null}
                  codeMode="documents"
                  showPlanTab={false}
                  hideBottomControls={true}
                />
              )}

              {/* Checkpoints tab */}
              {activeTab === 'checkpoints' && (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-zinc-300">Document Checkpoints</h3>
                    <button
                      onClick={loadCheckpoints}
                      disabled={checkpointsLoading}
                      className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                      title="Refresh"
                    >
                      <svg className={`w-3.5 h-3.5 ${checkpointsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>

                  {checkpointsLoading ? (
                    <div className="flex items-center justify-center py-8 text-zinc-500 text-xs">
                      <div className="w-4 h-4 border-2 border-zinc-600 border-t-indigo-500 rounded-full animate-spin mr-2" />
                      Loading…
                    </div>
                  ) : checkpoints.length === 0 ? (
                    <div className="text-center py-8">
                      <svg className="w-8 h-8 text-zinc-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-zinc-500">No checkpoints yet</p>
                      <p className="text-[11px] text-zinc-600 mt-1">Checkpoints are created automatically when changes are made to documents.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {checkpoints.map(cp => (
                        <div
                          key={cp.tag}
                          className="flex items-center justify-between bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 group hover:border-zinc-600/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-zinc-300 truncate">{cp.tag}</span>
                              {cp.hash && cp.hash !== 'unknown' && (
                                <span className="text-[10px] font-mono text-zinc-600">{cp.hash}</span>
                              )}
                            </div>
                            {cp.date && (
                              <p className="text-[10px] text-zinc-500 mt-0.5">
                                {new Date(cp.date).toLocaleString()}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => handleRestoreCheckpoint(cp.tag)}
                            disabled={restoringCheckpoint === cp.tag}
                            className="opacity-0 group-hover:opacity-100 text-[11px] px-2 py-1 rounded bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 disabled:opacity-50 transition-all flex-shrink-0"
                          >
                            {restoringCheckpoint === cp.tag ? 'Restoring…' : 'Restore'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-[10px] text-zinc-600 mt-3 text-center">
                    Restoring a checkpoint reverts the entire workspace to that point in time. This action cannot be undone.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Collapsed panel tab — thin strip to expand */
          <div
            className={`flex-shrink-0 bg-zinc-900 border-zinc-800/40 flex items-center justify-center cursor-pointer hover:bg-zinc-800 transition-colors ${isRightPanel ? 'border-l w-6' : 'border-t h-6'}`}
            onClick={togglePanelCollapse}
            title="Expand panel"
          >
            <svg className={`w-3 h-3 text-zinc-500 ${isRightPanel ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isRightPanel ? 'M9 5l7 7-7 7' : 'M5 15l7-7 7 7'} />
            </svg>
          </div>
        )}
      </div>

      {/* ── Clear Workspace Confirmation Modal ── */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setShowClearConfirm(false)}>
          <div
            className="bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Clear Workspace</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  This will permanently delete all {workspaceFiles.length} file{workspaceFiles.length !== 1 ? 's' : ''} in this workspace.
                </p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-5">This action cannot be undone. The workspace structure and settings will be preserved.</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={clearingWorkspace}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearWorkspace}
                disabled={clearingWorkspace}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white transition-colors"
              >
                {clearingWorkspace ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Clearing…
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete All
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Status Bar ── */}
      <div className="flex items-center justify-between px-3 py-1 bg-zinc-900 border-t border-zinc-800/40 flex-shrink-0">
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          {activeDocument ? (
            <>
              <span>{activeDocument.name}</span>
              <span className="text-zinc-700">|</span>
              <span className="uppercase">{activeDocument.type}</span>
            </>
          ) : (
            <span>No document</span>
          )}
        </div>
        <div className="text-[10px] text-zinc-600">
          {documentContent?.type === 'docx' ? 'Read-only preview — agent edits via terminal' : ''}
        </div>
      </div>
    </div>
  );
}
