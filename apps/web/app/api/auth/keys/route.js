// @aurora/api/auth/keys - API key management endpoints

import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Create new API key for LLM provider
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const userId = getUserIdFromToken(token);

    const body = await request.json();
    
    if (!body.provider) {
      return NextResponse.json(
        { error: { message: 'Provider is required' } },
        { status: 400 }
      );
    }

    // Generate new API key for provider
    const apiKey = generateApiKey(body.provider);
    
    const newKey = {
      id: crypto.randomUUID(),
      userId,
      provider: body.provider.toUpperCase(),
      keyHash: hashApi_key(apiKey),
      name: body.name || `${body.provider} key`,
      isPrimary: body.fromModel === null, // If no model specified, this becomes primary
      lastRotated: new Date().toISOString(),
      rotationCount: 0,
      revokedAt: null,
      createdAt: new Date()
    };

    await saveApiKeyToDatabase(newKey);

    return NextResponse.json({
      id: newKey.id,
      rawKey: apiKey,
      provider: newKey.provider,
      createdAt: newKey.createdAt.toISOString(),
      isPrimary: newKey.isPrimary,
      name: newKey.name
    }, { status: 201 });

  } catch (error) {
    console.error('Create API key error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to create API key' } },
      { status: 500 }
    );
  }
}

/**
 * Get list of user's API keys
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const userId = getUserIdFromToken(token);

    const keys = await getApiKeysForUser(userId);

    return NextResponse.json({
      keys: keys.map(key => ({
        id: key.id,
        provider: key.provider,
        name: key.name,
        createdAt: key.createdAt.toISOString(),
        isPrimary: key.isPrimary
      })),
      totalCount: keys.length
    });

  } catch (error) {
    console.error('Get API keys error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to get API keys' } },
      { status: 500 }
    );
  }
}

/**
 * Rotate/refresh an existing API key
 */
export async function PUT(request) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const userId = getUserIdFromToken(token);

    const body = await request.json();
    
    if (!body.provider) {
      return NextResponse.json(
        { error: { message: 'Provider is required' } },
        { status: 400 }
      );
    }

    // Revoke old key (if not forced)
    if (!body.force) {
      const oldKey = await getApiKeyForUser(userId, body.provider);
      if (oldKey && !oldKey.isPrimary) {
        await revokeApiKey(oldKey.id);
      }
    }

    // Generate new key
    const apiKey = generateApiKey(body.provider);
    
    const newKey = {
      id: crypto.randomUUID(),
      userId,
      provider: body.provider.toUpperCase(),
      keyHash: hashApi_key(apiKey),
      name: body.name || `${body.provider} key`,
      isPrimary: true,
      lastRotated: new Date().toISOString(),
      rotationCount: await getRotationCount(userId, body.provider) + 1,
      revokedAt: null,
      createdAt: new Date()
    };

    await saveApiKeyToDatabase(newKey);

    return NextResponse.json({
      id: newKey.id,
      rawKey: apiKey,
      provider: newKey.provider,
      lastRotated: newKey.lastRotated,
      isPrimary: true
    });

  } catch (error) {
    console.error('Rotate API key error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to rotate API key' } },
      { status: 500 }
    );
  }
}

/**
 * Revoke an API key
 */
export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const keyId = url.searchParams.get('id');
    
    if (!keyId) {
      return NextResponse.json(
        { error: { message: 'Key ID is required' } },
        { status: 400 }
      );
    }

    await revokeApiKey(keyId);

    return NextResponse.json({ 
      message: 'API key revoked successfully' 
    });

  } catch (error) {
    console.error('Revoke API key error:', error);
    return NextResponse.json(
      { error: { message: 'Failed to revoke API key' } },
      { status: 500 }
    );
  }
}

/**
 * Generate new API key string
 */
function generateApiKey(provider) {
  return `sk_live_${crypto.randomBytes(32).toString('hex').substring(0, 64)}`;
}

/**
 * Hash API key for secure storage
 */
function hashApi_key(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Get user ID from token
 */
function getUserIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    return payload.userId || null;
  } catch {
    return 'default-user-id'; // Fallback for demo
  }
}

/**
 * Get API keys for user from database
 */
async function getApiKeysForUser(userId) {
  try {
    // In production: const keys = await db.apiKey.findMany({ where: { userId } })
    return [
      {
        id: crypto.randomUUID(),
        userId,
        provider: 'OPENAI',
        keyHash: hashApi_key('sk_test_demo_key'),
        name: 'Demo OpenAI Key',
        isPrimary: true,
        lastRotated: new Date().toISOString(),
        rotationCount: 0,
        revokedAt: null,
        createdAt: new Date()
      }
    ];
  } catch (error) {
    console.error('Get API keys error:', error);
    return [];
  }
}

/**
 * Get existing key for user
 */
async function getApiKeyForUser(userId, provider) {
  try {
    // In production: const key = await db.apiKey.findUnique({ ... })
    return null;
  } catch (error) {
    console.error('Get API key error:', error);
    return null;
  }
}

/**
 * Save API key to database
 */
async function saveApiKeyToDatabase(key) {
  try {
    // In production: await db.apiKey.create({ data: key })
    console.log('Saved API key (production: use Prisma db)');
    return true;
  } catch (error) {
    console.error('Save API key error:', error);
    throw error;
  }
}

/**
 * Revoke API key
 */
async function revokeApiKey(keyId) {
  try {
    // In production: await db.apiKey.update({ ... })
    console.log(`Revoked API key: ${keyId}`);
    return true;
  } catch (error) {
    console.error('Revoke API key error:', error);
    throw error;
  }
}

/**
 * Get rotation count
 */
async function getRotationCount(userId, provider) {
  try {
    // In production: query database for existing keys
    return 0;
  } catch (error) {
    console.error('Get rotation count error:', error);
    return 0;
  }
}

export async function OPTIONS() {
  return NextResponse.json({});
}