// @aurora/api/admin/users/[id]/model-access — Get/update model access for a user

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { requireAdmin } from '../../../_lib/auth';
import { randomUUID } from 'crypto';

export async function GET(request, { params }) {
  try {
    runMigrations();
    const { error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const { id } = await params;
    const db = getDb();

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) {
      return NextResponse.json({ error: { message: 'User not found' } }, { status: 404 });
    }

    const modelAccess = db.prepare(
      'SELECT provider, model_id, enabled FROM user_model_access WHERE user_id = ? ORDER BY provider, model_id'
    ).all(id);

    return NextResponse.json({ modelAccess });
  } catch (error) {
    console.error('[admin/model-access] GET error:', error);
    return NextResponse.json({ error: { message: 'Failed to get model access' } }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    runMigrations();
    const { error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const { id } = await params;
    const body = await request.json();
    const { modelAccess } = body;

    if (!Array.isArray(modelAccess)) {
      return NextResponse.json({ error: { message: 'modelAccess must be an array' } }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) {
      return NextResponse.json({ error: { message: 'User not found' } }, { status: 404 });
    }

    const now = new Date().toISOString();

    // Use a transaction to atomically replace all model access entries
    const deleteStmt = db.prepare('DELETE FROM user_model_access WHERE user_id = ?');
    const upsertStmt = db.prepare(
      `INSERT INTO user_model_access (id, user_id, provider, model_id, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider, model_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    );

    const transaction = db.transaction((entries) => {
      deleteStmt.run(id);
      for (const entry of entries) {
        if (!entry.provider || !entry.modelId) continue;
        upsertStmt.run(randomUUID(), id, entry.provider, entry.modelId, entry.enabled ? 1 : 0, now, now);
      }
    });

    transaction(modelAccess);

    const updated = db.prepare(
      'SELECT provider, model_id, enabled FROM user_model_access WHERE user_id = ? ORDER BY provider, model_id'
    ).all(id);

    return NextResponse.json({ message: 'Model access updated', modelAccess: updated });
  } catch (error) {
    console.error('[admin/model-access] PUT error:', error);
    return NextResponse.json({ error: { message: 'Failed to update model access' } }, { status: 500 });
  }
}
