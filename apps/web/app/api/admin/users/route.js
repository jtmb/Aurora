// @aurora/api/admin/users — List all users, create new user (admin only)

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { requireAdmin } from '../_lib/auth';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export async function GET(request) {
  try {
    runMigrations();
    const { userId, error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const db = getDb();
    const { searchParams } = new URL(request.url);
    const roleFilter = searchParams.get('role');
    const search = searchParams.get('search');

    let query = 'SELECT id, email, name, role, created_at, updated_at FROM users';
    const params = [];
    const conditions = [];

    if (roleFilter && ['admin', 'user'].includes(roleFilter)) {
      conditions.push('role = ?');
      params.push(roleFilter);
    }
    if (search) {
      conditions.push('email LIKE ?');
      params.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const users = db.prepare(query).all(...params);
    const total = users.length;

    return NextResponse.json({ users, total });
  } catch (error) {
    console.error('[admin/users] GET error:', error);
    return NextResponse.json({ error: { message: 'Failed to list users' } }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    runMigrations();
    const { userId: adminId, error } = requireAdmin(request);
    if (error) return NextResponse.json({ error }, { status: error.status });

    const body = await request.json();
    const { email, password, name, role } = body;

    if (!email || !password) {
      return NextResponse.json({ error: { message: 'Email and password are required' } }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: { message: 'Password must be at least 8 characters' } }, { status: 400 });
    }
    if (role && !['admin', 'user'].includes(role)) {
      return NextResponse.json({ error: { message: 'Role must be admin or user' } }, { status: 400 });
    }

    const db = getDb();

    // Check for existing user
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return NextResponse.json({ error: { message: 'A user with this email already exists' } }, { status: 409 });
    }

    const id = randomUUID();
    const hashedPassword = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const userRole = role || 'user';

    db.prepare(
      'INSERT INTO users (id, email, hashed_password, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, email, hashedPassword, name || null, userRole, now, now);

    return NextResponse.json({
      message: 'User created',
      user: { id, email, name: name || null, role: userRole, created_at: now, updated_at: now }
    }, { status: 201 });
  } catch (error) {
    console.error('[admin/users] POST error:', error);
    return NextResponse.json({ error: { message: 'Failed to create user' } }, { status: 500 });
  }
}
