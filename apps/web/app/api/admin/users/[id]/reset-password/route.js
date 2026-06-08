// @aurora/api/admin/users/[id]/reset-password — Admin-initiated password reset

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { requireAdmin } from '../../../_lib/auth';
import bcrypt from 'bcryptjs';

export async function POST(request, { params }) {
  try {
    runMigrations();
    const { error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const { id } = await params;
    const body = await request.json();
    const { newPassword } = body;

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ error: { message: 'New password must be at least 8 characters' } }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) {
      return NextResponse.json({ error: { message: 'User not found' } }, { status: 404 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const now = new Date().toISOString();

    db.prepare('UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?').run(hashedPassword, now, id);

    return NextResponse.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[admin/users/[id]/reset-password] POST error:', error);
    return NextResponse.json({ error: { message: 'Failed to reset password' } }, { status: 500 });
  }
}
