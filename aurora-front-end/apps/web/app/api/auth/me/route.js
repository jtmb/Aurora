// @aurora/api/auth/me - Get current user (JWT verify, SQLite-backed)

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

export async function GET(request) {
  try {
    // Ensure database tables exist
    runMigrations();
    const db = getDb();

    const authHeader = request.headers.get('Authorization') || '';
    
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: { message: 'Unauthorized - No valid authentication token' } },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    let decoded;
    
    try {
      decoded = authHandler.verifyToken(token);
    } catch {
      return NextResponse.json(
        { error: { message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }

    const userId = decoded.userId;
    const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(userId);

    if (!user) {
      return NextResponse.json(
        { error: { message: 'User not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name || null,
      role: user.role || 'user'
    });

  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to get current user' } },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json({});
}
