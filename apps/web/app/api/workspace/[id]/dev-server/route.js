// @aurora/api/workspace/[id]/dev-server - Dev server process manager

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { spawn } from 'child_process';
import net from 'net';

/**
 * In-memory store of running dev server processes, keyed by workspace ID.
 * Survives across requests but resets on server restart.
 * 
 * Each entry: { process: ChildProcess, port: number, pid: number, startedAt: string }
 */
const serverStore = new Map();

/**
 * Parse a port number from dev server stdout output.
 * Handles Next.js: "- Local: http://localhost:3000"
 * Handles Vite: "Local: http://localhost:5173/"
 */
function parsePortFromOutput(text) {
  const patterns = [
    /(?:Local|localhost):\s*(?:http:\/\/)?localhost:(\d+)/i,
    /http:\/\/localhost:(\d+)/gi,
    /port\s+(\d+)/i,
    /listening on :(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const port = parseInt(match[1], 10);
      if (port >= 1024 && port <= 65535) return port;
    }
  }
  return null;
}

/**
 * Check if a TCP port is actually listening (500ms timeout).
 * This is more reliable than checking process liveness because
 * npm/spawn wrappers exit after launching the real dev server.
 */
function checkPortAlive(port) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => {
      socket.destroy();
      // Fallback to IPv4 loopback
      const sock2 = new net.Socket();
      sock2.setTimeout(500);
      sock2.on('connect', () => { sock2.destroy(); resolve(true); });
      sock2.on('error', () => { sock2.destroy(); resolve(false); });
      sock2.on('timeout', () => { sock2.destroy(); resolve(false); });
      sock2.connect(port, '127.0.0.1');
    });
    socket.on('error', () => {
      socket.destroy();
      // Fallback to IPv4 loopback
      const sock2 = new net.Socket();
      sock2.setTimeout(500);
      sock2.on('connect', () => { sock2.destroy(); resolve(true); });
      sock2.on('error', () => { sock2.destroy(); resolve(false); });
      sock2.on('timeout', () => { sock2.destroy(); resolve(false); });
      sock2.connect(port, '127.0.0.1');
    });
    // Try IPv6 loopback first for dual-stack servers
    socket.connect(port, '::1');
  });
}

/**
 * Check if a port is truly available to bind to.
 * Uses net.createServer().listen() — the only reliable way to detect
 * EADDRINUSE across both IPv4 and IPv6 (Next.js binds to :: dual-stack).
 */
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      server.close();
      resolve(false); // EADDRINUSE or other error = not available
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    // Bind to :: (IPv6 dual-stack) — same as what Next.js dev server does
    server.listen(port, '::');
  });
}

/**
 * Find the next available TCP port starting from `startPort`.
 * Uses a real bind test to avoid IPv4/v6 mismatches.
 * Scans up to 100 ports before giving up.
 */
