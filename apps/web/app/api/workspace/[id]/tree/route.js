// @aurora/api/workspace/[id]/tree - Get file tree of a workspace

import { NextResponse } from 'next/server';
import { validateWorkspace, walkDirectory } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';
import path from 'path';
import fs from 'fs';

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
    
    // Update last opened timestamp
    const metaPath = path.join(wsDir, '.aurora', 'workspace.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta.lastOpened = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      } catch {}
    }
    
    const url = new URL(request.url);
    const maxDepth = parseInt(url.searchParams.get('depth') || '4', 10);
    
    const tree = walkDirectory(wsDir, maxDepth);
    
    return NextResponse.json({ 
      workspaceId: id,
      rootPath: wsDir,
      tree 
    });
  } catch (error) {
    console.error('[workspace/tree] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to read file tree' } }, { status: 500 });
  }
}
