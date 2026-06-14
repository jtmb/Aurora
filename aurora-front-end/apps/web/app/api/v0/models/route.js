// @aurora/api/v1/models - OpenAI-compatible models listing
// Returns available models for the v1 API. Used by Cline and other clients.
// When authenticated: filters by user's model_access entries.
// Admins + unauthenticated: returns all available models.
// Dynamically fetches LM Studio models when configured.

import { NextResponse } from 'next/server';
import { AuthHandler } from '@aurora/auth-service/handlers';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';

const authHandler = new AuthHandler();

const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat', owned_by: 'deepseek' },
  { id: 'deepseek-reasoner', owned_by: 'deepseek' },
  { id: 'deepseek-v4-flash', owned_by: 'deepseek' },
  { id: 'deepseek-v4-pro', owned_by: 'deepseek' },
];

function getUserId(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    return authHandler.verifyToken(authHeader.substring(7)).userId;
  } catch { return null; }
}

function getUserAllowedModels(userId) {
  // Unauthenticated requests (no JWT) get full access — per-user filtering
  // applies only when Cline sends the user's JWT (set via orchestrator auth/update).
  if (!userId) return null;

  try {
    runMigrations();
    const db = getDb();

    // Admins always get full access
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (user?.role === 'admin') return null;

    // Count total access entries for this user
    const anyRows = db.prepare(
      'SELECT COUNT(*) as count FROM user_model_access WHERE user_id = ?'
    ).get(userId);

    // No rules configured → empty set (nothing allowed until admin provisions)
    if (!anyRows || anyRows.count === 0) return new Set();

    // Return only explicitly enabled models
    const rows = db.prepare(
      'SELECT provider, model_id FROM user_model_access WHERE user_id = ? AND enabled = 1'
    ).all(userId);
    return new Set(rows.map(r => `${r.provider}:${r.model_id}`));
  } catch {
    return new Set(); // DB error → deny to be safe
  }
}

async function fetchLmStudioModels() {
  const lmHost = process.env.LM_STUDIO_HOST || '';
  const lmPort = process.env.LM_STUDIO_PORT || '';
  let lmUrl = process.env.LMSTUDIO_URL || ((lmHost && lmPort) ? `http://${lmHost}:${lmPort}/v1` : '');

  // Try DB fallback for unauthenticated / env-not-set
  if (!lmUrl) {
    try {
      runMigrations();
      const db = getDb();
      const rows = db.prepare('SELECT settings_json FROM provider_settings').all();
      for (const row of rows) {
        try {
          const s = JSON.parse(row.settings_json);
          if (s.lmStudioUrl) { lmUrl = s.lmStudioUrl; break; }
          if (s.lmStudioHost && s.lmStudioPort) {
            lmUrl = `http://${s.lmStudioHost}:${s.lmStudioPort}/v1`;
            break;
          }
        } catch { /* skip */ }
      }
    } catch { /* DB not available */ }
  }

  if (!lmUrl) return [];

  try {
    const base = lmUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const resp = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const models = data.data || (Array.isArray(data) ? data : []);
    return models.map(m => ({
      id: String(m.id || ''),
      owned_by: 'lmstudio',
    }));
  } catch (err) {
    console.error('[v1/models] Failed to fetch LM Studio models:', err.message);
    return [];
  }
}

export async function GET(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const authPreview = authHeader ? (authHeader.startsWith('Bearer ') ? `Bearer ${authHeader.substring(7, 30)}...` : authHeader.substring(0, 30)) : 'NONE';
  let userId = getUserId(request);
  // Fallback: Cline sends aurora-no-key (no JWT). Use the active code-server
  // user identity exposed by the cs-proxy (server.js) via globalThis.
  const fallbackUsed = !userId && !!globalThis.__aurora_cs_user_id;
  if (!userId && globalThis.__aurora_cs_user_id) {
    userId = globalThis.__aurora_cs_user_id;
  }
  const allowedModels = getUserAllowedModels(userId);
  console.log(`[v0/models] auth=${authPreview} userId=${userId || 'null'} fallback=${fallbackUsed} ` +
    `allowedModels=${allowedModels === null ? 'ALL' : `${allowedModels.size} entries`} ` +
    `globalThis=${globalThis.__aurora_cs_user_id || 'unset'}`);

  // Build full model list: hardcoded DeepSeek + dynamic LM Studio
  const lmStudioModels = await fetchLmStudioModels();
  const allModels = [
    ...DEEPSEEK_MODELS.map(m => ({
      id: m.id,
      object: 'model',
      created: 1700000000,
      owned_by: m.owned_by,
    })),
    ...lmStudioModels.map(m => ({
      id: m.id,
      object: 'model',
      created: 1700000000,
      owned_by: m.owned_by,
    })),
  ];

  // If allowedModels is null (admin or unauthenticated), return all models
  // EXCEPT: when completely unidentified (no userId AND no globalThis fallback),
  // return empty list to prevent leaking all models before auth is established.
  if (allowedModels === null) {
    if (!userId && !globalThis.__aurora_cs_user_id) {
      console.log('[v0/models] No auth available — returning empty model list until auth is established');
      return NextResponse.json({ object: 'list', data: [] });
    }
    return NextResponse.json({ object: 'list', data: allModels });
  }

  // Filter to only explicitly enabled models
  const filtered = allModels.filter(m => allowedModels.has(`${m.owned_by}:${m.id}`));

  return NextResponse.json({ object: 'list', data: filtered });
}
