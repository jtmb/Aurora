// @aurora/api/onlyoffice/config — Generate JWT-signed OnlyOffice editor config
// Called by the frontend before rendering the iframe to get the editor configuration.

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateWorkspace, resolveSafePath } from '../../../../lib/workspace-utils';
import { getUserId } from '../../../../lib/auth-utils';

const JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || 'aurora-onlyoffice-secret-change-me';
const DS_URL = process.env.ONLYOFFICE_DS_URL || 'http://localhost:8082';

const FILE_TYPE_MAP = {
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
};

function createToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

function hash(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 20);
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const filePath = url.searchParams.get('filePath');
    const mode = url.searchParams.get('mode') || 'edit';

    if (!workspaceId || !filePath) {
      return NextResponse.json({ error: { message: 'Missing workspaceId or filePath' } }, { status: 400 });
    }

    // Validate workspace access
    const userId = getUserId(request);
    const wsDir = validateWorkspace(workspaceId, userId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const safePath = resolveSafePath(wsDir, filePath);
    if (!safePath || !fs.existsSync(safePath)) {
      return NextResponse.json({ error: { message: 'File not found' } }, { status: 404 });
    }

    const ext = path.extname(safePath).toLowerCase();
    const fileType = FILE_TYPE_MAP[ext];
    if (!fileType) {
      return NextResponse.json({ error: { message: `Unsupported file type: ${ext}` } }, { status: 400 });
    }

    const fileName = path.basename(safePath);
    const stat = fs.statSync(safePath);
    const fileKey = hash(`${workspaceId}/${filePath}/${stat.mtimeMs}`);

    // Build the document serving URL (no token needed — DS JWT is disabled)
    const documentUrl = `/api/onlyoffice/document?workspaceId=${encodeURIComponent(workspaceId)}&filePath=${encodeURIComponent(filePath)}`;

    // Build the callback URL with workspace params
    const callbackUrl = `/api/onlyoffice/callback?workspaceId=${encodeURIComponent(workspaceId)}&filePath=${encodeURIComponent(filePath)}`;

    // DS-internal URL: with network_mode: host, the DS shares the host network,
    // so localhost:3000 reaches the Next.js server directly — no Docker networking needed.
    const appInternalOrigin = process.env.APP_INTERNAL_URL || 'http://localhost:3000';

    // ── Build editor config ──
    const config = {
      document: {
        fileType: fileType,
        key: fileKey,
        title: fileName,
        url: `${appInternalOrigin}${documentUrl}`,
        permissions: {
          comment: true,
          download: true,
          edit: mode === 'edit',
          fillForms: true,
          modifyFilter: true,
          modifyContentControl: true,
          print: true,
          review: true,
          chat: false,
        },
      },
      documentType: fileType === 'docx' ? 'word' : fileType === 'xlsx' ? 'cell' : 'slide',
      height: '100%',
      width: '100%',
      type: 'desktop',
      editorConfig: {
        callbackUrl: `${appInternalOrigin}${callbackUrl}`,
        mode: mode,
        lang: 'en',
        customization: {
          uiTheme: 'dark',
          compactHeader: true,
          compactToolbar: false,
          feedback: {
            visible: false,
          },
          forcesave: true,
          hideRightMenu: false,
          toolbarNoTabs: false,
        },
        user: {
          id: userId || 'anonymous',
          name: userId || 'User',
        },
      },
    };

    // Sign the entire config (used when DS JWT is enabled)
    // const signedToken = createToken(config);
    // config.token = signedToken;

    return NextResponse.json(config, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[onlyoffice/config] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to generate config' } }, { status: 500 });
  }
}
