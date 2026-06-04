// @aurora/api/auth/me - Get current user info endpoint

import { NextResponse } from 'next/server';

/**
 * Get current authenticated user
 * Extracts userId from Authorization header token
 */
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

    // Parse user info from token (token is base64 encoded JSON)
    let userInfo;
    try {
      userInfo = JSON.parse(Buffer.from(token).toString('utf8'));
    } catch {
      return NextResponse.json(
        { error: { message: 'Invalid authentication token' } },
        { status: 401 }
      );
    }

    // Fetch user details from database
    const user = await getUserById(userInfo.userId);

    if (!user) {
      return NextResponse.json(
        { error: { message: 'User not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });

  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to get current user' } },
      { status: 500 }
    );
  }
}

/**
 * Get user from database
 */
async function getUserById(userId) {
  try {
    // In production, use: const user = await db.user.findUnique({ where: { id: userId } })
    return {
      id: userId,
      email: '',
      name: null,
      role: 'user'
    };
  } catch (error) {
    console.error('User lookup error:', error);
    return null;
  }
}

export async function POST(request) {
  return NextResponse.json({});
}