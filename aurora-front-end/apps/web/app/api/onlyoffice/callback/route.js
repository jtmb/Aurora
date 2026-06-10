// @aurora/api/onlyoffice/callback — Handle OnlyOffice save notifications
// OnlyOffice POSTs here when a user saves (status 2/6) or an error occurs (status 3/4/7).

import { NextResponse } from 'next/server';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { validateWorkspace, resolveSafePath } from '../../../../lib/workspace-utils';

const JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || 'aurora-onlyoffice-secret-change-me';

/**
 * Verify JWT signature on callback body.
 * OnlyOffice signs the entire response body with the shared secret.
 */
function verifyCallbackJwt(token, body) {
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const headerB64 = parts[0];
    const payloadB64 = parts[1];
    const signatureB64 = parts[2];

    // Recreate signature
    const data = `${headerB64}.${payloadB64}`;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(data)
      .digest('base64url');

    if (expectedSig !== signatureB64) return false;

    // Decode payload and compare with body
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    // The body should match the payload (OnlyOffice signs the entire callback body)
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const payloadStr = JSON.stringify(payload);

    // Deep compare
    return JSON.stringify(sortKeys(payload)) === JSON.stringify(sortKeys(typeof body === 'string' ? JSON.parse(bodyStr) : body));
  } catch (e) {
    console.error('[onlyoffice/callback] JWT verification error:', e.message);
    return false;
  }
}

function sortKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted = {};
  Object.keys(obj).sort().forEach(k => {
    sorted[k] = sortKeys(obj[k]);
  });
  return sorted;
}

export async function POST(request) {
  try {
    // Read the raw body for JWT verification
    const rawBody = await request.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 1, message: 'Invalid JSON body' }, { status: 400 });
    }

    // ── JWT verification ──
    // JWT is disabled on DS (JWT_ENABLED=false), so we skip verification.
    // When JWT is off, DS sends callbacks without a token.
    const isJwtEnabled = process.env.ONLYOFFICE_JWT_ENABLED === 'true';

    if (isJwtEnabled) {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const bodyToken = body.token || '';
      const isValid = (token && verifyCallbackJwt(token, body)) ||
                      (bodyToken && verifyCallbackJwt(bodyToken, body));
      if (!isValid) {
        console.warn('[onlyoffice/callback] Invalid or missing JWT signature');
        return NextResponse.json({ error: 1, message: 'Invalid token' }, { status: 403 });
      }
    } else {
      console.log('[onlyoffice/callback] JWT disabled — skipping token verification');
    }

    // ── Extract workspace info from callback URL query params ──
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspaceId');
    const filePath = url.searchParams.get('filePath');

    if (!workspaceId || !filePath) {
      console.error('[onlyoffice/callback] Missing workspaceId or filePath in callback URL');
      return NextResponse.json({ error: 1, message: 'Missing workspace params' });
    }

    const wsDir = validateWorkspace(workspaceId);
    if (!wsDir) {
      console.error('[onlyoffice/callback] Workspace not found:', workspaceId);
      return NextResponse.json({ error: 1, message: 'Workspace not found' });
    }

    // ── Handle save based on status ──
    // 0 = no doc with key → ignore
    // 1 = document being edited → no action needed
    // 2 = document ready to save → download and write
    // 3 = document save error → log
    // 4 = document closed with no changes
    // 6 = force save (editing but save requested)
    // 7 = force save error
    const status = body.status;
    console.log('[onlyoffice/callback] Callback received:', { status, workspaceId, filePath, key: body.key });

    if (status === 1 || status === 4) {
      // Editing started or closed without changes — acknowledge
      return NextResponse.json({ error: 0 });
    }

    if (status === 2 || status === 6) {
      // Ready to save or force save — download the edited file
      const downloadUrl = body.url;
      if (!downloadUrl) {
        console.error('[onlyoffice/callback] No download URL in callback');
        return NextResponse.json({ error: 1, message: 'No download URL' });
      }

      // Download the edited document from OnlyOffice (no auth — JWT disabled)
      let fileResponse;
      try {
        fileResponse = await fetch(downloadUrl);
      } catch (fetchError) {
        console.error('[onlyoffice/callback] Failed to download edited file:', fetchError.message);
        return NextResponse.json({ error: 1, message: 'Failed to download file' }, { status: 500 });
      }

      if (!fileResponse.ok) {
        console.error('[onlyoffice/callback] Download returned', fileResponse.status);
        return NextResponse.json({ error: 1, message: 'Download failed' }, { status: 500 });
      }

      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

      // Write to workspace
      const safePath = resolveSafePath(wsDir, filePath);
      if (!safePath) {
        console.error('[onlyoffice/callback] Invalid file path:', filePath);
        return NextResponse.json({ error: 1, message: 'Invalid file path' });
      }

      // Ensure parent directory exists
      const parentDir = path.dirname(safePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(safePath, fileBuffer);
      console.log('[onlyoffice/callback] File saved:', safePath, `(${fileBuffer.length} bytes)`);

      // Create git checkpoint
      try {
        const ckResult = await createWorkspaceCheckpoint(wsDir, 'onlyoffice_' + Date.now());
        if (ckResult.success) {
          console.log('[onlyoffice/callback] Checkpoint created:', ckResult.hash?.slice(0, 8));
        } else {
          console.warn('[onlyoffice/callback] Checkpoint creation warning:', ckResult.error);
        }
      } catch (ckErr) {
        console.warn('[onlyoffice/callback] Checkpoint creation error:', ckErr.message);
      }

      return NextResponse.json({ error: 0 });
    }

    if (status === 3 || status === 7) {
      // Save error — log it
      console.error('[onlyoffice/callback] Document save error (status ' + status + '):',
        body.error || 'Unknown error');
      return NextResponse.json({ error: 0 }); // Acknowledge anyway
    }

    // Unknown status — acknowledge
    console.log('[onlyoffice/callback] Unknown status:', status);
    return NextResponse.json({ error: 0 });
  } catch (error) {
    console.error('[onlyoffice/callback] Unhandled error:', error.message);
    return NextResponse.json({ error: 1, message: error.message }, { status: 500 });
  }
}
