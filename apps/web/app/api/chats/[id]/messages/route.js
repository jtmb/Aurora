// @aurora/api/chats/[id]/messages - Messages within a chat

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

// GET /api/chats/[id]/messages — get all messages for a chat
export async function GET(request, { params }) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;

    if (isRedisAvailable()) {
      const redis = getRedis();
      const messagesRaw = await redis.lrange(KEYS.CHAT_MESSAGES(id), 0, -1);
      const messages = messagesRaw.map(m => {
        try { return JSON.parse(m); } catch { return { role: 'assistant', content: m }; }
      });
      return NextResponse.json({ messages });
    }

    return NextResponse.json({ messages: [] });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json({ messages: [], error: error.message });
  }
}

// POST /api/chats/[id]/messages — append a message to a chat
export async function POST(request, { params }) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const message = {
      role: body.role || 'user',
      content: body.content || '',
      timestamp: body.timestamp || new Date().toISOString(),
      model: body.model || '',
      provider: body.provider || ''
    };

    if (isRedisAvailable()) {
      const redis = getRedis();
      await redis.rpush(KEYS.CHAT_MESSAGES(id), JSON.stringify(message));
      // Update chat timestamp
      await redis.hset(KEYS.CHAT(id), 'lastMessageAt', new Date().toISOString());
      const msgCount = await redis.llen(KEYS.CHAT_MESSAGES(id));
      await redis.hset(KEYS.CHAT(id), 'messageCount', msgCount.toString());
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    console.error('Add message error:', error);
    return NextResponse.json({ error: { message: 'Failed to add message' } }, { status: 500 });
  }
}
