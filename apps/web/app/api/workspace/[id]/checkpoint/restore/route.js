// @aurora/api/workspace/[id]/checkpoint/restore - Restore workspace to a checkpoint tag

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';
import { restoreWorkspaceCheckpoint } from '../../../../../../lib/checkpoint-utils';

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

    const body = await request.json().catch(() => ({}));
    const { tag } = body;

    if (!tag || !tag.trim()) {
      return NextResponse.json({ error: { message: 'Tag is required' } }, { status: 400 });
    }

    const result = await restoreWorkspaceCheckpoint(wsDir, tag.trim());

    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : 500;
      return NextResponse.json({ error: { message: result.error } }, { status });
    }

    return NextResponse.json({ success: true, message: `Restored to checkpoint "${tag.trim()}"` });
  } catch (error) {
    console.error('[workspace/checkpoint/restore] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed to restore checkpoint: ${error.message}` } }, { status: 500 });
  }
}
