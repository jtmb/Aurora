// @aurora/api/workspace/[id]/dev-server - Dev server process manager

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { ensureAgentsMd } from '../../../../../lib/workspace-utils';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
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
    /(?:Running on|Running) http:\/\/(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d+)/i,
    /http:\/\/(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d+)/i,
    /(?:Accepting connections|listening|serving)\s*(?:at|on)\s*(?:http:\/\/)?[\d.]+:(\d+)/i,
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
    const testBind = (host) => new Promise((res) => {
      const server = net.createServer();
      server.once('error', () => { server.close(); res(false); });
      server.once('listening', () => { server.close(() => res(true)); });
      server.listen(port, host);
    });
    // Try IPv6 dual-stack first, then IPv4 loopback
    // Some servers bind IPv4-only, which :: dual-stack won't always detect
    testBind('::').then((available) => {
      if (available) return resolve(true);
      testBind('127.0.0.1').then(resolve);
    });
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
      startedAt: entry.startedAt,
      logs: entry.logs?.slice(-100) || []  // Last 100 log lines for agent inspection
    });
  } catch (error) {
    console.error('[workspace/dev-server] GET Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to get server status' } }, { status: 500 });
  }
}

/**
 * Detect the default dev command for a workspace based on project files.
 * Returns the command string, or null if no recognizable project is found.
 */
function detectDefaultCommand(wsDir) {
  const files = fs.readdirSync(wsDir);
  const pkgPath = path.join(wsDir, 'package.json');
  
  // Python detection — check for entry points and dep files
  if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('setup.py')) {
    // Determine the entry point
    if (files.includes('app.py')) return 'python app.py';
    if (files.includes('main.py')) return 'python main.py';
    if (files.includes('server.py')) return 'python server.py';
    // Fall back to flask (most common for simple web apps)
    return 'python -m flask run --host 0.0.0.0';
  }
  
  // Node.js / npm project
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      if (scripts.dev) return 'npm run dev';
      if (scripts.start) return 'npm start';
      if (scripts.serve) return 'npm run serve';
    } catch {}
  }
  
  // Static site
  if (files.includes('index.html')) return 'npx serve . --no-clipboard';
  
  // Go
  if (files.includes('go.mod')) {
    if (files.some(f => f.endsWith('.go'))) return 'go run .';
  }
  
  // Rust
  if (files.includes('Cargo.toml')) return 'cargo run';
  
  return null;
}

/**
 * Perform auto-install for non-npm projects (Python venv + pip).
 */
