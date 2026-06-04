// @aurora/api/auth/me - Get current user (real JWT verify, Redis-backed)

import { NextResponse } from 'next/server';
import { getRedis, isRedisAvailable } from '@aurora/shared/redis-client';
import { KEYS } from '@aurora/shared/redis-keys';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

export async function GET(request) {
  try {
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
    
    // Look up user via Redis
    let user = null;
    if (isRedisAvailable()) {
      const redis = getRedis();
      user = await redis.hgetall(KEYS.USER_BY_ID(userId));
      if (!user || Object.keys(user).length === 0) user = null;
    }

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
