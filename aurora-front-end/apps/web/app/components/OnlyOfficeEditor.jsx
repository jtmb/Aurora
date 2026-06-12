// @aurora/web - OnlyOfficeEditor: iframe-based office document editor
// Uses OnlyOffice Document Server proxied through /api/onlyoffice/
//
// ARCHITECTURE: This component is keyed by a documentVersion in the parent.
// When the agent modifies the file on disk, the parent bumps documentVersion,
// React unmounts this instance and mounts a fresh one. The fresh mount fetches
// a new OnlyOffice config whose document key includes stat.mtimeMs, so the
// Document Server recognizes the file change and loads the new content.
// No iframe.src manipulation, no postMessage bridge plugins needed.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Load the OnlyOffice API script (idempotent, cached by browser) ──
function loadOnlyOfficeApi() {
  const API_URL = '/api/onlyoffice/web-apps/apps/api/documents/api.js';
  return new Promise((resolve, reject) => {
    if (window.DocsAPI && window.DocsAPI.DocEditor) return resolve();
    const existing = document.querySelector(`script[src="${API_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('OnlyOffice API script failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('OnlyOffice API script failed'));
    document.head.appendChild(script);
  });
}

export default function OnlyOfficeEditor({
  workspaceId,
  filePath,
  fileName,
  fileType, // 'docx' | 'xlsx' | 'pptx'
  mode = 'edit', // 'edit' | 'view'
  onSaved,
  containerClassName = '',
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  // ── Initialize / destroy editor whenever deps change ──
  useEffect(() => {
    if (!workspaceId || !filePath) return;

    let active = true;
    setLoading(true);
    setError('');

    async function init() {
      try {
        // 1. Fetch editor config (document key depends on file mtime)
        const token = localStorage.getItem('auth_token') || '';
        const configUrl =
          `/api/onlyoffice/config?workspaceId=${encodeURIComponent(workspaceId)}` +
          `&filePath=${encodeURIComponent(filePath)}&mode=${mode}`;
        const res = await fetch(configUrl, {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'x-openai-key': localStorage.getItem('OPENAI_API_KEY') || '',
            'x-anthropic-key': localStorage.getItem('ANTHROPIC_API_KEY') || '',
            'x-deepseek-key': localStorage.getItem('DEEPSEEK_API_KEY') || '',
            'x-ollama-base': localStorage.getItem('OLLAMA_API_BASE') || '',
            'x-lmstudio-url': localStorage.getItem('LM_STUDIO_URL') || '',
            'x-lmstudio-api-key': localStorage.getItem('LM_STUDIO_API_KEY') || '',
          },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || `Config fetch failed (${res.status})`);
        }
        const config = await res.json();
        if (!active) return;

        // 2. Load OnlyOffice API script (cached after first load)
        await loadOnlyOfficeApi();
        if (!active) return;

        // 3. Create editor instance
        if (!window.DocsAPI?.DocEditor) {
          throw new Error('OnlyOffice API loaded but DocsAPI.DocEditor not found');
        }

        const editor = new window.DocsAPI.DocEditor('onlyoffice-editor-placeholder', {
          ...config,
          events: {
            onDocumentReady: () => {
              if (active) setLoading(false);
            },
            onDocumentStateChange: (event) => {
              // event.data === false when document is saved (no unsaved changes)
              if (event.data === false && active) {
                // Notify parent if needed
              }
            },
            onError: (event) => {
              const data = event?.data;
              // Ignore empty/benign errors (plugins, fonts, connectivity noise)
              if (!data || (typeof data === 'object' && Object.keys(data || {}).length === 0)) {
                console.warn('[OnlyOfficeEditor] Benign error (ignored):', data);
                return;
              }
              console.error('[OnlyOfficeEditor] Error:', data);
              if (active) {
                const msg = typeof data === 'object'
                  ? (data.errorDescription || data.errorMessage || data.message || JSON.stringify(data))
                  : String(data);
                setError(msg);
                setLoading(false);
              }
            },
            onRequestSaveAs: () => {},
            onRequestInsertImage: () => {},
            onRequestUsers: () => ({ users: [] }),
            onRequestEditRights: () => ({ isEdit: mode === 'edit' }),
          },
        });

        if (!active) {
          try { editor.destroyEditor(); } catch (e) {}
          return;
        }

        // Store for cleanup
        const editorRef = editor;

        // ── Fallback polling: detect rendered content (onDocumentReady may not fire) ──
        let pollAttempts = 0;
        const MAX_POLL = 32; // 32 × 250ms = 8s
        const poll = setInterval(() => {
          pollAttempts++;
          if (!active) { clearInterval(poll); return; }
          try {
            const iframe = document.querySelector('iframe[src*="onlyoffice"]');
            if (!iframe) {
              if (pollAttempts >= MAX_POLL) { clearInterval(poll); setLoading(false); }
              return;
            }
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) {
              if (pollAttempts >= MAX_POLL) { clearInterval(poll); setLoading(false); }
              return;
            }
            const canvases = doc.querySelectorAll('canvas');
            const tables = doc.querySelectorAll('table');
            const toolbarBtns = doc.querySelectorAll('[role="toolbar"] button, .toolbar button');
            const cells = doc.querySelectorAll('.cell, [class*="cell"]');
            if (canvases.length >= 2 || tables.length >= 1 || toolbarBtns.length >= 3 || cells.length >= 4) {
              clearInterval(poll);
              setLoading(false);
            }
          } catch (e) { /* cross-origin, keep waiting */ }
          if (pollAttempts >= MAX_POLL) {
            clearInterval(poll);
            setLoading(false);
          }
        }, 250);

        // ── Safety timeout: hide loading after 10s regardless ──
        const safetyTimer = setTimeout(() => {
          if (active) setLoading(false);
        }, 10000);

        // Return cleanup for this init
        const cleanup = () => {
          clearInterval(poll);
          clearTimeout(safetyTimer);
          try { editorRef.destroyEditor(); } catch (e) {}
        };

        // Attach cleanup to the active flag closure
        active._cleanup = cleanup;
      } catch (err) {
        if (active) {
          console.error('[OnlyOfficeEditor] Init error:', err);
          setError(err.message || 'Failed to initialize editor');
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      active = false;
      if (active._cleanup) {
        active._cleanup();
        active._cleanup = null;
      }
    };
  }, [workspaceId, filePath, mode, retryCount]);

  // ── Retry handler ──
  const handleRetry = useCallback(() => {
    setRetryCount(c => c + 1);
  }, []);

  // ── Render ──
  return (
    <div className={`relative ${containerClassName}`}>
      {/* OnlyOffice mounts here */}
      <div
        id="onlyoffice-editor-placeholder"
        className="w-full h-full"
        style={{ minHeight: '400px' }}
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm rounded-lg">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-zinc-400">Loading editor…</div>
          </div>
        </div>
      )}

      {/* Error overlay with retry */}
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/95 backdrop-blur-sm rounded-lg">
          <div className="flex flex-col items-center gap-4 max-w-sm text-center p-6">
            <div className="w-10 h-10 rounded-full bg-red-900/60 flex items-center justify-center text-red-300 text-lg">
              !
            </div>
            <div>
              <div className="text-sm font-medium text-red-300 mb-1">Editor Error</div>
              <div className="text-xs text-zinc-400 max-h-20 overflow-y-auto">{error}</div>
            </div>
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
