// @aurora/web - OnlyOfficeEditor: iframe-based office document editor
// Uses OnlyOffice Document Server proxied through /api/onlyoffice/

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export default function OnlyOfficeEditor({
  workspaceId,
  filePath,
  fileName,
  fileType, // 'docx' | 'xlsx' | 'pptx'
  mode = 'edit', // 'edit' | 'view'
  onSaved,
  refreshToken = 0,   // Bump to trigger editor re-initialization (agent writes)
  containerClassName = '',
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const initAttempted = useRef(false);

  // ── Initialize OnlyOffice editor ──
  useEffect(() => {
    if (!workspaceId || !filePath || !containerRef.current) return;

    // Track the latest init attempt so Strict Mode double-invoke works correctly
    const attemptId = ++initAttempted.current;
    let destroyed = false;

    async function init() {
      setLoading(true);
      setError('');

      try {
        // 1. Fetch the editor config
        const configUrl = `/api/onlyoffice/config?workspaceId=${encodeURIComponent(workspaceId)}&filePath=${encodeURIComponent(filePath)}&mode=${mode}`;
        const res = await fetch(configUrl);

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || `Config fetch failed (${res.status})`);
        }

        const config = await res.json();

        // Only proceed if this is still the latest attempt
        if (destroyed || attemptId !== initAttempted.current) return;

        // 2. Load OnlyOffice API script (proxied through our API)
        await loadScript('/api/onlyoffice/web-apps/apps/api/documents/api.js');

        if (destroyed || attemptId !== initAttempted.current) return;

        // 3. Initialize editor
        if (window.DocsAPI && window.DocsAPI.DocEditor) {
          editorRef.current = new window.DocsAPI.DocEditor('onlyoffice-editor-placeholder', {
            ...config,
            events: {
              onDocumentStateChange: (event) => {
                // event.data is true when document is modified (unsaved)
                if (event.data === false) {
                  setSaveStatus('');
                }
              },
              onDocumentReady: () => {
                setLoading(false);
              },
              onReady: () => {
                // Fallback: poll for rendering in the iframe.
                // onDocumentReady doesn't always fire through the proxy,
                // and the canvas-only check missed DOM-based editors (spreadsheets).
                // With the WebSocket proxy (server.js), Socket.IO now works
                // directly → editor loads in 3-5s. This poll catches rare edge cases.
                let attempts = 0;
                const MAX_ATTEMPTS = 24; // 24 * 250ms = 6s (DOM editors load fast)
                const poll = setInterval(() => {
                  attempts++;
                  try {
                    const iframe = document.querySelector('iframe[src*="onlyoffice"]');
                    if (!iframe) {
                      // Iframe not yet in DOM
                      if (attempts >= MAX_ATTEMPTS) {
                        clearInterval(poll);
                        setLoading(false);
                      }
                      return;
                    }

                    // Check if iframe has loaded enough to access its document
                    if (!iframe.contentDocument && !iframe.contentWindow) {
                      if (attempts >= MAX_ATTEMPTS) {
                        clearInterval(poll);
                        setLoading(false);
                      }
                      return;
                    }

                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (!doc) {
                      if (attempts >= MAX_ATTEMPTS) {
                        clearInterval(poll);
                        setLoading(false);
                      }
                      return;
                    }

                    // Detection: canvases (word/presentation) OR tables/cells (spreadsheet)
                    const canvases = doc.querySelectorAll('canvas');
                    const tables = doc.querySelectorAll('table');
                    const toolbarBtns = doc.querySelectorAll('[role="toolbar"] button, .toolbar button');
                    const cells = doc.querySelectorAll('.cell, [class*="cell"]');

                    const hasContent =
                      canvases.length >= 2 ||
                      tables.length >= 1 ||
                      toolbarBtns.length >= 3 ||
                      cells.length >= 4;

                    if (hasContent) {
                      clearInterval(poll);
                      setLoading(false);
                      return;
                    }
                  } catch (e) {
                    // Cross-origin or not yet accessible — keep waiting
                  }
                  if (attempts >= MAX_ATTEMPTS) {
                    clearInterval(poll);
                    setLoading(false); // Give up and show editor anyway
                  }
                }, 250);
              },
              onError: (event) => {
                // DS can fire onError with empty {} for benign issues (plugins,
                // fonts, connectivity noise). Only surface meaningful errors.
                const data = event.data;
                if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
                  // Empty error — log but don't show overlay
                  console.warn('[OnlyOfficeEditor] Benign error (ignored):', data);
                  return;
                }
                console.error('[OnlyOfficeEditor] Error:', data);
                const msg = typeof data === 'object'
                  ? (data.errorDescription || data.errorMessage || data.message || JSON.stringify(data))
                  : String(data);
                setError(msg);
                setLoading(false);
              },
              onRequestSaveAs: () => {
                // OnlyOffice saves directly — do nothing special
              },
              onRequestInsertImage: () => {
                // Image insertion — not supported yet
              },
              onRequestUsers: () => {
                return { users: [] };
              },
              onRequestEditRights: () => {
                // Grant edit rights in edit mode
                return { isEdit: mode === 'edit' };
              },
            },
          });
        } else {
          throw new Error('OnlyOffice API script loaded but DocsAPI not found');
        }
      } catch (err) {
        if (!destroyed && attemptId === initAttempted.current) {
          console.error('[OnlyOfficeEditor] Init error:', err);
          setError(err.message || 'Failed to initialize editor');
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      destroyed = true;
      if (editorRef.current) {
        try {
          editorRef.current.destroyEditor();
        } catch (e) {
          // Ignore cleanup errors
        }
        editorRef.current = null;
      }
    };
  }, [workspaceId, filePath, mode, refreshToken]);

  // ── Mtime polling fallback: detect external file changes ──────────────────
  const lastModifiedRef = useRef(null);
  useEffect(() => {
    if (!workspaceId || !filePath) return;
    const POLL_INTERVAL = 5000; // 5 seconds
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch(`/api/workspace/${workspaceId}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ path: filePath })
        });
        if (!res.ok || !active) return;
        const data = await res.json();
        if (data.modifiedAt && data.modifiedAt !== lastModifiedRef.current) {
          if (lastModifiedRef.current !== null) {
            // File changed externally — reload the page to get a fresh editor
            console.log('[OnlyOfficeEditor] Detected file change via mtime, reloading…');
            window.location.reload();
            return;
          }
          lastModifiedRef.current = data.modifiedAt;
        }
      } catch { /* ignore poll errors */ }
    };
    const interval = setInterval(poll, POLL_INTERVAL);
    // Also poll once on mount to capture baseline mtime
    poll();
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [workspaceId, filePath]);

  // ── Retry handler ──
  const handleRetry = useCallback(() => {
    // Increment attempt counter so any in-flight attempt is invalidated
    initAttempted.current++;
    setError('');
    setLoading(true);
    setSaveStatus('');

    // Clean up existing editor
    if (editorRef.current) {
      try {
        editorRef.current.destroyEditor();
      } catch (e) { /* ignore */ }
      editorRef.current = null;
    }

    // Remove existing OnlyOffice API script so it reloads fresh
    const oldScript = document.querySelector('script[src*="api.js"]');
    if (oldScript) oldScript.remove();
    delete window.DocsAPI;

    // Force fresh mount by reloading
    window.location.reload();
  }, []);

  return (
    <div className={`absolute inset-0 overflow-hidden ${containerClassName}`} ref={containerRef}>
      {/* Loading overlay — always mounted, hidden with CSS to avoid DOM thrashing */}
      <div
        className={`absolute inset-0 z-10 flex items-center justify-center bg-zinc-950 transition-opacity duration-200 ${loading && !error ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-sm text-zinc-500">Loading editor…</p>
        </div>
      </div>

      {/* Error overlay — always mounted, hidden with CSS */}
      <div
        className={`absolute inset-0 z-10 flex items-center justify-center bg-zinc-950 transition-opacity duration-200 ${error ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="text-center max-w-md p-8">
          <svg className="w-12 h-12 text-red-400/60 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-sm text-red-400 mb-1">{error}</p>
          <p className="text-xs text-zinc-500 mb-4">
            Make sure OnlyOffice Document Server is running:{' '}
            <code className="text-indigo-400 bg-zinc-800 px-1.5 py-0.5 rounded text-[11px]">docker-compose up -d</code>
          </p>
          <button
            onClick={handleRetry}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </div>

      {/* OnlyOffice mounts into this div */}
      <div
        id="onlyoffice-editor-placeholder"
        className="w-full h-full"
      />

      {/* Save status indicator */}
      {saveStatus && (
        <div className="absolute bottom-4 right-4 z-10 px-3 py-1.5 rounded-lg bg-zinc-800/90 border border-zinc-700/50 text-xs text-zinc-300 shadow-lg backdrop-blur-sm">
          {saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : saveStatus}
        </div>
      )}
    </div>
  );
}

// ── Script loader helper ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.DocsAPI) {
        resolve();
      } else {
        // Script tag exists but not loaded yet — wait
        const check = setInterval(() => {
          if (window.DocsAPI) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          reject(new Error('OnlyOffice API script load timeout'));
        }, 15000);
      }
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      // Give a moment for DocsAPI to register
      const check = setInterval(() => {
        if (window.DocsAPI) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        reject(new Error('OnlyOffice API script load timeout'));
      }, 10000);
    };
    script.onerror = () => {
      reject(new Error('Failed to load OnlyOffice API script'));
    };
    document.head.appendChild(script);
  });
}
