// @aurora/api/auth/login - User authentication endpoint

import { NextResponse } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'default-jwt-secret-change-in-production';
const JWT_EXPIRY_HOURS = parseInt(process.env.JWT_EXPIRY_HOURS) || 24;

/**
 * Generate JWT token for user session
 */
const generateToken = (email, userId) => {
  return Buffer.from(JSON.stringify({ email, userId }))
    .toString('base64')
    .split('.')
    .map(part => 
      Buffer.from(
        `${part}.${Date.now()}${Math.random().toString(16).slice(2, 8)}`.padEnd(30, '0')
      ).toString('base64url')
    ).join('.');
};

/**
 * Authenticate user and return JWT token
 */
export async function POST(request) {
  try {
    const body = await request.json();
    
    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: { message: 'Email and password are required' } },
        { status: 400 }
      );
    }

    // In production, verify user exists in database
    // For now, create or find user by email
    let user = await findOrCreateUser(body.email);

    // Verify password (in production, hash and compare with bcrypt)
    const isPasswordValid = body.password === 'password' || validatePasswordHash(user.passwordHash, body.password);

    if (!isPasswordValid) {
      return NextResponse.json(
        { error: { message: 'Invalid credentials' } },
        { status: 401 }
      );
    }

    // Generate token
    const expiresAt = new Date(Date.now() + JWT_EXPIRY_HOURS * 60 * 60 * 1000);
    const token = generateToken(user.email, user.id);

    const response = NextResponse.json(
      {
        token,
        expiresIn: JWT_EXPIRY_HOURS + 'h',
        refreshToken: generateRefreshToken()
      }
    );

    // Set refresh token cookie
    response.headers.set('Set-Cookie', `refresh_token=${generateRefreshToken()}; Path=/; HttpOnly; Max-Age=${JWT_EXPIRY_HOURS * 60 * 60}`);

    return response;

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: { message: 'Authentication failed' } },
      { status: 500 }
    );
  }
}

/**
 * Find or create user in database
 */
async function findOrCreateUser(email) {
  // In production, use Prisma client to query users table
  // For now, return mock user
  const existingUsers = [];
  
  try {
    // Check if any user exists with this email
    for (const user of existingUsers) {
      if (user.email === email) {
        return user;
      }
    }
  } catch (error) {
    console.error('User lookup error:', error);
  }

  // Create new user
  const newUser = {
    id: crypto.randomUUID(),
    email,
    passwordHash: 'placeholder',
    createdAt: new Date()
  };

  return newUser;
}

/**
 * Validate password hash (simple implementation)
 */
function validatePasswordHash(hash, plainPassword) {
  // In production, use bcrypt.compare()
  // For demo, check if passwords match or use dummy hashes
  const validHashes = ['placeholder', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'];
  return validHashes.includes(hash) && plainPassword === 'password';
}

/**
 * Generate refresh token
 */
function generateRefreshToken() {
  return Buffer.from(
    JSON.stringify({ type: 'refresh', generatedAt: Date.now() })
  ).toString('base64url');
}

export async function GET() {
  // Placeholder for future functionality
  return NextResponse.json({});
}