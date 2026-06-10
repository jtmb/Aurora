// @aurora/api/onlyoffice/document — Serve raw .docx/.xlsx/.pptx files to OnlyOffice
// OnlyOffice fetches the document from this URL when opening an editor.

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { validateWorkspace, resolveSafePath } from '../../../../lib/workspace-utils';

const MIME_TYPES = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const filePath = url.searchParams.get('filePath');

    if (!workspaceId || !filePath) {
      return NextResponse.json({ error: { message: 'Missing workspaceId or filePath' } }, { status: 400 });
    }

    // Validate workspace exists
    const wsDir = validateWorkspace(workspaceId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const safePath = resolveSafePath(wsDir, filePath);
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 400 });
    }

    if (!fs.existsSync(safePath)) {
      return NextResponse.json({ error: { message: 'File not found' } }, { status: 404 });
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(safePath);
    const buffer = fs.readFileSync(safePath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${path.basename(safePath)}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[onlyoffice/document] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to serve document' } }, { status: 500 });
  }
}
