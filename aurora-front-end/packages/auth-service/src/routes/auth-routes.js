// @aurora/auth-service - Authentication Routes for Next.js App Router
// Defines all /api/auth/** endpoints using Next.js Route Handlers

import { NextResponse } from 'next/server';
import { AuthService } from '../index.js';

const authHandler = new AuthService();

/**
 * POST /api/auth/register - Register new user (placeholder)
 */
export async function POST(req, res) {
  try {
    const body = await req.json();
    
    // In production: Create user in database with hashed password
    // For now: Return test credentials or error if credentials missing
    
    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 }
      );
    }

    // In production: Hash password before storing
    const hashedPassword = await hashPassword(body.password);
    
    return NextResponse.json({ 
      message: 'Registration successful',
      // Return test token for development
      token: authHandler.generateTestToken({ email: body.email })
    });

  } catch (error) {
    console.error('Auth POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/login - Login endpoint
 */
export async function loginHandler(req) {
  try {
    const body = await req.json();
    
    if (!body.email || !body.password) {
      throw new Error('Email and password are required');
    }

    // In production: Query database for user by email
    const user = await authHandler.validateUser(body.email, body.password);
    
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const token = authHandler.signToken({
      sub: user.email,
      email: user.email,
      userId: user.id,
      roles: ['user']
    });

    // Create session record
    await authHandler.sessionManager.createSession(token);

    return NextResponse.json({
      token,
      expiresIn: '24h'
    });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Invalid credentials' },
      { status: 401 }
    );
  }
}

/**
 * GET /api/auth/me - Get current user info
 */
export async function meHandler(req) {
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const user = authHandler.getCurrentUser(authHeader);
    
    // In production: Fetch user profile from database
    const userProfile = await getUserProfile(user.userId);

    return NextResponse.json({
      id: user.userId,
      email: user.email,
      name: userProfile.name || null,
      image: userProfile.image || null,
      role: userProfile.role || 'user',
      createdAt: userProfile.createdAt?.toISOString()
    });

  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  }
}

/**
 * POST /api/auth/keys/cycle - Rotate API key securely
 */
export async function cycleKeyHandler(req) {
  try {
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const user = authHandler.getCurrentUser(authHeader);

    // Parse body for provider-specific options
    const body = await req.json();
    const { provider, force } = body;

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      );
    }

    // Get existing primary key
    const primaryKey = authHandler.apiKeyManager.getPrimaryKey(user.userId, provider);

    if (!primaryKey) {
      throw new Error('No API key found for this provider');
    }

    // Rotate the key
    let newKey;
    
    if (force && primaryKey.revokedAt) {
      // Generate completely new random key (for forced rotation)
      const bytes = crypto.randomBytes(16);
      newKey = `${provider}_key_${bytes.toString('hex')}`;
    } else {
      // Reuse existing model-based key if Ollama, or similar logic
      newKey = primaryKey.rawKey;
    }

    return NextResponse.json({
      id: primaryKey.id,
      rawKey: newKey,
      provider,
      lastRotated: new Date().toISOString(),
      isPrimary: true,
      name: 'Primary API Key'
    });

  } catch (error) {
    console.error('Cycle key error:', error);
    return NextResponse.json(
      { error: 'Failed to rotate API key' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/keys/create - Create new API key
 */
export async function createKeyHandler(req) {
  try {
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const user = authHandler.getCurrentUser(authHeader);
    const body = await req.json();

    const { provider, isPrimary = false, fromModel } = body;

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      );
    }

    const result = await authHandler.apiKeyManager.createApiKey(user.userId, provider, {
      name: body.name || `${provider} API Key`,
      isPrimary,
      fromModel
    });

    return NextResponse.json({
      ...result,
      // Mask the raw key for security (only show first few chars)
      rawKey: result.rawKey.substring(0, 24) + '...'
    });

  } catch (error) {
    console.error('Create key error:', error);
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/keys/revoke - Revoke specific API key
 */
export async function revokeKeyHandler(req) {
  try {
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const user = authHandler.getCurrentUser(authHeader);
    const body = await req.json();
    
    if (!body.keyId) {
      return NextResponse.json(
        { error: 'keyId is required' },
        { status: 400 }
      );
    }

    await authHandler.apiKeyManager.revokeKey(body.keyId, user.userId);

    return NextResponse.json({ message: 'API key revoked' });

  } catch (error) {
    console.error('Revoke key error:', error);
    return NextResponse.json(
      { error: 'Failed to revoke API key' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/keys - List user's API keys
 */
export async function listKeysHandler(req) {
  try {
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const user = authHandler.getCurrentUser(authHeader);

    const keys = await authHandler.apiKeyManager.listKeys(user.userId, false);

    return NextResponse.json({ 
      keys,
      totalCount: keys.length 
    });

  } catch (error) {
    console.error('List keys error:', error);
    return NextResponse.json(
      { error: 'Failed to list API keys' },
      { status: 500 }
    );
  }
}

/**
 * Helper: Hash password (placeholder - use bcrypt in production)
 */
async function hashPassword(password) {
  // In production: Use bcrypt or similar library
  return Buffer.from(password).toString('hex');
}

/**
 * Helper: Get user profile from database (placeholder)
 */
async function getUserProfile(userId) {
  // In production: Query database for user profile
  return { name: null, image: null, role: 'user', createdAt: null };
}

export default authHandler;