function autoInstallNonNpm(wsDir, command) {
  // Python: create venv if missing, install requirements.txt
  if (command.includes('python') || command.includes('flask') || command.includes('uvicorn')) {
    const venvDir = path.join(wsDir, '.venv');
    const reqPath = path.join(wsDir, 'requirements.txt');
    
    if (fs.existsSync(reqPath)) {
      // Create venv if missing
      if (!fs.existsSync(venvDir)) {
        console.log('[workspace/dev-server] .venv missing — creating virtual environment...');
        try {
          execSync('python3 -m venv .venv', { cwd: wsDir, timeout: 60000, stdio: 'pipe' });
        } catch (err) {
          console.error('[workspace/dev-server] venv creation failed:', err.message);
          return command; // Return original command — may still work with system python
        }
      }
      // Install requirements
      const pipBin = path.join(venvDir, 'bin', 'pip');
      const pythonBin = path.join(venvDir, 'bin', 'python');
      console.log('[workspace/dev-server] Installing Python dependencies...');
      try {
        execSync(`"${pipBin}" install -r requirements.txt`, { cwd: wsDir, timeout: 120000, stdio: 'pipe' });
        console.log('[workspace/dev-server] pip install completed');
        // Rewrite command to use venv python
        return command.replace(/^python\b/, pythonBin);
      } catch (err) {
        console.error('[workspace/dev-server] pip install failed:', err.message);
      }
    }
    
    // Even without requirements.txt, try to use venv python
    if (fs.existsSync(venvDir)) {
      const pythonBin = path.join(venvDir, 'bin', 'python');
      return command.replace(/^python\b/, pythonBin);
    }
  }
  
  return command; // No changes
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
    let command = body.command;
    const preferredPort = body.port || (command ? 3001 : 8000); // Python defaults to 8000
    
    // Auto-detect the command if not explicitly provided
    if (!command) {
      const detected = detectDefaultCommand(wsDir);
      if (detected) {
        command = detected;
        console.log(`[workspace/dev-server] Auto-detected command: "${command}"`);
      } else {
        command = 'npm run dev'; // Final fallback
      }
    }

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
    // For Flask
    env.FLASK_RUN_PORT = String(assignedPort);
    env.FLASK_RUN_HOST = '0.0.0.0';
    // Force --legacy-peer-deps for ALL nested npm installs (e.g. Next.js auto-installs
    // TypeScript deps when it detects tsconfig.json but missing typescript package).
    // Without this, Next.js 15 + React 19 causes ERESOLVE on the second npm install.
    env.npm_config_legacy_peer_deps = 'true';

    console.log(`[workspace/dev-server] Starting "${command}" in ${wsDir} (PORT=${assignedPort})`);

    // AUTO-INSTALL: Handle npm and Python projects
    const hasPackageJson = fs.existsSync(path.join(wsDir, 'package.json'));
    const hasNodeModules = fs.existsSync(path.join(wsDir, 'node_modules'));
    const isNpmCommand = command.match(/^(npm|npx|yarn|pnpm|bun)\s/);
    
    if (hasPackageJson && !hasNodeModules && isNpmCommand) {
      const pkgManager = isNpmCommand[1];
      const installCmd = pkgManager === 'npx' ? 'npm' : pkgManager;
      const installArgs = pkgManager === 'npm' ? 'install --legacy-peer-deps' : 'install';
      console.log(`[workspace/dev-server] node_modules missing — running ${installCmd} ${installArgs} first...`);
      try {
        execSync(`${installCmd} ${installArgs}`, { cwd: wsDir, timeout: 120000, stdio: 'pipe' });
        console.log(`[workspace/dev-server] ${installCmd} ${installArgs} completed successfully`);
      } catch (installErr) {
        console.error(`[workspace/dev-server] ${installCmd} ${installArgs} failed:`, installErr.message);
      }
    } else if (!hasPackageJson && !isNpmCommand) {
      // Non-npm project (Python, etc.) — auto-install deps
      command = autoInstallNonNpm(wsDir, command);
    }

    // Enrich AGENTS.md with framework-specific guidance (version pinning,
    // dev commands, build steps, etc.) — only appends if not already present.
    const detectedFramework = ensureAgentsMd(wsDir);
    if (detectedFramework) {
      console.log(`[workspace/dev-server] Detected framework: ${detectedFramework} — AGENTS.md updated`);
    }

    // Parse command into executable + args
    const cmdParts = command.split(/\s+/);
    let cmd = cmdParts[0];
    let args = cmdParts.slice(1);
    
    // For serve-type commands (npx serve, http-server, live-server), let the tool
    // auto-pick its own port instead of injecting one. These tools have their own
    // port detection logic and may silently switch if our assigned port is taken.
    // We parse the actual port from stdout instead.
    const fullCmd = command.toLowerCase();
    const isServeType = fullCmd.includes('npx serve') || fullCmd.includes('npx http-server') || fullCmd.includes('live-server');
    if (isServeType) {
      // Strip any existing -l/--listen/-p/--port flag + its value so serve auto-picks
      args = args.filter((arg, i, arr) => {
        if (arg === '-l' || arg === '--listen' || arg === '-p' || arg === '--port') {
          if (i + 1 < arr.length && /^\d+$/.test(arr[i + 1])) arr.splice(i + 1, 1, '__SKIP__');
          return false;
        }
        if (arg === '__SKIP__') return false;
        return true;
      });
      // DO NOT inject -l — let serve pick its own port. We'll detect it from stdout.
      // Using --no-clipboard is already in the command from the frontend.
    }
    if (fullCmd.includes('python') && (fullCmd.includes('http.server') || fullCmd.includes('SimpleHTTPServer'))) {
      // Python http.server takes port as a positional arg; strip any existing port and inject ours
      args = args.filter(arg => !/^\d+$/.test(arg));
      args.push(String(assignedPort));
    }

    console.log(`[workspace/dev-server] Spawning: ${cmd} ${args.join(' ')}`);

    // Spawn the dev server
    const proc = spawn(cmd, args, {
      cwd: wsDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    
    const startedAt = new Date().toISOString();
    let detectedPort = null;  // Start null so output parsing can detect it
    
    // Rolling log buffer (max 200 lines, ~10KB) for agent error inspection
    const MAX_LOG_LINES = 200;
    
    // Pre-register the store entry so stdout/stderr listeners can access it
    const entry = {
      process: proc,
      port: assignedPort,
      pid: proc.pid,
      startedAt,
      command,
      logs: []
    };
    serverStore.set(id, entry);
    
    const appendLog = (text) => {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          entry.logs.push(`[${new Date().toISOString()}] ${line}`);
          if (entry.logs.length > MAX_LOG_LINES) entry.logs.shift();
        }
      }
    };
    
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      appendLog(text);
      
      // Try to detect port from output (Next.js may use its own port despite PORT env)
      const port = parsePortFromOutput(text);
      if (port) {
        detectedPort = port;
        if (entry) entry.port = port;
      }
    });
    
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      appendLog(text);
      const port = parsePortFromOutput(text);
      if (port) {
        detectedPort = port;
        if (entry) entry.port = port;
      }
    });
    
    proc.on('exit', (code) => {
      appendLog(`Process exited with code ${code}`);
      console.log(`[workspace/dev-server] Spawn process for ${id} exited with code ${code}`);
      // Don't delete from store — npm exits after launching the real dev server.
      // Port aliveness check in GET handler determines if server is truly gone.
    });
    
    proc.on('error', (err) => {
      appendLog(`Process error: ${err.message}`);
      console.error(`[workspace/dev-server] Process error for ${id}:`, err.message);
      // Only delete if we never detected a port (true startup failure)
      if (!detectedPort) {
        serverStore.delete(id);
      }
    });
    
    // For serve-type commands: wait for the actual port to be detected from stdout.
    // Don't poll assignedPort — serve auto-picks its own port and assignedPort may
    // be a false positive (another app already listening there).
    // For other commands: poll the assigned port (backed by PORT env var).
    const READINESS_TIMEOUT_MS = 30000;
    const POLL_INTERVAL_MS = 500;
    const startPoll = Date.now();
    let portReady = false;
    let finalPort = isServeType ? null : assignedPort;
    
    while (Date.now() - startPoll < READINESS_TIMEOUT_MS) {
      // For serve-type, only check the port detected from stdout — never assignedPort
      if (isServeType) {
        if (detectedPort) {
          finalPort = detectedPort;
          entry.port = detectedPort;
          if (await checkPortAlive(finalPort)) {
            portReady = true;
            break;
          }
        }
        // detectedPort not yet available — keep waiting for stdout
      } else {
        if (await checkPortAlive(finalPort)) {
          portReady = true;
          break;
        }
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!portReady) {
      // Server didn't come up in time — clean up and report failure
      appendLog(`Server failed to start on port ${finalPort} within ${READINESS_TIMEOUT_MS}ms`);
      killProcessTree(proc.pid);
      serverStore.delete(id);
      return NextResponse.json({
        running: false,
        port: finalPort,
        error: { message: `Server did not start on port ${finalPort} within ${READINESS_TIMEOUT_MS / 1000}s. Check command.` },
        logs: entry.logs.slice(-50),
        command
      }, { status: 500 });
    }

    return NextResponse.json({
      running: true,
      port: finalPort,
      pid: proc.pid,
      url: finalPort ? `http://localhost:${finalPort}` : null,
      startedAt,
      logs: entry.logs.slice(-50),  // Return last 50 lines on start
      command,
      message: `Dev server started on port ${finalPort}`
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
