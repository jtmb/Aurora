// @aurora/api/auth/keys - API key management (SQLite-backed)

import { NextResponse } from 'next/server';
import { runMigrations } from '@aurora/shared/db-migrate';
import { AuthHandler } from '@aurora/auth-service/handlers';
import { ApiKeyManager } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();
const apiKeyManager = new ApiKeyManager();

function getUserId(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = authHandler.verifyToken(authHeader.substring(7));
    return decoded.userId;
  } catch { return null; }
}

export async function POST(request) {
  try {
    runMigrations();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const body = await request.json();
    if (!body.provider) {
      return NextResponse.json({ error: { message: 'Provider is required' } }, { status: 400 });
    }

    const result = await apiKeyManager.createApiKey(userId, body.provider, {
      name: body.name || `${body.provider} key`,
      isPrimary: body.isPrimary ?? true,
      rawKey: body.key || undefined
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Create API key error:', error);
    return NextResponse.json({ error: { message: 'Failed to create API key' } }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    runMigrations();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const keys = await apiKeyManager.listKeys(userId);
    return NextResponse.json({ keys, totalCount: keys.length });
  } catch (error) {
    console.error('Get API keys error:', error);
    return NextResponse.json({ error: { message: 'Failed to list API keys' } }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    runMigrations();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const body = await request.json();
    const result = await apiKeyManager.rotateKey(body.keyId, userId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Rotate API key error:', error);
    return NextResponse.json({ error: { message: 'Failed to rotate API key' } }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    runMigrations();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const url = new URL(request.url);
    const keyId = url.searchParams.get('keyId');
    const provider = url.searchParams.get('provider');

    if (keyId) {
      await apiKeyManager.deleteKey(keyId, userId);
      return NextResponse.json({ deleted: true });
    }

    if (provider) {
      const result = await apiKeyManager.deleteKeysByProvider(userId, provider.toUpperCase());
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: { message: 'keyId or provider query parameter is required' } }, { status: 400 });
  } catch (error) {
    console.error('Delete API key error:', error);
    return NextResponse.json({ error: { message: 'Failed to delete API key' } }, { status: 500 });
  }
}
