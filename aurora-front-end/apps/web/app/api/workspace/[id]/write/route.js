// @aurora/api/workspace/[id]/write - Write file content to a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { validateWorkspace, resolveSafePath } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';

export async function POST(request, { params }) {
  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB write limit

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
    const oldContent = wasCreated ? '' : fs.readFileSync(safePath, 'utf-8');
    fs.writeFileSync(safePath, content, 'utf-8');
    
    const stat = fs.statSync(safePath);
    const newLines = content.split('\n').length;
    const oldLines = wasCreated ? 0 : oldContent.split('\n').length;
    const linesAdded = newLines - oldLines;

    return NextResponse.json({
      success: true,
      path: filePath,
      absolutePath: safePath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      created: wasCreated,
      linesAdded,
      linesRemoved: oldLines - newLines > 0 ? oldLines - newLines : 0,
      totalLines: newLines
    });
  } catch (error) {
    console.error('[workspace/write] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to write file' } }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
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
      // Use recursive rmSync for directories
      fs.rmSync(safePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safePath);
    }
    
    return NextResponse.json({
      success: true,
      path: filePath,
      deleted: true
    });
  } catch (error) {
    console.error('[workspace/write DELETE] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to delete file' } }, { status: 500 });
  }
}
