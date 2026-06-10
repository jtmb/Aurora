// @aurora/api/git/github-auth - Manage GitHub authentication token

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

function getGithubAuthPath() {
  return path.join(os.homedir(), '.aurora', 'github-auth.json');
}

function readAuth() {
  const authPath = getGithubAuthPath();
  if (!fs.existsSync(authPath)) return { token: null, username: null, avatar: null };
  try {
    return JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  } catch {
    return { token: null, username: null, avatar: null };
  }
}

export async function GET() {
  try {
    const auth = readAuth();
    
    if (!auth.token) {
      return NextResponse.json({ hasToken: false, username: null, avatar: null });
    }
    
    // Validate token by calling GitHub API
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${auth.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!res.ok) {
        // Token is invalid — clear it
        const authPath = getGithubAuthPath();
        if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
        return NextResponse.json({ hasToken: false, username: null, avatar: null });
      }
      
      const user = await res.json();
      return NextResponse.json({
        hasToken: true,
        username: user.login,
        avatar: user.avatar_url,
        name: user.name
      });
    } catch {
      // Network error — return cached info
      return NextResponse.json({
        hasToken: true,
        username: auth.username || null,
        avatar: auth.avatar || null,
        name: auth.name || null
      });
    }
  } catch (error) {
    console.error('[git/github-auth] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to check GitHub auth' } }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token } = body;
    
    if (!token || !token.trim()) {
      return NextResponse.json({ error: { message: 'Token is required' } }, { status: 400 });
    }
    
    // Validate token with GitHub API
    let username = null;
    let avatar = null;
    let name = null;
    
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token.trim()}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return NextResponse.json({
          error: { message: errData.message || 'Invalid GitHub token' }
        }, { status: 401 });
      }
      
      const user = await res.json();
      username = user.login;
      avatar = user.avatar_url;
      name = user.name;
    } catch (fetchErr) {
      return NextResponse.json({
        error: { message: 'Could not reach GitHub. Check your network.' }
      }, { status: 502 });
    }
    
    // Save token
    const authDir = path.join(os.homedir(), '.aurora');
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    
    fs.writeFileSync(getGithubAuthPath(), JSON.stringify({
      token: token.trim(),
      username,
      avatar,
      name,
      updatedAt: new Date().toISOString()
    }, null, 2));
    
    return NextResponse.json({
      success: true,
      username,
      avatar,
      name
    });
  } catch (error) {
    console.error('[git/github-auth] Error:', error.message);
    return NextResponse.json({ error: { message: `Failed to save GitHub auth: ${error.message}` } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const authPath = getGithubAuthPath();
    if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[git/github-auth] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to remove GitHub auth' } }, { status: 500 });
  }
}
