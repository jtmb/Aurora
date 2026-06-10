// @aurora/api/workspace/[id]/upload - Upload document files (.docx, .xlsx, .pptx) to workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getWorkspaceDir, resolveSafePath } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';

const ALLOWED_EXTENSIONS = ['.docx', '.xlsx', '.pptx'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const wsDir = getWorkspaceDir(id);
    if (!fs.existsSync(wsDir)) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: { message: 'No file provided' } }, { status: 400 });
    }

    const fileName = file.name;
    const ext = path.extname(fileName).toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: { message: `Unsupported file type: ${ext}. Only .docx, .xlsx, and .pptx are allowed.` } },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: { message: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` } },
        { status: 413 }
      );
    }

    const safePath = resolveSafePath(wsDir, fileName);
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 403 });
    }

    // Write the file
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(safePath, buffer);

    return NextResponse.json({
      success: true,
      file: {
        path: fileName,
        name: fileName,
        type: ext.slice(1), // 'docx' or 'xlsx'
        size: file.size,
      },
    });
  } catch (err) {
    console.error('[upload] Error:', err);
    return NextResponse.json(
      { error: { message: 'Failed to upload file', details: err.message } },
      { status: 500 }
    );
  }
}
