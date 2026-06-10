// @aurora/api/workspace/[id]/delete - Delete a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../lib/auth-utils';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }
    
    const wsDir = validateWorkspace(id, userId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    // Remove the entire workspace directory
    fs.rmSync(wsDir, { recursive: true, force: true });

    // ── Clean up all database records for this workspace ──
    try {
      runMigrations();
      const db = getDb();

      // Get all chat IDs for this workspace
      const chats = db.prepare('SELECT id FROM chats WHERE workspace_id = ?').all(id);
      const chatIds = chats.map(c => c.id);

      // Delete messages for all workspace chats
      for (const chatId of chatIds) {
        db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
        db.prepare('DELETE FROM usage_records WHERE chat_id = ?').run(chatId);
      }

      // Delete the chats themselves
      db.prepare('DELETE FROM chats WHERE workspace_id = ?').run(id);

      // Delete agent jobs
      db.prepare('DELETE FROM agent_jobs WHERE workspace_id = ?').run(id);

      console.log(`[workspace/delete] Cleaned up DB records for workspace "${id}": ${chats.length} chats, ${chatIds.length} message sets`);
    } catch (dbErr) {
      // DB cleanup is best-effort — workspace dir is already gone
      console.error('[workspace/delete] DB cleanup error:', dbErr.message);
    }
    
    return NextResponse.json({ success: true, message: 'Workspace deleted' });
  } catch (error) {
    console.error('[workspace/delete] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to delete workspace' } }, { status: 500 });
  }
}
