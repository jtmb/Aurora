// @aurora/api/workspace/[id]/write - Write file content to a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { validateWorkspace, resolveSafePath } from '../../../../../lib/workspace-utils';

export async function POST(request, { params }) {
  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB write limit

  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    const body = await request.json().catch(() => ({}));
    const { path: filePath, content } = body;
    
    if (!filePath) {
      return NextResponse.json({ error: { message: 'File path is required' } }, { status: 400 });
    }
    
    if (content === undefined || content === null) {
      return NextResponse.json({ error: { message: 'Content is required' } }, { status: 400 });
    }
    
    if (content.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: { message: `Content too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` } }, { status: 413 });
    }
    
    const safePath = resolveSafePath(wsDir, filePath);
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 403 });
    }
    
    // Ensure parent directory exists
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    // Check if existing file is a directory
    if (fs.existsSync(safePath) && fs.statSync(safePath).isDirectory()) {
      return NextResponse.json({ error: { message: 'Cannot overwrite a directory with a file' } }, { status: 400 });
    }
    
    const wasCreated = !fs.existsSync(safePath);
    fs.writeFileSync(safePath, content, 'utf-8');
    
    const stat = fs.statSync(safePath);
    
    return NextResponse.json({
      success: true,
      path: filePath,
      absolutePath: safePath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      created: wasCreated
    });
  } catch (error) {
    console.error('[workspace/write] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to write file' } }, { status: 500 });
  }
}
