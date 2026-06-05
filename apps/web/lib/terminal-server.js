// @aurora/web - Terminal WebSocket server using node-pty

import { WebSocketServer } from 'ws';
import { spawn } from 'node-pty';
import { createServer } from 'http';
import { getWorkspaceDir } from './workspace-utils.js';

/**
 * Manages PTY sessions per workspace. Each workspace gets one terminal.
 * Keyed by workspaceId → { pty, ws, buffer }
 */
const sessions = new Map();

/**
 * Start the terminal WebSocket server on the given port.
 * Returns the http.Server instance so it can be closed on shutdown.
 */
export function startTerminalServer(port = 3002) {
  const httpServer = createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/terminal'
  });

  wss.on('connection', (ws, req) => {
    // Parse workspace ID from URL query: /terminal?workspaceId=xxx
    const url = new URL(req.url, 'http://localhost');
    const workspaceId = url.searchParams.get('workspaceId');

    if (!workspaceId) {
      ws.send('\x1b[31mError: Missing workspaceId parameter\x1b[0m\r\n');
      ws.close();
      return;
    }

    // Resolve workspace path from ID
    const cwd = getWorkspaceDir(workspaceId);

    console.log(`[terminal-server] Connection for workspace ${workspaceId} (cwd: ${cwd})`);

    // Kill existing session for this workspace
    const existing = sessions.get(workspaceId);
    if (existing) {
      try { existing.pty.kill(); } catch {}
      try { existing.ws.close(); } catch {}
      sessions.delete(workspaceId);
    }

    // Spawn PTY
    const shell = process.env.SHELL || '/bin/bash';
    const pty = spawn(shell, [], {
      cwd,
      env: { 
        ...process.env, 
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
        PORT: '3001' // Default dev port to avoid conflict with Aurora
      },
      cols: 120,
      rows: 24,
    });

    const session = { pty, ws, buffer: '' };
    sessions.set(workspaceId, session);

    // PTY output → WebSocket
    pty.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    });

    // WebSocket input → PTY
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        
        if (msg.type === 'input') {
          pty.write(msg.data);
        } else if (msg.type === 'resize') {
          pty.resize(msg.cols, msg.rows);
        } else if (msg.type === 'signal') {
          // Send signal (e.g., SIGINT for Ctrl+C)
          try { pty.kill(msg.signal || 'SIGINT'); } catch {}
        }
      } catch {
        // Raw text input for simplicity
        pty.write(raw.toString());
      }
    });

    // Cleanup on disconnect
    ws.on('close', () => {
      console.log(`[terminal-server] Disconnect for workspace ${workspaceId}`);
      try { pty.kill(); } catch {}
      sessions.delete(workspaceId);
    });

    ws.on('error', () => {
      try { pty.kill(); } catch {}
      sessions.delete(workspaceId);
    });

    // Send welcome message
    ws.send(`\x1b[1;34m● Terminal — ${cwd}\x1b[0m\r\n`);
    ws.send(`\x1b[90m  Type 'exit' to close or use the close button above.\x1b[0m\r\n\r\n`);
  });

  httpServer.listen(port, () => {
    console.log(`[terminal-server] WebSocket server listening on port ${port}`);
  });

  // Cleanup on server shutdown
  const shutdown = () => {
    console.log('[terminal-server] Shutting down...');
    for (const [, session] of sessions) {
      try { session.pty.kill(); } catch {}
      try { session.ws.close(); } catch {}
    }
    sessions.clear();
    wss.close();
    httpServer.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { httpServer, wss, shutdown };
}

/**
 * Kill a workspace's terminal session.
 */
export function killTerminalSession(workspaceId) {
  const session = sessions.get(workspaceId);
  if (session) {
    try { session.pty.kill(); } catch {}
    try { session.ws.close(); } catch {}
    sessions.delete(workspaceId);
    return true;
  }
  return false;
}

/**
 * Get info about a session.
 */
export function getTerminalSession(workspaceId) {
  return sessions.has(workspaceId);
}
