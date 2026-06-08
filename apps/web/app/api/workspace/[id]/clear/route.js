// @aurora/api/workspace/[id]/clear - Delete all files in a workspace

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';
import fs from 'fs';
import path from 'path';

/** Recursively delete a directory */
function rimraf(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      rimraf(full);
    } else {
      fs.unlinkSync(full);
    }
  }
  fs.rmdirSync(dirPath);
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

    if (!fs.existsSync(wsDir)) {
      return NextResponse.json({ error: { message: 'Workspace directory not found' } }, { status: 404 });
    }

    const deletedFiles = [];

    // Delete everything EXCEPT the .aurora metadata directory
    const entries = fs.readdirSync(wsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.aurora') continue; // preserve workspace metadata
      const full = path.join(wsDir, entry.name);
      if (entry.isDirectory()) {
        rimraf(full);
      } else {
        fs.unlinkSync(full);
      }
      deletedFiles.push(entry.name);
    }

    return NextResponse.json({
      success: true,
      message: `Cleared ${deletedFiles.length} item(s) from workspace`,
      deletedCount: deletedFiles.length,
      deleted: deletedFiles,
    });
  } catch (error) {
    console.error('[workspace/clear] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to clear workspace files' } }, { status: 500 });
  }
}
