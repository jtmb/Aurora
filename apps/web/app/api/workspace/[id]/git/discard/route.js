// @aurora/api/workspace/[id]/git/discard - Discard changes to a file

import { NextResponse } from 'next/server';
import { simpleGit } from 'simple-git';
import { validateWorkspace, resolveSafePath } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';

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
    
    const git = simpleGit(wsDir);
    
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return NextResponse.json({ error: { message: 'Not a git repository' } }, { status: 400 });
    }
    
    const body = await request.json().catch(() => ({}));
    const { file } = body;
    
    if (!file) {
      return NextResponse.json({ error: { message: 'file is required' } }, { status: 400 });
    }
    
    const safePath = resolveSafePath(wsDir, file);
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 403 });
    }
    
    // Get file status to determine how to discard
    const status = await git.status();
    const fileStatus = status.files.find(f => f.path === file);
    
    if (!fileStatus) {
      return NextResponse.json({ error: { message: 'File not found in status' } }, { status: 404 });
    }
    
    const wd = fileStatus.working_dir || ' ';
    const idx = fileStatus.index || ' ';
    
    // Untracked file: remove it
    if (wd === '?' && idx === '?') {
      await git.raw(['clean', '-f', '--', file]);
    }
    // Staged change: unstage first, then checkout
    else if (idx !== ' ' && idx !== '?') {
      await git.reset(['--', file]);
      await git.checkout(['--', file]);
    }
    // Working directory change only: checkout to discard
    else if (wd !== ' ' && wd !== '?') {
      await git.checkout(['--', file]);
    }
    // Deleted file: restore
    else if (wd === 'D') {
      await git.checkout(['--', file]);
    }
    
    return NextResponse.json({ success: true, file });
  } catch (error) {
    console.error('[workspace/git/discard] Error:', error.message);
    return NextResponse.json({ error: { message: `Discard failed: ${error.message}` } }, { status: 500 });
  }
}
