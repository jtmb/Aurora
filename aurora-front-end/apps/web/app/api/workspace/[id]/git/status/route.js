// @aurora/api/workspace/[id]/git/status - Git status for workspace

import { NextResponse } from 'next/server';
import { simpleGit } from 'simple-git';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
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
    
    // Check if it's a git repo
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return NextResponse.json({ 
        isGitRepo: false,
        message: 'Not a git repository' 
      });
    }
    
    const status = await git.status();
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'main');
    
    // Get branch tracking info
    let ahead = 0, behind = 0;
    const statusStr = await git.raw(['status', '--porcelain', '--branch']).catch(() => '');
    const aheadMatch = statusStr.match(/\[ahead\s+(\d+)/);
    const behindMatch = statusStr.match(/\[behind\s+(\d+)/);
    if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
    if (behindMatch) behind = parseInt(behindMatch[1], 10);
    
    // Get recent commits
    const log = await git.log({ maxCount: 5 }).catch(() => ({ all: [] }));
    
    return NextResponse.json({
      isGitRepo: true,
      branch: branch.trim(),
      ahead,
      behind,
      files: (status.files || [])
        .filter(f => !f.path.startsWith('.aurora/'))
        .map(f => ({
          path: f.path,
          index: f.index,
          workingDir: f.working_dir
        })),
      modified: (status.modified || []).filter(f => !f.startsWith('.aurora/')),
      created: (status.created || []).filter(f => !f.startsWith('.aurora/')),
      deleted: (status.deleted || []).filter(f => !f.startsWith('.aurora/')),
      staged: (status.staged || []).filter(f => !f.startsWith('.aurora/')),
      recentCommits: log.all.slice(0, 5).map(c => ({
        hash: c.hash?.slice(0, 7),
        message: c.message,
        author: c.author_name,
        date: c.date
      }))
    });
  } catch (error) {
    console.error('[workspace/git/status] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to get git status' } }, { status: 500 });
  }
}
