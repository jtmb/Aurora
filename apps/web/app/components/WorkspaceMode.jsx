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

export default function WorkspaceMode({}) {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContents, setFileContents] = useState({}); // { path: content }
  const [treeSearch, setTreeSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCloner, setShowCloner] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [createName, setCreateName] = useState('');
  const [previewInfo, setPreviewInfo] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState('');

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
        body: JSON.stringify({ name: cloneName.trim(), repoUrl: cloneUrl.trim(), type: 'git' })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setShowCloner(false);
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
        body: JSON.stringify({ name: createName.trim(), type: 'blank' })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setCreateName('');
        setShowCloner(false);
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
    } catch (err) {
      setError('Failed to delete workspace');
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
            <p className="text-sm text-zinc-500">Clone a repository or create a blank workspace to get started</p>
          </div>

          {/* Workspace actions */}
          <div className="flex gap-3 mb-8 justify-center">
            <button
              onClick={() => setShowCloner(true)}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Clone Repository
            </button>
          </div>

          {/* Clone modal */}
          {showCloner && (
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-white mb-4">Clone a Repository</h3>
              <form onSubmit={handleCloneRepo} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">Repository URL</label>
                  <input
                    type="text"
                    value={cloneUrl}
                    onChange={(e) => {
                      setCloneUrl(e.target.value);
                      // Auto-extract name from URL
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
                    onClick={() => setShowCloner(false)}
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
          {workspaces.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-3 uppercase tracking-wider">Recent Workspaces</p>
              <div className="space-y-1">
                {workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800/40 hover:border-zinc-700/40 transition-colors group"
                  >
                    <button
                      onClick={() => openWorkspace(ws)}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                        {ws.isGitRepo ? (
                          <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-200 font-medium truncate">{ws.name}</p>
                        <p className="text-[11px] text-zinc-500 truncate">{ws.repoUrl || 'Blank workspace'}</p>
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
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full IDE layout
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top Row: FileTree + Editor/Preview + AgentPanel */}
      <div className="flex-1 flex min-h-0">
        {/* Resize handle: left edge of file tree (only allow expanding from min) */}
        {/* File Tree */}
        <div className="flex-shrink-0 relative" style={{ width: leftWidth }}>
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
              {/* Preview toggle */}
              {previewInfo && previewInfo.type !== 'none' && (
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className={`p-1 rounded transition-colors ${showPreview ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
                  title={showPreview ? 'Show code editor' : `Preview ${previewInfo.framework || 'app'}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              )}
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
            <div className="w-px h-full mx-auto bg-zinc-700 group-hover:bg-indigo-500 group-active:bg-indigo-500 transition-colors" />
          </div>
        </div>

        {/* Editor + Agent */}
        <div className="flex-1 flex min-w-0">
          {/* Editor Panel */}
          <div className="flex-1 flex flex-col min-w-0">
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
                  <div className="h-px w-full bg-zinc-700 group-hover:bg-indigo-500 group-active:bg-indigo-500 transition-colors" />
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

          {/* Agent Panel */}
          <div className="flex-shrink-0 relative" style={{ width: rightWidth }}>
            {/* Right resize sash — absolute overlay, VS Code style */}
            <div
              className="absolute top-0 bottom-0 z-10 cursor-col-resize group"
              style={{ left: 0, width: '6px', transform: 'translateX(-50%)' }}
              onMouseDown={(e) => startDrag('right', e, rightWidth)}
            >
              <div className="w-px h-full mx-auto bg-zinc-700 group-hover:bg-indigo-500 group-active:bg-indigo-500 transition-colors" />
            </div>
            <AgentPanel
              workspaceId={activeWorkspace.id}
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
              onOpenPreview={previewInfo && previewInfo.type !== 'none' ? () => setShowPreview(true) : undefined}
            />
          </div>
        </div>
      </div>
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
