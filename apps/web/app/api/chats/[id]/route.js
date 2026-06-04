// @aurora/api/chats/[id] - Single chat operations

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

// GET /api/chats/[id] — get chat with messages
export async function GET(request, { params }) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;

    if (isRedisAvailable()) {
      const redis = getRedis();
      const chat = await redis.hgetall(KEYS.CHAT(id));
      if (!chat || Object.keys(chat).length === 0) {
        return NextResponse.json({ error: { message: 'Chat not found' } }, { status: 404 });
      }
      
      const messagesRaw = await redis.lrange(KEYS.CHAT_MESSAGES(id), 0, -1);
      const messages = messagesRaw.map(m => {
        try { return JSON.parse(m); } catch { return { role: 'assistant', content: m }; }
      });

      return NextResponse.json({ id, ...chat, messages });
    }

    return NextResponse.json({ id, messages: [] });
  } catch (error) {
    console.error('Get chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to get chat' } }, { status: 500 });
  }
}

// PATCH /api/chats/[id] — rename or update chat
export async function PATCH(request, { params }) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    if (isRedisAvailable()) {
      const redis = getRedis();
      const chat = await redis.hgetall(KEYS.CHAT(id));
      if (!chat || Object.keys(chat).length === 0) {
        return NextResponse.json({ error: { message: 'Chat not found' } }, { status: 404 });
      }
      if (body.title !== undefined) await redis.hset(KEYS.CHAT(id), 'title', body.title);
      if (body.modelId !== undefined) await redis.hset(KEYS.CHAT(id), 'modelId', body.modelId);
      return NextResponse.json({ id, ...chat, ...body });
    }

    return NextResponse.json({ id });
  } catch (error) {
    console.error('Patch chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to update chat' } }, { status: 500 });
  }
}

// DELETE /api/chats/[id] — delete chat
export async function DELETE(request, { params }) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;

    if (isRedisAvailable()) {
      const redis = getRedis();
      await redis.del(KEYS.CHAT(id));
      await redis.del(KEYS.CHAT_MESSAGES(id));
      await redis.zrem(KEYS.USER_CHATS(userId), id);
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Delete chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to delete chat' } }, { status: 500 });
  }
}
