// @aurora/api/workspace/[id]/checkpoint/create - Create a tagged checkpoint

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { createWorkspaceCheckpoint } from '../../../../../../lib/checkpoint-utils';

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { tag } = body;

    if (!tag || !tag.trim()) {
      return NextResponse.json({ error: { message: 'Tag is required' } }, { status: 400 });
    }

    const result = await createWorkspaceCheckpoint(wsDir, tag.trim());

    if (!result.success) {
      const status = result.error === 'Checkpoint git not initialized' ? 404 : 500;
      return NextResponse.json({ error: { message: result.error } }, { status });
    }

    return NextResponse.json({
      success: true,
      hash: result.hash || null,
      note: result.note || null
    });
  } catch (error) {
    console.error('[workspace/checkpoint/create] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed to create checkpoint: ${error.message}` } }, { status: 500 });
  }
}
