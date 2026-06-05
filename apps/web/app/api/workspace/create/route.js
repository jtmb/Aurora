// @aurora/api/workspace/create - Create or clone a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';
import { getWorkspaceDir, ensureWorkspacesDir } from '../../../../lib/workspace-utils';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { name, repoUrl, type = 'blank', codeMode = 'full' } = body;
    
    if (!name || !name.trim()) {
      return NextResponse.json({ error: { message: 'Workspace name is required' } }, { status: 400 });
    }
    
    // Sanitize name for filesystem
    const safeName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').toLowerCase();
    if (!safeName) {
      return NextResponse.json({ error: { message: 'Invalid workspace name' } }, { status: 400 });
    }
    
    ensureWorkspacesDir();
    const wsDir = getWorkspaceDir(safeName);
    
    // Check if workspace already exists
    if (fs.existsSync(wsDir)) {
      return NextResponse.json({ error: { message: 'Workspace already exists' } }, { status: 409 });
    }
    
    const createdAt = new Date().toISOString();
    let cloneSuccess = false;
    
    if (repoUrl && type === 'git') {
      // Clone the repository
      try {
        const git = simpleGit();
        await git.clone(repoUrl, wsDir, ['--depth', '1']);
        cloneSuccess = true;
      } catch (gitErr) {
        console.error('[workspace/create] Git clone error:', gitErr.message);
        // Clean up partial clone
        if (fs.existsSync(wsDir)) {
          fs.rmSync(wsDir, { recursive: true, force: true });
        }
        return NextResponse.json({ error: { message: `Failed to clone repository: ${gitErr.message}` } }, { status: 500 });
      }
    } else {
      // Create blank workspace directory
      fs.mkdirSync(wsDir, { recursive: true });
    }
    
    // Write metadata
    const metadata = {
      name: name.trim(),
      repoUrl: repoUrl || null,
      type: type || 'blank',
      codeMode: codeMode || 'full',
      createdAt,
      lastOpened: createdAt
    };
    
    fs.writeFileSync(path.join(wsDir, '.aurora-workspace.json'), JSON.stringify(metadata, null, 2));
    
    return NextResponse.json({
      id: safeName,
      ...metadata,
      isGitRepo: cloneSuccess || (repoUrl ? true : false)
    }, { status: 201 });
    
  } catch (error) {
    console.error('[workspace/create] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to create workspace' } }, { status: 500 });
  }
}
