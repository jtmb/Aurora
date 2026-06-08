// @aurora/api/workspace/list - List user's workspaces (ownership-scoped)

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getWorkspacesDir, ensureWorkspacesDir } from '../../../../lib/workspace-utils';
import { getUserId } from '../../../../lib/auth-utils';

export async function GET(request) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const dir = ensureWorkspacesDir();
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const workspaces = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsPath = path.join(dir, entry.name);
      
      // Read metadata if available (check ownership)
      let metadata = {};
      const metaPath = path.join(wsPath, '.aurora', 'workspace.json');
      if (fs.existsSync(metaPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        } catch {}
      }
      
      // Skip workspaces owned by a different user
      if (metadata.ownerId && metadata.ownerId !== userId) continue;
      
      // Get last modified time from git config or directory
      let lastOpened = metadata.lastOpened;
      const stat = fs.statSync(wsPath);
      
      // Detect primary language from key files
      const files = fs.readdirSync(wsPath);
      let primaryLanguage = null;
      if (files.includes('package.json')) {
        primaryLanguage = fs.existsSync(path.join(wsPath, 'tsconfig.json')) ? 'typescript' : 'javascript';
      } else if (files.includes('pyproject.toml') || files.includes('requirements.txt') || files.includes('setup.py') || files.includes('Pipfile')) {
        primaryLanguage = 'python';
      } else if (files.includes('Cargo.toml')) {
        primaryLanguage = 'rust';
      } else if (files.includes('go.mod')) {
        primaryLanguage = 'go';
      } else if (files.includes('Gemfile')) {
        primaryLanguage = 'ruby';
      } else if (files.includes('pom.xml') || files.includes('build.gradle') || files.includes('build.gradle.kts')) {
        primaryLanguage = 'java';
      } else if (files.includes('CMakeLists.txt') || files.filter(f => f.endsWith('.c')).length > 0) {
        primaryLanguage = 'c';
      } else if (files.filter(f => f.endsWith('.cpp') || f.endsWith('.cc') || f.endsWith('.cxx')).length > 0) {
        primaryLanguage = 'cpp';
      } else if (files.includes('composer.json')) {
        primaryLanguage = 'php';
      } else if (files.includes('Dockerfile')) {
        primaryLanguage = 'docker';
      } else if (files.filter(f => f.endsWith('.html') || f.endsWith('.htm')).length > 0) {
        primaryLanguage = 'html';
      }

      workspaces.push({
        id: entry.name,
        name: metadata.name || entry.name,
        repoUrl: metadata.repoUrl || null,
        type: metadata.type || 'blank',
        codeMode: metadata.codeMode || 'full',
        primaryLanguage: primaryLanguage || metadata.primaryLanguage || null,
        createdAt: metadata.createdAt || stat.birthtime?.toISOString() || stat.mtime.toISOString(),
        lastOpened: lastOpened || null,
        isGitRepo: fs.existsSync(path.join(wsPath, '.git'))
      });
    }
    
    // Sort by lastOpened desc, then name
    workspaces.sort((a, b) => {
      if (a.lastOpened && b.lastOpened) return b.lastOpened.localeCompare(a.lastOpened);
      if (a.lastOpened) return -1;
      if (b.lastOpened) return 1;
      return a.name.localeCompare(b.name);
    });
    
    return NextResponse.json({ workspaces });
  } catch (error) {
    console.error('[workspace/list] Error:', error.message);
    return NextResponse.json({ workspaces: [], error: error.message });
  }
}
