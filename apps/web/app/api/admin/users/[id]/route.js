// @aurora/api/admin/users/[id] — Get, update, or delete a single user (admin only)

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { requireAdmin } from '../../_lib/auth';

export async function GET(request, { params }) {
  try {
    runMigrations();
    const { error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const { id } = await params;
    const db = getDb();
    const user = db.prepare('SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = ?').get(id);

    if (!user) {
      return NextResponse.json({ error: { message: 'User not found' } }, { status: 404 });
    }

    // Also fetch model access for this user
    const modelAccess = db.prepare(
      'SELECT provider, model_id, enabled FROM user_model_access WHERE user_id = ? ORDER BY provider, model_id'
    ).all(id);

    return NextResponse.json({ ...user, modelAccess });
  } catch (error) {
    console.error('[admin/users/[id]] GET error:', error);
    return NextResponse.json({ error: { message: 'Failed to get user' } }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    runMigrations();
    const { error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const { id } = await params;
    const body = await request.json();
    const { name, role } = body;

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) {
      return NextResponse.json({ error: { message: 'User not found' } }, { status: 404 });
    }

    if (role && !['admin', 'user'].includes(role)) {
      return NextResponse.json({ error: { message: 'Role must be admin or user' } }, { status: 400 });
    }

    const now = new Date().toISOString();
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (role) {
      updates.push('role = ?');
      values.push(role);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = ?').get(id);
    return NextResponse.json({ message: 'User updated', user: updated });
  } catch (error) {
    console.error('[admin/users/[id]] PUT error:', error);
    return NextResponse.json({ error: { message: 'Failed to update user' } }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    runMigrations();
    const { userId: adminId, error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const { id } = await params;

    // Prevent self-deletion
    if (id === adminId) {
      return NextResponse.json({ error: { message: 'Cannot delete your own account' } }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) {
      return NextResponse.json({ error: { message: 'User not found' } }, { status: 404 });
    }

    // Cascading delete: foreign keys handle chats, messages, sessions, api_keys,
    // provider_settings, usage_records, local_model_mappings, user_model_access
    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    return NextResponse.json({ message: 'User deleted' });
  } catch (error) {
    console.error('[admin/users/[id]] DELETE error:', error);
    return NextResponse.json({ error: { message: 'Failed to delete user' } }, { status: 500 });
  }
}
