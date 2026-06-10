// @aurora/api/auth/login - User authentication (SQLite-backed, real JWT)

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { AuthHandler, SessionManager } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();
const sessionManager = new SessionManager();

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

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
    
    if (!user) {
      return NextResponse.json(
        { error: { message: 'Invalid credentials' } },
        { status: 401 }
      );
    }

    // Verify password with bcrypt
    const valid = await bcrypt.compare(body.password, user.hashed_password);
    if (!valid) {
      return NextResponse.json(
        { error: { message: 'Invalid credentials' } },
        { status: 401 }
      );
    }

    // Generate real JWT using auth-service
    const token = authHandler.signToken({
      sub: user.email,
      email: user.email,
      userId: user.id,
      roles: [user.role || 'user']
    });

    // Create session
    await sessionManager.createSession(token, user.id);

    return NextResponse.json({
      token,
      expiresIn: '24h',
      user: { id: user.id, email: user.email, name: user.name || null, role: user.role || 'user' }
    });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: { message: 'Authentication failed' } },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: 'POST to /api/auth/login with {email, password}' });
}
