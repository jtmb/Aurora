// @aurora/web - PreviewPanel: iframe preview of running dev server

'use client';

import { useState, useEffect, useCallback } from 'react';

export default function PreviewPanel({ workspaceId, previewInfo, onClose, onStartServer }) {
  const [serverStatus, setServerStatus] = useState({ running: false, port: null, url: null });
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [error, setError] = useState('');

  const { type, framework, port: defaultPort, suggestedCommand } = previewInfo || {};
  const previewUrl = serverStatus.url || (defaultPort ? `http://localhost:${defaultPort}` : null);

  // Poll server status
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/dev-server`);
      const data = await res.json();
      if (!data.error) {
        setServerStatus(data);
      }
    } catch {}
  }, [workspaceId]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // Track iframe loading
  useEffect(() => {
    if (serverStatus.running) {
      setIframeLoading(true);
    }
  }, [serverStatus.running, serverStatus.url]);

  const handleStartServer = async () => {
    setIsStarting(true);
    setError('');
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/dev-server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: suggestedCommand || 'npm run dev',
          port: defaultPort
        })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setServerStatus(data);
        setIframeLoading(true);
        // Notify parent to open terminal with the server command
        if (onStartServer) {
          onStartServer(suggestedCommand || 'npm run dev');
        }
        // Poll for port detection
        let attempts = 0;
        const portCheck = setInterval(async () => {
          attempts++;
          try {
            const statusRes = await fetch(`/api/workspace/${workspaceId}/dev-server`);
            const statusData = await statusRes.json();
            if (!statusData.error) {
              setServerStatus(statusData);
              if (statusData.url || statusData.port || attempts > 10) {
                clearInterval(portCheck);
              }
            }
          } catch {}
        }, 1000);
      }
    } catch (err) {
      setError('Failed to start dev server');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopServer = async () => {
    setIsStopping(true);
    setError('');
    try {
      await fetch(`/api/workspace/${workspaceId}/dev-server`, { method: 'DELETE' });
      setServerStatus({ running: false, port: null, url: null });
    } catch (err) {
      setError('Failed to stop dev server');
    } finally {
      setIsStopping(false);
    }
  };

  const handleOpenInTab = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
  };

  const handleIframeError = () => {
    setIframeLoading(false);
    setError('Failed to load preview. The server may still be starting...');
  };

  const typeLabels = {
    nextjs: 'Next.js',
    vite: 'Vite',
    react: 'React',
    node: 'Node.js',
    static: 'Static',
    none: 'Unknown'
  };

  const typeBadgeColors = {
    nextjs: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    vite: 'bg-purple-950/30 text-purple-300 border-purple-800/40',
    react: 'bg-sky-950/30 text-sky-300 border-sky-800/40',
    node: 'bg-green-950/30 text-green-300 border-green-800/40',
    static: 'bg-amber-950/30 text-amber-300 border-amber-800/40',
    none: 'bg-zinc-800 text-zinc-500 border-zinc-700/30'
  };

  return (
    <div className="h-full flex flex-col min-h-0 bg-zinc-950">
      {/* Toolbar */}
      <div className="h-9 flex items-center justify-between px-3 bg-zinc-900 border-b border-zinc-800/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${typeBadgeColors[type] || typeBadgeColors.none}`}>
            {typeLabels[type] || framework || 'App'}
          </span>
          {serverStatus.running && serverStatus.port && (
            <span className="text-[11px] text-zinc-500">
              :{serverStatus.port}
            </span>
          )}
          {serverStatus.running && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Server running" />
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Server controls */}
          {!serverStatus.running ? (
            <button
              onClick={handleStartServer}
              disabled={isStarting || !suggestedCommand}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
              title={suggestedCommand ? `Run: ${suggestedCommand}` : 'No dev command detected'}
            >
              {isStarting ? (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              Start
            </button>
          ) : (
            <button
              onClick={handleStopServer}
              disabled={isStopping}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 transition-colors"
            >
              {isStopping ? (
                <span className="w-3 h-3 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              )}
              Stop
            </button>
          )}

          {/* Open in new tab */}
          {serverStatus.running && previewUrl && (
            <button
              onClick={handleOpenInTab}
              className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Open in new tab"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors ml-1"
            title="Close preview"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Preview content */}
      <div className="flex-1 min-h-0 relative">
        {/* Error banner */}
        {error && (
          <div className="absolute top-0 left-0 right-0 z-10 px-3 py-2 bg-red-950/80 border-b border-red-800/40 text-[11px] text-red-300 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1 truncate">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-200 flex-shrink-0">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Iframe loading overlay */}
        {iframeLoading && serverStatus.running && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-zinc-500">Connecting to dev server...</span>
            </div>
          </div>
        )}

        {/* Iframe or placeholder */}
        {serverStatus.running && previewUrl ? (
          <iframe
            src={previewUrl}
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            title="App Preview"
          />
        ) : !error ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-12 h-12 text-zinc-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <p className="text-sm text-zinc-500 mb-1">No preview available</p>
              <p className="text-[11px] text-zinc-600 mb-4">
                {suggestedCommand ? `Run "${suggestedCommand}" to start` : 'No dev script detected'}
              </p>
              {suggestedCommand && (
                <button
                  onClick={handleStartServer}
                  disabled={isStarting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-2"
                >
                  {isStarting ? (
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                  Start Server
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
