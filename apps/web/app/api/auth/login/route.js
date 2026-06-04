// @aurora/api/auth/login - User authentication (Redis-backed, real JWT)

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getRedis, isRedisAvailable } from '@aurora/shared/redis-client';
import { KEYS } from '@aurora/shared/redis-keys';
import { AuthHandler } from '@aurora/auth-service/handlers';
import { SessionManager } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();
const sessionManager = new SessionManager();

export async function POST(request) {
  try {
    const body = await request.json();
    
    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: { message: 'Email and password are required' } },
        { status: 400 }
      );
    }

    const redis = getRedis();

    // Require Redis — no fallback
    if (!isRedisAvailable()) {
      return NextResponse.json(
        { error: { message: 'Backend database is currently unavailable. Please try again later.' } },
        { status: 503 }
      );
    }

    let user = await redis.hgetall(KEYS.USER_BY_EMAIL(body.email));
    if (!user || Object.keys(user).length === 0) user = null;
    
    if (!user) {
      return NextResponse.json(
        { error: { message: 'Invalid credentials' } },
        { status: 401 }
      );
    }

    // Verify password with bcrypt
    const valid = await bcrypt.compare(body.password, user.hashedPassword);
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
      { error: { message: 'Authentication failed. Backend database may be unavailable.' } },
      { status: 503 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: 'POST to /api/auth/login with {email, password}' });
}
