// @aurora/api/workspace/[id]/git/branches - List, create, and switch branches

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
    
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return NextResponse.json({ error: { message: 'Not a git repository' } }, { status: 400 });
    }
    
    const branchSummary = await git.branch();
    const current = branchSummary.current;
    
    // Get branches with tracking info
    const branches = Object.entries(branchSummary.branches).map(([name, info]) => ({
      name,
      current: name === current,
      commit: info.commit?.slice(0, 7) || '',
      label: info.label || ''
    }));
    
    return NextResponse.json({
      current,
      branches
    });
  } catch (error) {
    console.error('[workspace/git/branches] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to list branches' } }, { status: 500 });
  }
}

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
    const { action, branchName, newBranchName } = body;
    
    switch (action) {
      case 'switch': {
        if (!branchName) {
          return NextResponse.json({ error: { message: 'Branch name required' } }, { status: 400 });
        }
        await git.checkout(branchName);
        return NextResponse.json({ success: true, action: 'switch', branch: branchName });
      }
      
      case 'create': {
        if (!newBranchName) {
          return NextResponse.json({ error: { message: 'New branch name required' } }, { status: 400 });
        }
        await git.checkoutLocalBranch(newBranchName);
        return NextResponse.json({ success: true, action: 'create', branch: newBranchName });
      }
      
      default:
        return NextResponse.json({ error: { message: 'Invalid action. Use "switch" or "create"' } }, { status: 400 });
    }
  } catch (error) {
    console.error('[workspace/git/branches] Error:', error.message);
    return NextResponse.json({ error: { message: `Branch operation failed: ${error.message}` } }, { status: 500 });
  }
}
