// @aurora/auth-service - Session Manager (Redis-backed)
// Manages user sessions with Redis persistence and native TTL.
// Falls back to in-memory Map if Redis is unavailable.

import { getRedis, isRedisAvailable } from '@aurora/shared/redis-client';
import { KEYS, TTL } from '@aurora/shared/redis-keys';

export class SessionManager {
  constructor(options = {}) {
    this.maxConcurrentSessions = options.maxConcurrentSessions ?? 10;
    this.sessionTtlMinutes = options.sessionTtlMinutes ?? 2880;
    this.sessionTtlSeconds = this.sessionTtlMinutes * 60;
    this.sessions = new Map();
  }

  _getStorage() {
    return isRedisAvailable() ? 'redis' : 'memory';
  }

  async createSession(token, userId) {
    const sessionKey = KEYS.SESSION(token);
    const sessionData = {
      id: crypto.randomUUID(),
      userId: userId || 'unknown',
      token,
      createdAt: Date.now().toString(),
      lastAccessed: Date.now().toString(),
      status: 'active'
    };

    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      await redis.hset(sessionKey, sessionData);
      await redis.expire(sessionKey, TTL.SESSION);
    } else {
      const mapKey = `session:${token}`;
      if (this.sessions.has(mapKey)) return this.rotateToken(mapKey);
      this.sessions.set(mapKey, sessionData);
    }
    return { sessionId: sessionData.id };
  }

  async accessSession(token) {
    const sessionKey = KEYS.SESSION(token);
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      const exists = await redis.exists(sessionKey);
      if (!exists) throw new Error('Session not found');
      await redis.hset(sessionKey, 'lastAccessed', Date.now().toString());
      return true;
    }
    const session = this.sessions.get(`session:${token}`);
    if (!session) throw new Error('Session not found');
    session.lastAccessed = Date.now();
    return true;
  }

  deleteExpiredSessions() {
    if (this._getStorage() === 'redis') return 0;
    const now = Date.now();
    const ttlMs = this.sessionTtlMinutes * 60 * 1000;
    for (const [key, session] of this.sessions.entries()) {
      if (now - parseInt(session.createdAt) > ttlMs || session.status === 'expired') {
        this.sessions.delete(key);
      }
    }
    return this.sessions.size;
  }

  async rotateToken(oldToken) {
    const oldKey = KEYS.SESSION(oldToken);
    let sessionData;
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      sessionData = await redis.hgetall(oldKey);
      if (!sessionData || Object.keys(sessionData).length === 0) return null;
    } else {
      sessionData = this.sessions.get(`session:${oldToken}`);
      if (!sessionData) return null;
    }
    
    const newToken = crypto.randomUUID();
    const newSession = { ...sessionData, token: newToken, createdAt: Date.now().toString(), lastAccessed: Date.now().toString() };
    
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      const newKey = KEYS.SESSION(newToken);
      await redis.hset(newKey, newSession);
      await redis.expire(newKey, TTL.SESSION);
      await redis.expire(oldKey, TTL.TOKEN_GRACE);
    } else {
      this.sessions.set(`session:${newToken}`, newSession);
    }
    return { sessionId: newSession.id, newToken };
  }

  async invalidateSession(token) {
    const sessionKey = KEYS.SESSION(token);
    if (this._getStorage() === 'redis') {
      await getRedis().del(sessionKey);
    } else {
      this.sessions.delete(`session:${token}`);
    }
    return true;
  }
}
