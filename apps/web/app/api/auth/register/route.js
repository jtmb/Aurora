// @aurora/api/auth/register - User registration (SQLite-backed, real JWT)

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

export async function POST(request) {
  try {
    // Ensure database tables exist
    runMigrations();
    const db = getDb();

    const body = await request.json();
    
    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: { message: 'Email and password are required' } },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { error: { message: 'Invalid email format' } },
        { status: 400 }
      );
    }

    if (body.password.length < 8) {
      return NextResponse.json(
        { error: { message: 'Password must be at least 8 characters' } },
        { status: 400 }
      );
    }

    // Check for existing user
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email);
    if (existing) {
      return NextResponse.json(
        { error: { message: 'User with this email already exists' } },
        { status: 409 }
      );
    }

    // First account provisioned gets admin role
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const role = userCount.count === 0 ? 'admin' : 'user';

    // Create user
    const userId = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(body.password, 10);
    
    db.prepare(`
      INSERT INTO users (id, email, hashed_password, name, role, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(userId, body.email, hashedPassword, body.name || null, role);

    // Generate real JWT
    const token = authHandler.signToken({
      sub: body.email,
      email: body.email,
      userId,
      roles: [role]
    });

    return NextResponse.json(
      { message: 'Registration successful', token, user: { id: userId, email: body.email, name: body.name || null, role } },
      { status: 201 }
    );

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: { message: 'Registration failed' } },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({});
}
