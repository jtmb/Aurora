// @aurora/api/workspace/[id]/dev-server - Dev server process manager

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { spawn } from 'child_process';
import path from 'path';

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
 * Kill a process and all its children safely.
 */
function killProcessTree(pid, signal = 'SIGTERM') {
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
    
    // Check if process is still alive
    const alive = entry.process.exitCode === null && entry.process.killed === false;
    
    if (!alive) {
      serverStore.delete(id);
      return NextResponse.json({ running: false, exitCode: entry.process.exitCode });
    }
    
    return NextResponse.json({
      running: true,
      port: entry.port,
      pid: entry.process.pid,
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
    if (existing && existing.process.exitCode === null && !existing.process.killed) {
      return NextResponse.json({
        running: true,
        port: existing.port,
        pid: existing.process.pid,
        url: existing.port ? `http://localhost:${existing.port}` : null,
        startedAt: existing.startedAt,
        message: 'Server is already running'
      });
    }
    
    // Parse request body for custom command/port
    const body = await request.json().catch(() => ({}));
    const command = body.command || 'npm run dev';
    const preferredPort = body.port;
    
    // Parse command into executable + args
    const cmdParts = command.split(/\s+/);
    const cmd = cmdParts[0];
    const args = cmdParts.slice(1);
    
    // Set up environment with optional port override
    const env = { ...process.env };
    if (preferredPort) {
      env.PORT = String(preferredPort);
    }
    // For default port, use 3001 to avoid conflicting with Aurora on 3000
    else {
      env.PORT = env.PORT || '3001';
    }
    
    console.log(`[workspace/dev-server] Starting "${command}" in ${wsDir} (PORT=${env.PORT})`);
    
    // Spawn the dev server
    const proc = spawn(cmd, args, {
      cwd: wsDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    
    const startedAt = new Date().toISOString();
    let detectedPort = preferredPort || parseInt(env.PORT) || null;
    
    // Capture stdout/stderr to detect the port
    let outputBuffer = '';
    
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      
      // Try to detect port from output
      const port = parsePortFromOutput(text);
      if (port && !detectedPort) {
        detectedPort = port;
        const entry = serverStore.get(id);
        if (entry) entry.port = port;
      }
    });
    
    proc.stderr.on('data', (data) => {
      outputBuffer += data.toString();
      const port = parsePortFromOutput(data.toString());
      if (port && !detectedPort) {
        detectedPort = port;
        const entry = serverStore.get(id);
        if (entry) entry.port = port;
      }
    });
    
    proc.on('exit', (code) => {
      console.log(`[workspace/dev-server] Process for ${id} exited with code ${code}`);
      serverStore.delete(id);
    });
    
    proc.on('error', (err) => {
      console.error(`[workspace/dev-server] Process error for ${id}:`, err.message);
      serverStore.delete(id);
    });
    
    // Store the process
    serverStore.set(id, {
      process: proc,
      port: detectedPort,
      pid: proc.pid,
      startedAt,
      command
    });
    
    // Remove from store if process dies quickly (startup failure)
    setTimeout(() => {
      const entry = serverStore.get(id);
      if (entry && entry.process.exitCode !== null) {
        serverStore.delete(id);
      }
    }, 3000);
    
    return NextResponse.json({
      running: true,
      port: detectedPort,
      pid: proc.pid,
      url: detectedPort ? `http://localhost:${detectedPort}` : null,
      startedAt,
      command,
      message: 'Dev server started'
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
    
    const pid = entry.process.pid;
    
    // Try SIGTERM first, then SIGKILL after 3s
    killProcessTree(pid, 'SIGTERM');
    
    const killTimeout = setTimeout(() => {
      try {
        killProcessTree(pid, 'SIGKILL');
      } catch {}
    }, 3000);
    
    // Clean up when process exits
    entry.process.once('exit', () => {
      clearTimeout(killTimeout);
      serverStore.delete(id);
    });
    
    serverStore.delete(id);
    
    return NextResponse.json({ message: 'Dev server stopped', running: false });
  } catch (error) {
    console.error('[workspace/dev-server] DELETE Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to stop dev server' } }, { status: 500 });
  }
}
