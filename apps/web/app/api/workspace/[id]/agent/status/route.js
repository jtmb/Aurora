// @aurora/api/workspace/[id]/agent/status - Get current agent job status

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
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

    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const shouldResume = searchParams.get('resume') === 'true';

    // If auto-resume requested, try resuming interrupted jobs
    if (shouldResume) {
      resumeInterruptedJob(id);
    }

    const status = getJobStatus(id);

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
