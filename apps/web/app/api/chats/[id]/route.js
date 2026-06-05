// @aurora/api/chats/[id] - Single chat operations (SQLite-backed)

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

// GET /api/chats/[id] — get chat with messages
export async function GET(request, { params }) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;

    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(id, userId);
    if (!chat) {
      return NextResponse.json({ error: { message: 'Chat not found' } }, { status: 404 });
    }

    const messages = db.prepare(`
      SELECT * FROM messages WHERE chat_id = ? ORDER BY position ASC
    `).all(id);

    return NextResponse.json({
      id: chat.id,
      title: chat.title,
      modelId: chat.model_id,
      provider: chat.provider,
      messageCount: chat.message_count,
      createdAt: chat.created_at,
      messages: messages.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, model: m.model, provider: m.provider }))
    });
  } catch (error) {
    console.error('Get chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to get chat' } }, { status: 500 });
  }
}

// PATCH /api/chats/[id] — rename or update chat
export async function PATCH(request, { params }) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(id, userId);
    if (!chat) {
      return NextResponse.json({ error: { message: 'Chat not found' } }, { status: 404 });
    }

    if (body.title !== undefined) {
      db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(body.title, id);
    }
    if (body.modelId !== undefined) {
      db.prepare('UPDATE chats SET model_id = ? WHERE id = ?').run(body.modelId, id);
    }
    if (body.provider !== undefined) {
      db.prepare('UPDATE chats SET provider = ? WHERE id = ?').run(body.provider, id);
    }

    return NextResponse.json({ id, title: body.title || chat.title, modelId: body.modelId || chat.model_id, provider: body.provider || chat.provider });
  } catch (error) {
    console.error('Patch chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to update chat' } }, { status: 500 });
  }
}

// DELETE /api/chats/[id] — delete chat
export async function DELETE(request, { params }) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;

    // Foreign key cascade handles messages cleanup
    db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(id, userId);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Delete chat error:', error);
    return NextResponse.json({ error: { message: 'Failed to delete chat' } }, { status: 500 });
  }
}
