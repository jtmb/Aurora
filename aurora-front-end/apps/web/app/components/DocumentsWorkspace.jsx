// @aurora/web - DocumentsWorkspace: document hub + OnlyOffice editor
// Shows document-type selection hub, creates blank Office files, and opens the editor.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import OnlyOfficeEditor from './OnlyOfficeEditor';
import AgentPanel from './AgentPanel';

const DOC_TYPES = [
  { type: 'docx', label: 'Document', icon: '📄', desc: 'Word processor', ext: '.docx' },
  { type: 'xlsx', label: 'Spreadsheet', icon: '📊', desc: 'Sheets & tables', ext: '.xlsx' },
  { type: 'pptx', label: 'Presentation', icon: '📽️', desc: 'Slides & decks', ext: '.pptx' },
];

function getAuthHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (!token) return {};
  return { 'Authorization': `Bearer ${token}` };
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  } catch { return ''; }
}

export default function DocumentsWorkspace({
  workspace,
}) {
  const workspaceId = workspace?.id;
  const [activeFile, setActiveFile] = useState(null);  // { path, type }
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(null);       // type being created
  const [error, setError] = useState('');
  const [documentVersion, setDocumentVersion] = useState(0);
  const versionTimerRef = useRef(null);  // debounce timer for agent-induced rapid version bumps
  const hasAutoOpened = useRef(false);

  // ── Chat panel state ────────────────────────────────────────────────────
  const [chatVisible, setChatVisible] = useState(true);
  const MIN_CHAT = 280;
  const DEFAULT_CHAT = 380;
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT);
  const draggingRef = useRef(null);
  const chatId = `docs_${workspaceId}_chat`;
  const [chatMessages, setChatMessages] = useState(null); // null = not fetched yet

  // Resize drag handlers
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!draggingRef.current) return;
      const { startX, startSize } = draggingRef.current;
      const delta = startX - e.clientX;
      setChatWidth(Math.max(MIN_CHAT, startSize + delta));
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

  const startDrag = (e, currentSize) => {
    e.preventDefault();
    draggingRef.current = { startX: e.clientX, startSize: currentSize };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // ── Document-aware agent callbacks ──────────────────────────────────────
  // NOTE: defined after loadFiles so they can reference it
  const handleReadFile = useCallback(async (filePath) => {
    if (!workspaceId) return null;
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/document/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ filePath }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, [workspaceId]);

  const handleFileEdit = useCallback(async (filePath, newContent) => {
    if (!workspaceId) return null;
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/document/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ filePath, content: newContent }),
      });
      if (!res.ok) return null;
      setDocumentVersion(t => t + 1);
      loadFiles();
      return await res.json();
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleFileTreeChange = useCallback(() => {
    loadFiles();
    // Debounce version bumps — agent SSE fires files_changed/iteration_end/done
    // within milliseconds; we only need one editor remount per burst.
    if (versionTimerRef.current) clearTimeout(versionTimerRef.current);
    versionTimerRef.current = setTimeout(() => {
      setDocumentVersion(t => t + 1);
      versionTimerRef.current = null;
    }, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handle document_changed SSE event (agent wrote to .docx) ──
  // Bumps documentVersion so the OnlyOfficeEditor remounts with a fresh config,
  // which picks up the new file content via updated mtime-based document key.
  const handleDocumentChanged = useCallback((filePath, content) => {
    // Reload file list and bump version to force editor remount
    loadFiles();
    if (versionTimerRef.current) clearTimeout(versionTimerRef.current);
    versionTimerRef.current = setTimeout(() => {
      setDocumentVersion(t => t + 1);
      versionTimerRef.current = null;
    }, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load existing documents ──────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspaceId}/documents/list`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch (e) {
      // Silent — list endpoint isn't critical
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // ── Auto-open pending doc or first document on initial mount ─────────────
  useEffect(() => {
    if (hasAutoOpened.current) return;

    const pendingDoc = workspace?._pendingDoc;
    if (pendingDoc) {
      const ext = pendingDoc.split('.').pop()?.toLowerCase() || 'docx';
      setActiveFile({ path: pendingDoc, type: ext });
      hasAutoOpened.current = true;
      return;
    }

    if (!loading && files.length > 0) {
      const first = files[0];
      const ext = first.type || first.path?.split('.').pop()?.toLowerCase() || 'docx';
      setActiveFile({ path: first.path, type: ext });
      hasAutoOpened.current = true;
    }
  }, [files, loading, workspace?._pendingDoc]);

  // ── Fetch chat messages when opening a document (survives back/forth nav) ──
  useEffect(() => {
    if (!activeFile || !workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const res = await fetch(`/api/chats/${chatId}/messages`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setChatMessages(data.messages || []);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [activeFile, workspaceId, chatId]);

  // ── Create a new blank document ──────────────────────────────────────────
  const createDocument = useCallback(async (type, label) => {
    if (!workspaceId || creating) return;
    setCreating(type);
    setError('');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/workspace/${workspaceId}/documents/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type, name: `New ${label}` }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || `Failed to create ${label} (${res.status})`);
      }

      const data = await res.json();
      setActiveFile({ path: data.path, type: data.type });
      // Reload file list in background
      loadFiles();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(null);
    }
  }, [workspaceId, creating, loadFiles]);

  // ── Open an existing document ────────────────────────────────────────────
  const openFile = useCallback((file) => {
    const ext = file.type || file.path?.split('.').pop()?.toLowerCase();
    setActiveFile({ path: file.path, type: ext || 'docx' });
    setError('');
  }, []);

  // ── Back to hub ──────────────────────────────────────────────────────────
  const backToHub = useCallback(() => {
    setActiveFile(null);
    setDocumentVersion(t => t + 1);  // Force editor re-init on next open
    loadFiles();                   // Refresh file list
  }, [loadFiles]);

  // ── Editor view ──────────────────────────────────────────────────────────
  if (activeFile) {
    const activeFilePath = activeFile.path;
    const activeFileName = activeFile.path.split('/').pop();

    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top bar with file name, back button, and chat toggle */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800/40 flex-shrink-0">
          <button
            onClick={backToHub}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-0.5 rounded hover:bg-zinc-800/50"
          >
            ← Documents
          </button>
          <span className="text-zinc-600 text-xs">/</span>
          <span className="text-xs text-zinc-300 font-medium truncate flex-1">
            {activeFileName}
          </span>
          {/* Chat toggle button */}
          <button
            onClick={() => setChatVisible(v => !v)}
            title={chatVisible ? 'Hide chat' : 'Show chat'}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
              chatVisible
                ? 'text-blue-400 bg-blue-900/30 hover:bg-blue-900/50'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Chat
          </button>
        </div>

        {/* Editor + Chat split */}
        <div className="flex-1 flex min-h-0">
          {/* Left: OnlyOffice editor */}
          <div className="flex-1 min-w-0 p-4 bg-zinc-950 overflow-hidden relative">
            <OnlyOfficeEditor
              key={documentVersion}
              workspaceId={workspaceId}
              filePath={activeFilePath}
              fileName={activeFileName}
              fileType={activeFile.type}
              mode="edit"
              containerClassName="h-full rounded-lg shadow-2xl border border-zinc-800/40 overflow-hidden"
            />
          </div>

          {/* Resize handle */}
          {chatVisible && (
            <div
              className="w-1.5 bg-zinc-800 hover:bg-blue-600/60 cursor-col-resize flex-shrink-0 transition-colors relative group"
              onMouseDown={(e) => startDrag(e, chatWidth)}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          )}

          {/* Right: Chat panel */}
          {chatVisible && (
            <div style={{ width: chatWidth }} className="flex-shrink-0 min-h-0 border-l border-zinc-800/40 bg-zinc-950">
              <AgentPanel
                workspaceId={workspaceId}
                workspaceChatId={chatId}
                initialMessages={chatMessages}
                activeFilePath={activeFilePath}
                onFileEdit={handleFileEdit}
                onReadFile={handleReadFile}
                onFileTreeChange={handleFileTreeChange}
                onDocumentChanged={handleDocumentChanged}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Document Hub ─────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">

          {/* ── Header ── */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-zinc-100 mb-1">Documents</h1>
            <p className="text-sm text-zinc-500">
              Create and edit Office documents in {workspace?.name || 'this workspace'}
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
          <div className="mb-8">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Create New</h2>
            <div className="grid grid-cols-3 gap-3">
              {DOC_TYPES.map(({ type, label, icon, desc }) => (
                <button
                  key={type}
                  onClick={() => createDocument(type, label)}
                  disabled={!!creating}
                  className="flex flex-col items-center gap-2 p-5 rounded-xl border border-zinc-800/60 bg-zinc-900/60 hover:bg-zinc-800/60 hover:border-zinc-700/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                  <span className="text-3xl">{icon}</span>
                  <div className="text-center">
                    <div className="text-sm font-medium text-zinc-200">{label}</div>
                    <div className="text-[11px] text-zinc-500">{desc}</div>
                  </div>
                  {creating === type && (
                    <span className="text-[11px] text-blue-400 animate-pulse mt-1">Creating…</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Recent Documents ── */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Recent Documents {files.length > 0 && `(${files.length})`}
            </h2>
            {loading ? (
              <div className="text-sm text-zinc-500 py-4">Loading documents…</div>
            ) : files.length === 0 ? (
              <div className="text-sm text-zinc-600 py-4">
                No documents yet. Create one above to get started.
              </div>
            ) : (
              <div className="space-y-1">
                {files.map((file, i) => {
                  const ext = (file.type || file.path?.split('.').pop() || '').toLowerCase();
                  const iconMap = { docx: '📄', xlsx: '📊', pptx: '📽️', doc: '📄', xls: '📊', ppt: '📽️' };
                  const icon = iconMap[ext] || '📄';
                  return (
                    <button
                      key={file.path || i}
                      onClick={() => openFile(file)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left group"
                    >
                      <span className="text-lg flex-shrink-0">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-300 group-hover:text-zinc-100 truncate">
                          {file.name || file.path?.split('/').pop()}
                        </div>
                        <div className="text-[11px] text-zinc-600">
                          {file.path?.split('/').slice(0, -1).join('/') || 'root'} — {formatSize(file.size)} · {formatDate(file.modifiedAt)}
                        </div>
                      </div>
                      <span className="text-[10px] text-zinc-600 uppercase flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        Open →
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-zinc-900 border-t border-zinc-800/40 flex-shrink-0">
        <span className="text-[10px] text-zinc-500">{workspace?.name || 'Documents'}</span>
        <span className="text-[10px] text-zinc-600">Powered by OnlyOffice</span>
      </div>
    </div>
  );
}
