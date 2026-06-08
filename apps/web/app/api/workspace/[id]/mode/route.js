// @aurora/api/workspace/[id]/mode - Toggle workspace code mode (full / vibe)

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }
    
    const body = await request.json().catch(() => ({}));
    const { codeMode } = body;

    if (!codeMode || !['full', 'vibe'].includes(codeMode)) {
      return NextResponse.json(
        { error: { message: 'codeMode must be "full" or "vibe"' } },
        { status: 400 }
      );
    }

    const wsDir = validateWorkspace(id, userId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    const metaPath = path.join(wsDir, '.aurora', 'workspace.json');

    if (!fs.existsSync(metaPath)) {
      return NextResponse.json(
        { error: { message: 'Workspace not found' } },
        { status: 404 }
      );
    }

    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    metadata.codeMode = codeMode;
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return NextResponse.json({
      id,
      codeMode,
      message: `Switched to ${codeMode} mode`
    });
  } catch (error) {
    console.error('[workspace/mode] Error:', error.message);
    return NextResponse.json(
      { error: { message: 'Failed to update workspace mode' } },
      { status: 500 }
    );
  }
}
