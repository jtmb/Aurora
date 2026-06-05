// @aurora/api/workspace/list - List all workspaces

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getWorkspacesDir, ensureWorkspacesDir } from '../../../../lib/workspace-utils';

export async function GET() {
  try {
    const dir = ensureWorkspacesDir();
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const workspaces = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsPath = path.join(dir, entry.name);
      
      // Read metadata if available
      let metadata = {};
      const metaPath = path.join(wsPath, '.aurora-workspace.json');
      if (fs.existsSync(metaPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        } catch {}
      }
      
      // Get last modified time from git config or directory
      let lastOpened = metadata.lastOpened;
      const stat = fs.statSync(wsPath);
      
      workspaces.push({
        id: entry.name,
        name: metadata.name || entry.name,
        repoUrl: metadata.repoUrl || null,
        type: metadata.type || 'blank',
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
