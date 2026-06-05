// @aurora/api/workspace/[id]/git/commit - Stage and commit changes

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
    const { message, files } = body;
    
    if (!message || !message.trim()) {
      return NextResponse.json({ error: { message: 'Commit message is required' } }, { status: 400 });
    }
    
    // Stage files
    if (files && Array.isArray(files) && files.length > 0) {
      for (const file of files) {
        const safePath = resolveSafePath(wsDir, file);
        if (safePath) {
          await git.add(file).catch(() => {});
        }
      }
    } else {
      // Stage all changes
      await git.add('.').catch(() => {});
    }
    
    // Check if there's anything to commit
    const status = await git.status();
    if (status.staged.length === 0 && status.created.length === 0 && status.deleted.length === 0) {
      return NextResponse.json({ error: { message: 'No changes to commit' } }, { status: 400 });
    }
    
    const commitResult = await git.commit(message.trim());
    
    return NextResponse.json({
      success: true,
      commit: {
        hash: commitResult.commit?.slice(0, 7) || 'unknown',
        message: message.trim(),
        summary: commitResult.summary || ''
      }
    });
  } catch (error) {
    console.error('[workspace/git/commit] Error:', error.message);
    return NextResponse.json({ error: { message: `Commit failed: ${error.message}` } }, { status: 500 });
  }
}
