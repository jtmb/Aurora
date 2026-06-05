// @aurora/api/workspace/[id]/git/status - Git status for workspace

import { NextResponse } from 'next/server';
import { simpleGit } from 'simple-git';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
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
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'unknown');
    
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
      files: status.files.map(f => ({
        path: f.path,
        index: f.index,      // staged status
        workingDir: f.working_dir  // unstaged status
      })),
      modified: status.modified || [],
      created: status.created || [],
      deleted: status.deleted || [],
      staged: status.staged || [],
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
