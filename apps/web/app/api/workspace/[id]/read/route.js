// @aurora/api/workspace/[id]/read - Read file content from a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import { validateWorkspace, resolveSafePath, getFileLanguage } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';

export async function POST(request, { params }) {
  const MAX_FILE_SIZE = 1024 * 1024; // 1MB

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
    
    const body = await request.json().catch(() => ({}));
    const { path: filePath } = body;
    
    if (!filePath) {
      return NextResponse.json({ error: { message: 'File path is required' } }, { status: 400 });
    }
    
    const safePath = resolveSafePath(wsDir, filePath);
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 403 });
    }
    
    if (!fs.existsSync(safePath)) {
      return NextResponse.json({ error: { message: 'File not found' } }, { status: 404 });
    }
    
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: { message: 'Path is a directory, not a file' } }, { status: 400 });
    }
    
    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: { message: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)` } }, { status: 413 });
    }
    
    const content = fs.readFileSync(safePath, 'utf-8');
    const language = getFileLanguage(safePath);
    
    return NextResponse.json({
      path: filePath,
      absolutePath: safePath,
      content,
      language,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  } catch (error) {
    console.error('[workspace/read] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to read file' } }, { status: 500 });
  }
}
