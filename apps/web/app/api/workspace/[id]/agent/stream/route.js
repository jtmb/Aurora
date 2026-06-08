// @aurora/api/workspace/[id]/agent/stream - SSE endpoint for real-time agent progress
import { getAgentEventBus } from '../../../../../../lib/agent-runner';
import { getUserId } from '../../../../../../lib/auth-utils';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';

/**
 * GET — Subscribe to real-time agent job events via SSE.
 * Query: ?jobId=xxx
 *
 * Events:
 *   data: {"type":"thinking","text":"..."}
 *   data: {"type":"content","text":"..."}
 *   data: {"type":"iteration_end"}
 *   data: {"type":"done"}
 *   data: {"type":"error","error":"..."}
 */
export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const { id } = await params;

  // Auth check
  const userId = getUserId(request);
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Ownership check
  const wsDir = validateWorkspace(id, userId);
  if (!wsDir) {
    return new Response('Workspace not found', { status: 404 });
  }

  if (!jobId) {
    return new Response('Missing jobId', { status: 400 });
  }

  let closed = false;
  const encoder = new TextEncoder();
  const eventBus = getAgentEventBus();
  const eventKey = `job:${jobId}`;

  const stream = new ReadableStream({
    start(controller) {
      const onEvent = (data) => {
        if (closed) return;
        try {
          const line = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(line));

          if (data.type === 'done' || data.type === 'error') {
            closed = true;
            eventBus.removeListener(eventKey, onEvent);
            controller.close();
          }
        } catch {
          // Stream already closed
        }
      };

      eventBus.on(eventKey, onEvent);

      // Keep-alive ping every 15 seconds
      const keepAlive = setInterval(() => {
        if (closed) {
          clearInterval(keepAlive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15000);

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(keepAlive);
        eventBus.removeListener(eventKey, onEvent);
        try { controller.close(); } catch {}
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  });
}
