// @aurora/api/workspace/[id]/agent/status - Get current agent job status

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';
import { getJobStatus, resumeInterruptedJob } from '../../../../../../lib/agent-runner';

/**
 * GET — Return the current agent job status for this workspace.
 * If an interrupted job exists, try to resume it.
 *
 * Query params:
 *   ?resume=true — if set, auto-resume interrupted jobs before returning status
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }
    
    const wsDir = validateWorkspace(id, userId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const shouldResume = searchParams.get('resume') === 'true';
    const specificJobId = searchParams.get('jobId') || null;

    // If auto-resume requested, try resuming interrupted jobs
    // (only if no specific jobId — resume only makes sense for latest)
    if (shouldResume && !specificJobId) {
      resumeInterruptedJob(id);
    }

    const status = getJobStatus(id, specificJobId);

    if (!status) {
      return NextResponse.json({ active: false });
    }

    return NextResponse.json({
      active: true,
      ...status,
    });
  } catch (error) {
    console.error('[agent/status] Error:', error.message);
    return NextResponse.json({ active: false, error: error.message });
  }
}
