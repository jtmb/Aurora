// @aurora/api/auth/keys - API key management (Redis-backed)

import { NextResponse } from 'next/server';
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
      isPrimary: body.isPrimary ?? true
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Create API key error:', error);
    return NextResponse.json({ error: { message: 'Failed to create API key' } }, { status: 500 });
  }
}

export async function GET(request) {
  try {
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
