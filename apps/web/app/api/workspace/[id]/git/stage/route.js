// @aurora/api/workspace/[id]/git/stage - Stage or unstage individual files

import { NextResponse } from 'next/server';
import { simpleGit } from 'simple-git';
import { validateWorkspace, resolveSafePath } from '../../../../../../lib/workspace-utils';

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    const git = simpleGit(wsDir);
    
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return NextResponse.json({ error: { message: 'Not a git repository' } }, { status: 400 });
    }
    
    const body = await request.json().catch(() => ({}));
    const { action, file } = body;
    
    if (!action || !file) {
      return NextResponse.json({ error: { message: 'action and file are required' } }, { status: 400 });
    }
    
    const safePath = resolveSafePath(wsDir, file);
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 403 });
    }
    
    switch (action) {
      case 'stage':
        await git.add(file);
        break;
      case 'unstage':
        await git.reset(['--', file]);
        break;
      default:
        return NextResponse.json({ error: { message: 'Invalid action. Use "stage" or "unstage"' } }, { status: 400 });
    }
    
    return NextResponse.json({ success: true, action, file });
  } catch (error) {
    console.error('[workspace/git/stage] Error:', error.message);
    return NextResponse.json({ error: { message: `Stage operation failed: ${error.message}` } }, { status: 500 });
  }
}
