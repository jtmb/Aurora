// @aurora/api/workspace/[id]/git/diff - Git diff for workspace

import { NextResponse } from 'next/server';
import { simpleGit } from 'simple-git';
import { validateWorkspace, resolveSafePath } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';

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
    
    const git = simpleGit(wsDir);
    
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return NextResponse.json({ error: { message: 'Not a git repository' } }, { status: 400 });
    }
    
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    const staged = url.searchParams.get('staged') === 'true';
    
    const diffOptions = [];
    if (staged) diffOptions.push('--staged');
    if (filePath) {
      const safePath = resolveSafePath(wsDir, filePath);
      if (!safePath) {
        return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 403 });
      }
      diffOptions.push('--', filePath);
    }
    
    const diff = await git.diff(diffOptions).catch(() => '');
    
    return NextResponse.json({
      diff,
      filePath: filePath || null,
      staged
    });
  } catch (error) {
    console.error('[workspace/git/diff] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to get diff' } }, { status: 500 });
  }
}
