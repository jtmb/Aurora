// @aurora/api/workspace/list - List user's workspaces (ownership-scoped, per-user dirs)

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getWorkspacesDir, getUserWorkspacesDir } from '../../../../lib/workspace-utils';
import { getUserId } from '../../../../lib/auth-utils';

export async function GET(request) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const userDir = getUserWorkspacesDir(userId);
    const workspaces = [];
    const seenIds = new Set();

    // Helper to build a workspace entry from a directory path
    const buildEntry = (wsPath, dirName) => {
      let metadata = {};
      const metaPath = path.join(wsPath, '.aurora', 'workspace.json');
      if (fs.existsSync(metaPath)) {
        try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
      }
      
      let lastOpened = metadata.lastOpened;
      const stat = fs.statSync(wsPath);
      
      // Detect primary language from key files
      let primaryLanguage = null;
      let files = [];
      try { files = fs.readdirSync(wsPath); } catch {}
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

      return {
        id: dirName,
        name: metadata.name || dirName,
        repoUrl: metadata.repoUrl || null,
        type: metadata.type || 'blank',
        codeMode: metadata.codeMode || 'full',
        workspaceType: metadata.workspaceType || 'code',
        primaryLanguage: primaryLanguage || metadata.primaryLanguage || null,
        createdAt: metadata.createdAt || stat.birthtime?.toISOString() || stat.mtime.toISOString(),
        lastOpened: lastOpened || null,
        isGitRepo: fs.existsSync(path.join(wsPath, '.git'))
      };
    };

    // 1. List workspaces in the user's per-user directory
    if (fs.existsSync(userDir)) {
      const entries = fs.readdirSync(userDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '.aurora') continue; // skip metadata dirs at user level
        
        const wsPath = path.join(userDir, entry.name);
        // Must have workspace metadata to be a workspace
        if (!fs.existsSync(path.join(wsPath, '.aurora', 'workspace.json'))) continue;
        
        workspaces.push(buildEntry(wsPath, entry.name));
        seenIds.add(entry.name);
      }
    }

    // 2. Fallback: scan flat workspace directory for legacy workspaces owned by this user
    //    Only include workspaces not already found in the per-user directory.
    const flatDir = getWorkspacesDir();
    if (fs.existsSync(flatDir)) {
      const flatEntries = fs.readdirSync(flatDir, { withFileTypes: true });
      
      for (const entry of flatEntries) {
        if (!entry.isDirectory()) continue;
        if (seenIds.has(entry.name)) continue; // Already in per-user dir
        
        const wsPath = path.join(flatDir, entry.name);
        const metaPath = path.join(wsPath, '.aurora', 'workspace.json');
        if (!fs.existsSync(metaPath)) continue; // Not a legacy workspace
        
        // Check ownership — only show if owned by this user
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.ownerId && meta.ownerId !== userId) continue; // Not owned by this user
        } catch { continue; }
        
        workspaces.push(buildEntry(wsPath, entry.name));
        seenIds.add(entry.name);
      }
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
