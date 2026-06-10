// @aurora/api/workspace/[id]/git/init - Initialize a git repository in a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
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
    
    // Check if already a git repo
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (isRepo) {
      return NextResponse.json({ error: { message: 'Already a git repository' } }, { status: 409 });
    }
    
    const body = await request.json().catch(() => ({}));
    const { defaultBranch = 'main' } = body;
    
    await git.init(['-b', defaultBranch]);
    
    // Ensure .aurora/ is in .gitignore so internal metadata never shows as git changes
    const gitignorePath = path.join(wsDir, '.gitignore');
    const existingGitignore = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : '';
    const gitignoreLines = existingGitignore.split('\n').map(l => l.trim());
    if (!gitignoreLines.includes('.aurora/') && !gitignoreLines.includes('.aurora')) {
      const newContent = existingGitignore
        ? (existingGitignore.endsWith('\n') ? existingGitignore : existingGitignore + '\n') + '.aurora/\n'
        : '.aurora/\n';
      fs.writeFileSync(gitignorePath, newContent);
    }
    
    // Stage any existing files for an initial commit
    await git.add('.').catch(() => {});
    
    // Check if there's anything to stage
    const status = await git.status();
    const hasFiles = status.files.length > 0;
    
    return NextResponse.json({
      success: true,
      branch: defaultBranch,
      hasFiles,
      message: hasFiles
        ? `Initialized git repository on branch '${defaultBranch}' with ${status.files.length} file(s)`
        : `Initialized empty git repository on branch '${defaultBranch}'`
    });
  } catch (error) {
    console.error('[workspace/git/init] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed to init git: ${error.message}` } }, { status: 500 });
  }
}
