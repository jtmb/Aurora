// @aurora/api/workspace/[id]/exec - Execute a shell command in the workspace

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { execSync } from 'child_process';

/**
 * POST — Execute a shell command in the workspace directory.
 * Returns stdout, stderr, and exit code. 30s timeout.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    const body = await request.json().catch(() => ({}));
    const command = body.command;
    
    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: { message: 'command is required' } }, { status: 400 });
    }
    
    // Security: block dangerous commands
    const blocked = ['rm -rf', 'sudo', 'chmod 777', '> /dev', 'mkfs', 'dd if=', ':(){', 'fork bomb'];
    const lower = command.toLowerCase();
    if (blocked.some(b => lower.includes(b))) {
      return NextResponse.json({ error: { message: 'Blocked dangerous command' } }, { status: 403 });
    }
    
    console.log(`[workspace/exec] Running "${command}" in ${wsDir}`);
    
    try {
      const stdout = execSync(command, {
        cwd: wsDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024, // 1MB
        encoding: 'utf-8',
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' }
      });
      
      return NextResponse.json({
        success: true,
        stdout: stdout.slice(-10000), // Last 10KB to avoid huge responses
        stderr: '',
        exitCode: 0
      });
    } catch (execErr) {
      return NextResponse.json({
        success: false,
        stdout: (execErr.stdout || '').slice(-10000),
        stderr: (execErr.stderr || execErr.message || '').slice(-10000),
        exitCode: execErr.status || 1
      });
    }
  } catch (error) {
    console.error('[workspace/exec] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to execute command' } }, { status: 500 });
  }
}
