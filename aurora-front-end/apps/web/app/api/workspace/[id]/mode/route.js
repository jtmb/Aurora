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
    const { codeMode, workspaceType } = body;

    // At least one of codeMode or workspaceType must be provided
    if (!codeMode && !workspaceType) {
      return NextResponse.json(
        { error: { message: 'codeMode or workspaceType is required' } },
        { status: 400 }
      );
    }

    if (codeMode && !['full', 'vibe'].includes(codeMode)) {
      return NextResponse.json(
        { error: { message: 'codeMode must be "full" or "vibe"' } },
        { status: 400 }
      );
    }

    if (workspaceType && !['code', 'documents'].includes(workspaceType)) {
      return NextResponse.json(
        { error: { message: 'workspaceType must be "code" or "documents"' } },
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
    if (codeMode) metadata.codeMode = codeMode;
    if (workspaceType) metadata.workspaceType = workspaceType;
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return NextResponse.json({
      id,
      ...(codeMode && { codeMode }),
      ...(workspaceType && { workspaceType }),
      message: [codeMode && `Switched to ${codeMode} mode`, workspaceType && `Workspace type set to ${workspaceType}`].filter(Boolean).join(', ')
    });
  } catch (error) {
    console.error('[workspace/mode] Error:', error.message);
    return NextResponse.json(
      { error: { message: 'Failed to update workspace mode' } },
      { status: 500 }
    );
  }
}