async function findAvailablePort(startPort) {
  const maxAttempts = 100;
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await checkPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Kill a process and all its children safely.
 */
function killProcessTree(pid, signal = 'SIGTERM') {
  if (!pid) return;
  try {
    process.kill(-pid, signal); // Kill process group
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

/**
 * GET — Get the status of the dev server for a workspace.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    const entry = serverStore.get(id);
    
    if (!entry) {
      return NextResponse.json({ running: false });
    }
    
    // Check if port is actually listening (more reliable than process liveness)
    // npm/spawn wrappers often exit after launching the real dev server
    const portAlive = await checkPortAlive(entry.port);
    
    if (!portAlive) {
      serverStore.delete(id);
      return NextResponse.json({ running: false });
    }
    
    return NextResponse.json({
      running: true,
      port: entry.port,
      pid: entry.process?.pid,
      url: entry.port ? `http://localhost:${entry.port}` : null,
      startedAt: entry.startedAt
    });
  } catch (error) {
    console.error('[workspace/dev-server] GET Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to get server status' } }, { status: 500 });
  }
}

/**
 * POST — Start a dev server for a workspace.
 * Body: { command?: string, port?: number }
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    // Check if already running
    const existing = serverStore.get(id);
    if (existing) {
      // Check if the port is actually alive (don't trust process liveness alone)
      const portAlive = await checkPortAlive(existing.port);
      if (portAlive) {
        return NextResponse.json({
          running: true,
          port: existing.port,
          pid: existing.process?.pid,
          url: existing.port ? `http://localhost:${existing.port}` : null,
          startedAt: existing.startedAt,
          message: 'Server is already running'
        });
      }
      // Stale entry — clean it up before starting fresh
      console.log(`[workspace/dev-server] Stale entry for ${id} (port ${existing.port} not alive) — cleaning up`);
      serverStore.delete(id);
    }
    
    // Parse request body for custom command/port
    const body = await request.json().catch(() => ({}));
    const command = body.command || 'npm run dev';
    const preferredPort = body.port || 3001;

    // Find an available port (dynamic assignment to avoid EADDRINUSE)
    let assignedPort;
    try {
      assignedPort = await findAvailablePort(preferredPort);
    } catch {
      return NextResponse.json(
        { error: { message: `No available port found starting from ${preferredPort}` } },
        { status: 503 }
      );
    }

    const portChanged = assignedPort !== preferredPort;
    if (portChanged) {
      console.log(`[workspace/dev-server] Port ${preferredPort} in use — using ${assignedPort} instead`);
    }
    
    // Set up environment with the dynamically assigned port
    const env = { ...process.env };
    env.PORT = String(assignedPort);

    console.log(`[workspace/dev-server] Starting "${command}" in ${wsDir} (PORT=${assignedPort})`);

    // Parse command into executable + args
    const cmdParts = command.split(/\s+/);
    const cmd = cmdParts[0];
    const args = cmdParts.slice(1);
    
    // Spawn the dev server
    const proc = spawn(cmd, args, {
      cwd: wsDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    
    const startedAt = new Date().toISOString();
    let detectedPort = null;  // Start null so output parsing can detect it
    
    // Capture stdout/stderr to detect the port
    let outputBuffer = '';
    
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      
      // Try to detect port from output (Next.js may use its own port despite PORT env)
      const port = parsePortFromOutput(text);
      if (port && port !== assignedPort) {
        detectedPort = port;
        const entry = serverStore.get(id);
        if (entry) entry.port = port;
      }
    });
    
    proc.stderr.on('data', (data) => {
      outputBuffer += data.toString();
      const port = parsePortFromOutput(data.toString());
      if (port && port !== assignedPort) {
        detectedPort = port;
        const entry = serverStore.get(id);
        if (entry) entry.port = port;
      }
    });
    
    proc.on('exit', (code) => {
      console.log(`[workspace/dev-server] Spawn process for ${id} exited with code ${code}`);
      // Don't delete from store — npm exits after launching the real dev server.
      // Port aliveness check in GET handler determines if server is truly gone.
    });
    
    proc.on('error', (err) => {
      console.error(`[workspace/dev-server] Process error for ${id}:`, err.message);
      // Only delete if we never detected a port (true startup failure)
      if (!detectedPort) {
        serverStore.delete(id);
      }
    });
    
    // Store the process — use detectedPort if output revealed a different port, else assignedPort
    const finalPort = detectedPort || assignedPort;
    serverStore.set(id, {
      process: proc,
      port: finalPort,
      pid: proc.pid,
      startedAt,
      command
    });
    
    return NextResponse.json({
      running: true,
      port: finalPort,
      pid: proc.pid,
      url: finalPort ? `http://localhost:${finalPort}` : null,
      startedAt,
      command,
      message: portChanged ? `Dev server started on port ${finalPort}` : 'Dev server started'
    }, { status: 201 });
  } catch (error) {
    console.error('[workspace/dev-server] POST Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to start dev server' } }, { status: 500 });
  }
}

/**
 * DELETE — Stop the dev server for a workspace.
 */
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    const entry = serverStore.get(id);
    
    if (!entry) {
      return NextResponse.json({ message: 'No server running', running: false });
    }
    
    // Remove from store immediately so polls stop returning running=true
    serverStore.delete(id);
    
    // Kill the process if it's still alive
    if (entry.process && entry.process.exitCode === null && !entry.process.killed) {
      const pid = entry.process.pid;
      killProcessTree(pid, 'SIGTERM');
      setTimeout(() => {
        try { killProcessTree(pid, 'SIGKILL'); } catch {}
      }, 3000);
    }
    
    return NextResponse.json({ message: 'Dev server stopped', running: false });
  } catch (error) {
    console.error('[workspace/dev-server] DELETE Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to stop dev server' } }, { status: 500 });
  }
}
