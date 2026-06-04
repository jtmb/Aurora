// @aurora/api/auth/register - User registration (Redis-backed, real JWT)

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getRedis, isRedisAvailable } from '@aurora/shared/redis-client';
import { KEYS } from '@aurora/shared/redis-keys';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

export async function POST(request) {
  try {
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

    const redis = getRedis();
    
    // Require Redis — no fallback
    if (!isRedisAvailable()) {
      return NextResponse.json(
        { error: { message: 'Backend database is currently unavailable. Please try again later.' } },
        { status: 503 }
      );
    }
    
    const exists = await redis.exists(KEYS.USER_BY_EMAIL(body.email));
    if (exists) {
      return NextResponse.json(
        { error: { message: 'User with this email already exists' } },
        { status: 409 }
      );
    }

    // Create user
    const userId = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(body.password, 10);
    
    const userData = {
      id: userId,
      email: body.email,
      hashedPassword,
      name: body.name || null,
      role: 'user',
      createdAt: new Date().toISOString()
    };

    await redis.hset(KEYS.USER_BY_EMAIL(body.email), userData);
    await redis.hset(KEYS.USER_BY_ID(userId), userData);

    // Generate real JWT
    const token = authHandler.signToken({
      sub: body.email,
      email: body.email,
      userId,
      roles: ['user']
    });

    return NextResponse.json(
      { message: 'Registration successful', token, user: { id: userId, email: body.email, name: body.name || null } },
      { status: 201 }
    );

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: { message: 'Registration failed. Backend database may be unavailable.' } },
      { status: 503 }
    );
  }
}

export async function GET() {
  return NextResponse.json({});
}
