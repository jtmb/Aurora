// @aurora/api/chats - Chat CRUD (Redis-backed, real JWT)

import { NextResponse } from 'next/server';
import { getRedis, isRedisAvailable } from '@aurora/shared/redis-client';
import { KEYS } from '@aurora/shared/redis-keys';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

function getUserId(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    return authHandler.verifyToken(authHeader.substring(7)).userId;
  } catch { return null; }
}

// GET /api/chats — list user's chats (newest first)
export async function GET(request) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    if (isRedisAvailable()) {
      const redis = getRedis();
      const chatIds = await redis.zrevrange(KEYS.USER_CHATS(userId), 0, 49);
      const chats = [];
      for (const chatId of chatIds) {
        const data = await redis.hgetall(KEYS.CHAT(chatId));
        if (data && Object.keys(data).length > 0) {
          chats.push({ id: chatId, ...data });
        }
      }
      return NextResponse.json({ chats });
    }

    // In-memory fallback: return empty list
    return NextResponse.json({ chats: [] });
  } catch (error) {
    console.error('List chats error:', error);
    return NextResponse.json({ chats: [], error: error.message });
  }
}

// POST /api/chats — create new chat
export async function POST(request) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const chatId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    const chatData = {
      userId,
      title: body.title || 'New Chat',
      modelId: body.model || '',
      provider: body.provider || '',
      createdAt: new Date().toISOString(),
      messageCount: '0'
    };

    if (isRedisAvailable()) {
      const redis = getRedis();
      await redis.hset(KEYS.CHAT(chatId), chatData);
      await redis.zadd(KEYS.USER_CHATS(userId), Date.now(), chatId);
    }

    return NextResponse.json({ id: chatId, ...chatData }, { status: 201 });
  } catch (error) {
    console.error('Create chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to create chat' } }, { status: 500 });
  }
}
