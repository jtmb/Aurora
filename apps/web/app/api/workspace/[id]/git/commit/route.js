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
    
    // Stage files. If no files provided, stage everything.
    if (files && Array.isArray(files) && files.length > 0) {
      // Files may already be staged — just ensure the index is up to date
      for (const file of files) {
        const safePath = resolveSafePath(wsDir, file);
        if (safePath) {
          await git.add(file).catch(() => {});
        }
      }
    }
    
    // Commit whatever is staged (after add, or whatever was already staged)
    const commitResult = await git.commit(message.trim()).catch(async (err) => {
      // If nothing was staged, try staging everything and commit
      if (err.message?.includes('nothing to commit') || err.message?.includes('nothing added to commit')) {
        await git.add('.').catch(() => {});
        const s2 = await git.status();
        if (s2.staged.length === 0 && s2.created.length === 0 && s2.deleted.length === 0) {
          throw new Error('No changes to commit');
        }
        return git.commit(message.trim());
      }
      throw err;
    });
    
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
