// @aurora/api/workspace/[id]/checkpoint/reset - Reset workspace to clean blank state

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';
import { resetWorkspaceToClean } from '../../../../../../lib/checkpoint-utils';

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

    const result = await resetWorkspaceToClean(wsDir);

    if (!result.success) {
      return NextResponse.json({ error: { message: result.error } }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Workspace reset to clean state' });
  } catch (error) {
    console.error('[workspace/checkpoint/reset] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed to reset workspace: ${error.message}` } }, { status: 500 });
  }
}