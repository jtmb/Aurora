// @aurora/api/workspace/[id]/git/config - Get/set git config (user.name, user.email, remote)

import { NextResponse } from 'next/server';
import { simpleGit } from 'simple-git';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';

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
    
    // Read git config
    const config = await git.listConfig().catch(() => ({}));
    const all = config.all || {};
    
    // Get remote
    let remoteUrl = '';
    try {
      const remotes = await git.remote(['-v']);
      if (remotes) {
        const match = remotes.match(/origin\s+(\S+)\s+\(fetch\)/);
        if (match) remoteUrl = match[1];
      }
    } catch {}
    
    return NextResponse.json({
      userName: all['user.name'] || '',
      userEmail: all['user.email'] || '',
      remoteUrl
    });
  } catch (error) {
    console.error('[workspace/git/config] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to read git config' } }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
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
    const { userName, userEmail } = body;
    
    if (userName !== undefined) {
      await git.addConfig('user.name', userName.trim());
    }
    if (userEmail !== undefined) {
      await git.addConfig('user.email', userEmail.trim());
    }
    
    return NextResponse.json({
      success: true,
      userName: userName?.trim() || '',
      userEmail: userEmail?.trim() || ''
    });
  } catch (error) {
    console.error('[workspace/git/config] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed to update git config: ${error.message}` } }, { status: 500 });
  }
}
