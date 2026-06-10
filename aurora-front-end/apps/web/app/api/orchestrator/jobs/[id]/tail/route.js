/**
 * api/orchestrator/jobs/[id]/tail/route.js — SSE pass-through
 *
 * GET /api/orchestrator/jobs/:id/tail
 * Streams orchestrator output as Server-Sent Events.
 */

const API_URL = `${process.env.CODE_SERVER_URL || "http://127.0.0.1:3001"}/api/jobs`;

export async function GET(request, { params }) {
  const { id } = await params;

  try {
    const upstream = await fetch(`${API_URL}/${id}/tail`, {
      headers: { Accept: "text/event-stream" },
      signal: request.signal,
    });

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: `Upstream returned ${upstream.status}` }),
        { status: upstream.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Pass through the SSE stream with abort handling
    let aborted = false;
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || aborted) break;
            controller.enqueue(value);
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.error("[orchestrator/tail] stream error:", err.message);
          }
        } finally {
          try { reader.releaseLock(); } catch (_) {}
          try { controller.close(); } catch (_) {}
        }
      },
      cancel() {
        aborted = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    console.error("[orchestrator/tail] error:", err.message);
    return new Response(
      JSON.stringify({ error: `Orchestrator unreachable: ${err.message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
