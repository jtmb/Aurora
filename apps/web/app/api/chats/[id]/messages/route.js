// @aurora/api/chats/[id]/messages - Messages within a chat (SQLite-backed)

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

// GET /api/chats/[id]/messages — get all messages for a chat
export async function GET(request, { params }) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;

    const messages = db.prepare(`
      SELECT * FROM messages WHERE chat_id = ? ORDER BY position ASC
    `).all(id);

    return NextResponse.json({
      messages: messages.map(m => ({ id: m.id, role: m.role, content: m.content, thinking: m.thinking || '', timestamp: m.timestamp, model: m.model, provider: m.provider }))
    });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json({ messages: [], error: error.message });
  }
}

// POST /api/chats/[id]/messages — append a message to a chat
export async function POST(request, { params }) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const messageId = body.id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = body.timestamp || new Date().toISOString();

    // Get next position
    const lastMsg = db.prepare('SELECT MAX(position) as maxPos FROM messages WHERE chat_id = ?').get(id);
    const position = (lastMsg?.maxPos ?? -1) + 1;

    const thinking = body.thinking || '';

    db.prepare(`
      INSERT INTO messages (id, chat_id, role, content, thinking, model, provider, timestamp, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, id, body.role || 'user', body.content || '', thinking, body.model || '', body.provider || '', timestamp, position);

    // Update chat metadata
    db.prepare(`
      UPDATE chats SET last_message_at = ?, message_count = message_count + 1 WHERE id = ?
    `).run(timestamp, id);

    const message = { id: messageId, role: body.role || 'user', content: body.content || '', thinking, timestamp, model: body.model || '', provider: body.provider || '' };

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    console.error('Add message error:', error);
    return NextResponse.json({ error: { message: 'Failed to add message' } }, { status: 500 });
  }
}
