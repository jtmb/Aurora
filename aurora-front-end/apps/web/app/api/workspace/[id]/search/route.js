// @aurora/api/workspace/[id]/search - Search files in a workspace (grep-like)

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { validateWorkspace, resolveSafePath } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '__pycache__', '.DS_Store',
  'dist', 'build', '.turbo', '.cache', 'coverage', '.nyc_output'
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.avi', '.mov', '.webm',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib',
]);

function searchInFile(filePath, query, workspaceRoot) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const results = [];
    
    const lowerQuery = query.toLowerCase();
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerQuery)) {
        results.push({
          path: path.relative(workspaceRoot, filePath),
          line: i + 1,
          content: lines[i].trim().slice(0, 200) // truncate long lines
        });
      }
    }
    
    return results;
  } catch {
    return [];
  }
}

function walkAndSearch(dirPath, query, workspaceRoot, maxResults = 100) {
  const results = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        results.push(...walkAndSearch(fullPath, query, workspaceRoot, maxResults - results.length));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTS.has(ext)) continue;
        
        // Skip files larger than 500KB for search
        const stat = fs.statSync(fullPath);
        if (stat.size > 500 * 1024) continue;
        
        const matches = searchInFile(fullPath, query, workspaceRoot);
        results.push(...matches);
      }
    }
  } catch {}
  
  return results.slice(0, maxResults);
}

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
    
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const targetPath = url.searchParams.get('path') || '';
    const maxResults = parseInt(url.searchParams.get('limit') || '50', 10);
    
    if (!query || !query.trim()) {
      return NextResponse.json({ error: { message: 'Search query is required' } }, { status: 400 });
    }
    
    let searchDir = wsDir;
    if (targetPath) {
      const resolved = resolveSafePath(wsDir, targetPath);
      if (!resolved) {
        return NextResponse.json({ error: { message: 'Invalid search path' } }, { status: 403 });
      }
      searchDir = resolved;
    }
    
    if (!fs.existsSync(searchDir)) {
      return NextResponse.json({ results: [], query: query.trim() });
    }
    
    const stat = fs.statSync(searchDir);
    if (stat.isFile()) {
      const matches = searchInFile(searchDir, query.trim(), wsDir);
      return NextResponse.json({ results: matches, query: query.trim() });
    }
    
    const results = walkAndSearch(searchDir, query.trim(), wsDir, maxResults);
    
    return NextResponse.json({ results, query: query.trim(), totalFound: results.length });
  } catch (error) {
    console.error('[workspace/search] Error:', error.message);
    return NextResponse.json({ error: { message: 'Search failed' } }, { status: 500 });
  }
}
