// @aurora/api/workspace/[id]/agent/run - Start or cancel a server-side agent job

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { startAgentJob, cancelWorkspaceJobs } from '../../../../../../lib/agent-runner';

/**
 * POST — Start an agent job that runs asynchronously on the server.
 * The job persists its state to the DB and the UI polls for updates.
 *
 * Body: {
 *   chatId: string (required),
 *   userContent: string (required),
 *   model: string,
 *   provider: string,
 *   thinkingEffort: 'low' | 'medium' | 'high',
 *   agentMode: 'plan' | 'agent',
 *   systemPrompt: string (optional — falls back to default if omitted)
 * }
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { chatId, userContent, userMessageId, model, provider, thinkingEffort, agentMode, systemPrompt, apiKeys, trimAfterMessageId } = body;

    if (!chatId || !userContent) {
      return NextResponse.json({ error: { message: 'chatId and userContent are required' } }, { status: 400 });
    }

    const jobId = startAgentJob({
      workspaceId: id,
      chatId,
      userContent,
      userMessageId: userMessageId || null,
      model: model || 'deepseek-v4-flash',
      provider: provider || 'deepseek',
      thinkingEffort: thinkingEffort || 'high',
      agentMode: agentMode || 'agent',
      systemPrompt: systemPrompt || '',
      apiKeys: apiKeys || {},
      trimAfterMessageId: trimAfterMessageId || null,
    });

    return NextResponse.json({ jobId, status: 'started' }, { status: 201 });
  } catch (error) {
    console.error('[agent/run] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to start agent job' } }, { status: 500 });
  }
}

/**
 * DELETE — Cancel all running/interrupted agent jobs for a workspace.
 */
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const cancelled = cancelWorkspaceJobs(id);
    return NextResponse.json({ cancelled, status: 'ok' });
  } catch (error) {
    console.error('[agent/run] DELETE Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to cancel agent jobs' } }, { status: 500 });
  }
}
