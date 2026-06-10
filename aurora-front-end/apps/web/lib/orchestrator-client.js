/**
 * lib/orchestrator-client.js — Client-side wrapper for the Orchestrator API
 *
 * Usage:
 *   import {
 *     startJob, getJob, listJobs, tailJob, stopJob
 *   } from '@/lib/orchestrator-client';
 *
 *   const { jobId } = await startJob("Build a React todo app", workspaceId);
 *   tailJob(jobId, {
 *     onLine:  (line) => console.log(line),
 *     onDone:  (result) => console.log("Done!", result),
 *     onError: (err) => console.error(err),
 *   });
 */

const BASE = "/api/orchestrator/jobs";

/**
 * Start a new orchestrator job.
 * @param {string} task - The task description
 * @param {string} workspaceId - Workspace UUID
 * @param {string} [model] - Model ID to use (e.g. "qwen/qwen3.5-9b")
 * @param {string} [provider] - Provider source (e.g. "lmstudio", "openai", "deepseek", "anthropic", "ollama")
 * @param {string} [mode] - Operation mode ("plan" or "agent")
 * @returns {Promise<{jobId: string, workspaceId: string}>}
 */
export async function startJob(task, workspaceId, model, provider, mode) {
  const body = { task, workspaceId };
  if (model) body.model = model;
  if (provider) body.provider = provider;
  if (mode) body.mode = mode;

  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to start job (${res.status})`);
  }

  return res.json();
}

/**
 * Get a single job's status.
 * @param {string} jobId
 * @returns {Promise<object|null>}
 */
export async function getJob(jobId) {
  const res = await fetch(`${BASE}/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * List all jobs.
 * @returns {Promise<Array>}
 */
export async function listJobs() {
  const res = await fetch(BASE);
  if (!res.ok) return [];
  const data = await res.json();
  return data.jobs || [];
}

/**
 * Stop a running job.
 * @param {string} jobId
 * @returns {Promise<{stopped: boolean}>}
 */
export async function stopJob(jobId) {
  const res = await fetch(`${BASE}/${jobId}/stop`, { method: "POST" });
  return res.json();
}

/**
 * Tail a job's output via SSE.
 *
 * @param {string} jobId
 * @param {object} callbacks
 * @param {(line: string) => void} callbacks.onLine - Called for each output line
 * @param {(result: {status: string, exitCode?: number}) => void} callbacks.onDone - Called when job finishes
 * @param {(error: Error) => void} callbacks.onError - Called on connection error
 * @param {(status: {status: string, startedAt: string}) => void} [callbacks.onStatus] - Called on initial status
 * @returns {() => void} Abort function — call to disconnect
 */
export function tailJob(jobId, { onLine, onDone, onError, onStatus }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/${jobId}/tail`, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`SSE connection failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.line !== undefined) {
                onLine?.(data.line);
              }
            } catch {
              // non-JSON data line, skip
            }
          } else if (line.startsWith("event: done")) {
            // Next line will be the done data
            // (handled below when we see data: after event:)
          } else if (line.startsWith("event: status")) {
            // Next line will be status data
          }
        }

        // After splitting, check if we have an event+data pair across line boundaries
        // This is a simplification; for robust SSE see EventSource API
      }

      // Check remaining buffer for done event
      if (buffer.includes('"status":')) {
        try {
          const match = buffer.match(/data: (\{.*\})/);
          if (match) {
            const data = JSON.parse(match[1]);
            onDone?.({
              status: data.status || "complete",
              exitCode: data.exitCode,
            });
          }
        } catch { /* ignore */ }
      }

      onDone?.({ status: "complete" });
    } catch (err) {
      if (err.name === "AbortError") return;
      onError?.(err);
    }
  })();

  return () => controller.abort();
}

/**
 * High-level convenience: Send a chat message to the orchestrator and get streaming output.
 * This is the primary API that AgentPanel should use.
 *
 * @param {string} message - User's chat message / task
 * @param {string} workspaceId - Active workspace UUID
 * @param {string} [model] - Model ID to use
 * @param {string} [provider] - Provider source (lmstudio, openai, deepseek, anthropic, ollama)
 * @param {object} callbacks
 * @param {(line: string) => void} callbacks.onOutput - Called for each output line
 * @param {(result: object) => void} callbacks.onComplete - Called when job finishes
 * @param {(error: Error) => void} callbacks.onError - Called on error
 * @returns {{ jobId: string, abort: () => void }}
 */
export async function sendMessage(message, workspaceId, model, provider, { onOutput, onComplete, onError, mode }) {
  const { jobId } = await startJob(message, workspaceId, model, provider, mode);
  const abort = tailJob(jobId, {
    onLine: onOutput,
    onDone: (result) => onComplete?.({ jobId, ...result }),
    onError,
  });

  return { jobId, abort };
}
