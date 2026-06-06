// @aurora/api/auth/provider-settings — DB-backed provider settings (survives cache clears)
// GET  — load settings for authenticated user
// PUT  — save settings for authenticated user

import { NextResponse } from 'next/server';
import { runMigrations } from '@aurora/shared/db-migrate';
import { getDb } from '@aurora/shared/db-client';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

function getUserId(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = authHandler.verifyToken(authHeader.substring(7));
    return decoded.userId;
  } catch { return null; }
}

export async function GET(request) {
  try {
    runMigrations();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const db = getDb();
    const row = db.prepare('SELECT settings_json, updated_at FROM provider_settings WHERE user_id = ?').get(userId);

    if (!row) {
      return NextResponse.json({ settings: null, updatedAt: null });
    }

    return NextResponse.json({
      settings: JSON.parse(row.settings_json),
      updatedAt: row.updated_at
    });
  } catch (error) {
    console.error('[provider-settings] GET error:', error);
    return NextResponse.json({ error: { message: 'Failed to load settings' } }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    runMigrations();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const body = await request.json();
    if (!body.settings || typeof body.settings !== 'object') {
      return NextResponse.json({ error: { message: 'settings object is required' } }, { status: 400 });
    }

    const db = getDb();
    const settingsJson = JSON.stringify(body.settings);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO provider_settings (user_id, settings_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
    `).run(userId, settingsJson, now);

    return NextResponse.json({ message: 'Settings saved', updatedAt: now });
  } catch (error) {
    console.error('[provider-settings] PUT error:', error);
    return NextResponse.json({ error: { message: 'Failed to save settings' } }, { status: 500 });
  }
}
