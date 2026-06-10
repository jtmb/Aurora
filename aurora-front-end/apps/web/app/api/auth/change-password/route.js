// @aurora/api/auth/change-password - Reset password (JWT auth required)

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

    // Verify JWT
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

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: { message: 'Current password and new password are required' } },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: { message: 'New password must be at least 8 characters' } },
        { status: 400 }
      );
    }

    // Get user from DB
    const userId = decoded.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return NextResponse.json(
        { error: { message: 'User not found' } },
        { status: 404 }
      );
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.hashed_password);
    if (!valid) {
      return NextResponse.json(
        { error: { message: 'Current password is incorrect' } },
        { status: 401 }
      );
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET hashed_password = ? WHERE id = ?').run(hashedPassword, userId);

    return NextResponse.json({
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to update password' } },
      { status: 500 }
    );
  }
}
