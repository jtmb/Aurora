// @aurora/api/workspace/[id]/git/github - Create GitHub repo, set remote, push

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { simpleGit } from 'simple-git';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';

function getGithubAuthPath() {
  return path.join(os.homedir(), '.aurora', 'github-auth.json');
}

function getGithubToken() {
  const authPath = getGithubAuthPath();
  if (!fs.existsSync(authPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    return data.token || null;
  } catch {
    return null;
  }
}

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
    
    const token = getGithubToken();
    if (!token) {
      return NextResponse.json({ error: { message: 'GitHub not connected. Authenticate first.' } }, { status: 401 });
    }
    
    const body = await request.json().catch(() => ({}));
    const { name, description = '', isPrivate = false } = body;
    
    if (!name || !name.trim()) {
      return NextResponse.json({ error: { message: 'Repository name is required' } }, { status: 400 });
    }
    
    // Create repo on GitHub
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        private: isPrivate,
        auto_init: false
      })
    });
    
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      return NextResponse.json({
        error: { message: errData.message || `GitHub API error: ${createRes.status}` }
      }, { status: createRes.status });
    }
    
    const repoData = await createRes.json();
    const cloneUrl = repoData.clone_url;
    const htmlUrl = repoData.html_url;
    
    // Add remote (remove existing origin if present)
    try {
      await git.remote(['remove', 'origin']);
    } catch {}
    await git.remote(['add', 'origin', cloneUrl]);
    
    // Push to GitHub
    let pushResult = '';
    try {
      pushResult = await git.push(['-u', 'origin', 'HEAD']);
    } catch (pushErr) {
      // Push failed but repo was created and remote is set
      return NextResponse.json({
        success: true,
        repoUrl: htmlUrl,
        cloneUrl,
        pushSuccess: false,
        pushError: pushErr.message,
        message: 'Repository created on GitHub but push failed. You can push manually.'
      });
    }
    
    return NextResponse.json({
      success: true,
      repoUrl: htmlUrl,
      cloneUrl,
      pushSuccess: true,
      pushResult
    });
  } catch (error) {
    console.error('[workspace/git/github] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed: ${error.message}` } }, { status: 500 });
  }
}
