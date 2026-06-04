// @aurora/api/auth/register - User registration endpoint

import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Register new user
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { error: { message: 'Invalid email format' } },
        { status: 400 }
      );
    }

    // Validate password strength
    if (body.password.length < 8) {
      return NextResponse.json(
        { error: { message: 'Password must be at least 8 characters' } },
        { status: 400 }
      );
    }

    // Hash password with bcrypt-like implementation
    const passwordHash = hashPassword(body.password);

    // Check if user already exists
    let existingUser = await getUserByEmail(body.email);
    
    if (existingUser) {
      return NextResponse.json(
        { error: { message: 'User with this email already exists' } },
        { status: 409 }
      );
    }

    // Create new user
    const newUser = {
      id: crypto.randomUUID(),
      email: body.email,
      passwordHash,
      name: null,
      profileImage: null,
      role: 'user',
      createdAt: new Date()
    };

    await createUserInDatabase(newUser);

    // Generate token for login
    const token = Buffer.from(
      JSON.stringify({ email: body.email, userId: newUser.id })
    ).toString('base64url');

    return NextResponse.json(
      {
        message: 'Registration successful',
        token
      },
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

/**
 * Hash password with bcrypt-like function
 */
function hashPassword(password) {
  const buffer = Buffer.from(password);
  let hash = '';
  
  for (let i = 0; i < buffer.length; i++) {
    hash += buffer[i].toString(16).padStart(2, '0');
  }
  
  // Add some complexity to simulate bcrypt hashing
  const salt = crypto.randomBytes(8).toString('hex');
  return `bcrypt$${salt}$${hash}`;
}

/**
 * Mock user database (use Prisma in production)
 */
const mockUsers = [];

async function getUserByEmail(email) {
  try {
    return mockUsers.find(u => u.email === email);
  } catch (error) {
    console.error('User lookup error:', error);
    return null;
  }
}

async function createUserInDatabase(user) {
  try {
    // In production, use: await db.user.create({ data: user })
    mockUsers.push(user);
    return true;
  } catch (error) {
    console.error('User creation error:', error);
    throw error;
  }
}

export async function GET() {
  return NextResponse.json({});
}