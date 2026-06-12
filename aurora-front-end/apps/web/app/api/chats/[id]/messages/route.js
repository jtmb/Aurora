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

    // Auto-create chat if it doesn't exist (handles docs_xxx_chat format IDs, etc.)
    const chatExists = db.prepare('SELECT id FROM chats WHERE id = ?').get(id);
    if (!chatExists) {
      const chatTitle = body.chatTitle || 'Workspace Chat';
      db.prepare(`
        INSERT INTO chats (id, user_id, title, model_id, provider, message_count, workspace_id, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `).run(id, userId, chatTitle, body.model || '', body.provider || '', body.workspaceId || '', timestamp);
    }

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

// DELETE /api/chats/[id]/messages — clear all messages from a chat (optionally trim after beforeId)
export async function DELETE(request, { params }) {
  try {
    runMigrations();
    const db = getDb();
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const { id } = await params;

    // Verify chat exists and belongs to user
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(id, userId);
    if (!chat) {
      return NextResponse.json({ error: { message: 'Chat not found' } }, { status: 404 });
    }

    // Check for optional beforeId body parameter — trim messages after this ID
    const body = await request.json().catch(() => ({}));
    const { beforeId } = body;

    if (beforeId) {
      // Find the position of the beforeId message
      const targetMsg = db.prepare('SELECT position FROM messages WHERE id = ? AND chat_id = ?').get(beforeId, id);
      if (targetMsg) {
        // Delete messages with position > target position
        const result = db.prepare('DELETE FROM messages WHERE chat_id = ? AND position > ?').run(id, targetMsg.position);
        // Update message count
        const remaining = db.prepare('SELECT COUNT(*) as count FROM messages WHERE chat_id = ?').get(id);
        db.prepare('UPDATE chats SET message_count = ? WHERE id = ?').run(remaining.count, id);
        return NextResponse.json({ success: true, deleted: result.changes, message: `Trimmed messages after ${beforeId}` });
      }
      return NextResponse.json({ error: { message: 'beforeId message not found' } }, { status: 404 });
    }

    // Delete all messages for this chat
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
    // Delete usage records
    db.prepare('DELETE FROM usage_records WHERE chat_id = ?').run(id);
    // Reset chat counters
    db.prepare('UPDATE chats SET message_count = 0, last_message_at = NULL WHERE id = ?').run(id);

    return NextResponse.json({ success: true, message: 'All messages cleared' });
  } catch (error) {
    console.error('Delete messages error:', error);
    return NextResponse.json({ error: { message: 'Failed to clear messages' } }, { status: 500 });
  }
}
