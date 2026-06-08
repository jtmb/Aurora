// @aurora/api/workspace/[id]/checkpoint/init - Initialize separate checkpoint git repo

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';
import { initWorkspaceCheckpoints } from '../../../../../../lib/checkpoint-utils';

export async function POST(request, { params }) {
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

    const result = await initWorkspaceCheckpoints(wsDir);

    if (!result.success) {
      return NextResponse.json({ error: { message: `Failed to init checkpoints: ${result.error}` } }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      initialHash: result.initialHash || null,
      message: 'Checkpoint repository initialized'
    });
  } catch (error) {
    console.error('[workspace/checkpoint/init] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed to init checkpoints: ${error.message}` } }, { status: 500 });
  }
}
