// @aurora/api/chats - Chat CRUD (SQLite-backed, real JWT)

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
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
// Optional query param: ?workspaceId=xyz to filter by workspace
export async function GET(request) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');

    let chats;
    if (workspaceId) {
      chats = db.prepare(`
        SELECT * FROM chats WHERE user_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 50
      `).all(userId, workspaceId);
    } else {
      chats = db.prepare(`
        SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
      `).all(userId);
    }

    return NextResponse.json({ chats: chats.map(c => ({ id: c.id, ...c })) });
  } catch (error) {
    console.error('List chats error:', error);
    return NextResponse.json({ chats: [], error: error.message });
  }
}

// POST /api/chats — create new chat
export async function POST(request) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const chatId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    const chatData = {
      id: chatId,
      userId,
      title: body.title || 'New Chat',
      modelId: body.model || '',
      provider: body.provider || '',
      createdAt: new Date().toISOString(),
      messageCount: 0
    };

    db.prepare(`
      INSERT INTO chats (id, user_id, title, model_id, provider, message_count, workspace_id, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(chatId, userId, chatData.title, chatData.modelId, chatData.provider, body.workspaceId || '', chatData.createdAt);

    return NextResponse.json({ id: chatId, ...chatData }, { status: 201 });
  } catch (error) {
    console.error('Create chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to create chat' } }, { status: 500 });
  }
}
