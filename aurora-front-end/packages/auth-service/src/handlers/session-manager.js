// @aurora/auth-service - Session Manager (SQLite-backed)
// Manages user sessions with SQLite persistence and expires_at for TTL.

import { getDb } from '@aurora/shared/db-client';

export class SessionManager {
  constructor(options = {}) {
    this.maxConcurrentSessions = options.maxConcurrentSessions ?? 10;
    this.sessionTtlMinutes = options.sessionTtlMinutes ?? 2880; // 48h
  }

  async createSession(token, userId) {
    const db = getDb();
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (token, user_id, session_data, created_at, last_accessed, expires_at, status)
      VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, 'active')
    `).run(token, userId, JSON.stringify({ id: sessionId, userId }), expiresAt);

    // Clean up expired sessions for this user
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < datetime('now')").run(userId);

    return { sessionId };
  }

  async accessSession(token) {
    const db = getDb();
    const session = db.prepare(`
      SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')
    `).get(token);

    if (!session) throw new Error('Session not found');

    db.prepare(`
      UPDATE sessions SET last_accessed = datetime('now') WHERE token = ?
    `).run(token);

    return true;
  }

  deleteExpiredSessions() {
    const db = getDb();
    const result = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    return result.changes;
  }

  async rotateToken(oldToken) {
    const db = getDb();
    const session = db.prepare(`
      SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')
    `).get(oldToken);

    if (!session) return null;

    const newToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (token, user_id, session_data, created_at, last_accessed, expires_at, status)
      VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, 'active')
    `).run(newToken, session.user_id, session.session_data, expiresAt);

    // Give old token a brief grace period then expire
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '+5 minutes') WHERE token = ?").run(oldToken);

    return { sessionId: crypto.randomUUID(), newToken };
  }

  async invalidateSession(token) {
    const db = getDb();
    db.prepare("UPDATE sessions SET status = 'expired', expires_at = datetime('now') WHERE token = ?").run(token);
    return true;
  }
}
