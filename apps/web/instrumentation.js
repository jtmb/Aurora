// @aurora/web - Instrumentation hook for server startup

export async function register() {
  // Only run on server startup, not during build or edge runtime
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startTerminalServer } = await import('./lib/terminal-server.js');
    const port = parseInt(process.env.TERMINAL_WS_PORT || '3002', 10);
    startTerminalServer(port);
    console.log(`[instrumentation] Terminal WebSocket server started on port ${port}`);
  }
}
