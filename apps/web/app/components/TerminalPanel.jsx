// @aurora/web - TerminalPanel: xterm.js terminal for workspace commands

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const WS_URL = process.env.NEXT_PUBLIC_TERMINAL_WS_URL || 'ws://localhost:3002';

export default function TerminalPanel({ workspaceId, initialCommand, onClose, resizeKey }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [termReady, setTermReady] = useState(false);

  // Initialize xterm + WebSocket together once term is in the DOM
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const initTimer = setTimeout(() => {
      const container = terminalRef.current;
      if (!container || xtermRef.current) return;

      // Create terminal
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        theme: {
          background: '#0a0a0a',
          foreground: '#d4d4d8',
          cursor: '#6366f1',
          selectionBackground: '#6366f140',
          black: '#18181b',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#fbbf24',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e4e4e7',
          brightBlack: '#52525b',
          brightRed: '#fca5a5',
          brightGreen: '#86efac',
          brightYellow: '#fde68a',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#fafafa',
        },
        allowProposedApi: true,
        allowTransparency: false,
        scrollback: 5000,
        tabStopWidth: 4,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
      });

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
      setTermReady(true);

      // Handle resize — use RAF to ensure DOM layout is complete before measuring
      const handleResize = () => {
        requestAnimationFrame(() => {
          try { fitAddon.fit(); } catch {}
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              cols: term.cols,
              rows: term.rows
            }));
          }
        });
      };

      const observer = new ResizeObserver(handleResize);
      observer.observe(container);

      // Keyboard input → WebSocket
      const handleData = (data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data }));
        }
      };
      term.onData(handleData);

      return () => {
        observer.disconnect();
        term.dispose();
        xtermRef.current = null;
        setTermReady(false);
      };
    }, 50);

    return () => clearTimeout(initTimer);
  }, []);

  // Connect WebSocket once terminal is ready
  useEffect(() => {
    if (!termReady || !workspaceId) return;

    const ws = new WebSocket(`${WS_URL}/terminal?workspaceId=${encodeURIComponent(workspaceId)}`);

    ws.onopen = () => {
      setConnected(true);
      setError('');
      wsRef.current = ws;

      const term = xtermRef.current;
      if (term) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }

      if (initialCommand) {
        ws.send(JSON.stringify({ type: 'input', data: initialCommand + '\r' }));
      }
    };

    ws.onmessage = (event) => {
      const term = xtermRef.current;
      if (term) term.write(event.data);
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };

    ws.onerror = () => {
      setError('Failed to connect to terminal server');
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [termReady, workspaceId]);

  // Refit when parent container is resized (e.g. terminal drag handle)
  useEffect(() => {
    if (!resizeKey || !fitAddonRef.current) return;
    // setTimeout lets React finish DOM updates + layout before measuring
    const handle = setTimeout(() => {
      try { fitAddonRef.current.fit(); } catch {}
    }, 250);
    return () => clearTimeout(handle);
  }, [resizeKey]);

  // Send initialCommand when it changes and WS is connected
  const sentCommandRef = useRef(null);
  useEffect(() => {
    if (!initialCommand || !connected || initialCommand === sentCommandRef.current) return;
    sentCommandRef.current = initialCommand;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: initialCommand + '\r' }));
    }
  }, [initialCommand, connected]);

  // Send Ctrl+C to terminal
  const handleInterrupt = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'signal', signal: 'SIGINT' }));
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-t border-zinc-800/40">
      {/* Toolbar */}
      <div className="h-8 flex items-center justify-between px-3 bg-zinc-900 border-b border-zinc-800/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Terminal</span>
          {connected ? (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Connected" />
          ) : error ? (
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" title={error} />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" title="Connecting..." />
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Ctrl+C button */}
          {connected && (
            <button
              onClick={handleInterrupt}
              className="px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Send Ctrl+C (interrupt)"
            >
              ^C
            </button>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Close terminal"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal output area */}
      <div className="flex-1 min-h-0 relative">
        {error && !connected && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/90 z-10">
            <div className="text-center">
              <svg className="w-8 h-8 text-zinc-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-zinc-500">{error}</p>
            </div>
          </div>
        )}
        <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
