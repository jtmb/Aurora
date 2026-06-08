// @aurora/api/workspace/[id]/checkpoint/list - List all checkpoints for a workspace

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';
import { listWorkspaceCheckpoints } from '../../../../../../lib/checkpoint-utils';

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

    const result = await listWorkspaceCheckpoints(wsDir);

    if (!result.success) {
      return NextResponse.json(
        { error: { message: result.error } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      checkpoints: result.checkpoints || [],
      totalCount: result.checkpoints?.length || 0
    });
  } catch (error) {
    console.error('[workspace/checkpoint/list] Error:', error.message);
    return NextResponse.json(
      { error: { message: `Failed to list checkpoints: ${error.message}` } },
      { status: 500 }
    );
  }
}
