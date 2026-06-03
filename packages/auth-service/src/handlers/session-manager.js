// @aurora/auth-service - Session Manager
// Manages user sessions, token refresh, and concurrent request limiting

/**
 * SessionManager
 * Handles session lifecycle for authenticated users
 */
export class SessionManager {
  constructor(options = {}) {
    this.maxConcurrentSessions = options.maxConcurrentSessions ?? 10;
    this.sessionTtlMinutes = options.sessionTtlMinutes ?? 2880; // 30 days default
    
    // In production: Use Redis or database for session storage
    // For now: Use in-memory store (clear on restart)
    this.sessions = new Map();
    
    // Track concurrent requests per session
    this.requestCounters = new Map();
  }

  /**
   * Create a new session for authenticated user
   */
  async createSession(token) {
    const sessionKey = `session:${token}`;
    
    if (this.sessions.has(sessionKey)) {
      // Session already exists - rotate tokens
      return this.rotateToken(sessionKey);
    }

    // Create new session record
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionKey, {
      id: sessionId,
      token,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      status: 'active'
    });

    return { sessionId };
  }

  /**
   * Access session (update last accessed time)
   */
  async accessSession(token) {
    const key = `session:${token}`;
    
    const session = this.sessions.get(key);
    if (!session) {
      throw new Error('Session not found');
    }

    session.lastAccessed = Date.now();
    session.requestCounters.set(session.id, (session.requestCounters.get(session.id) || 0) + 1);

    return true;
  }

  /**
   * Delete expired sessions (called periodically in production)
   */
  deleteExpiredSessions() {
    const now = Date.now();
    const ttlMs = this.sessionTtlMinutes * 60 * 1000;

    for (const [key, session] of this.sessions.entries()) {
      if (now - session.createdAt > ttlMs || 
          (session.status === 'expired')) {
        this.sessions.delete(key);
      }
    }

    return this.sessions.size;
  }

  /**
   * Rotate token (invalidate old, create new)
   */
  async rotateToken(sessionKey) {
    // Get original session
    const original = this.sessions.get(sessionKey);
    if (!original) return null;

    // Create new session with same ID for continuity
    const newSession = { ...original };
    newSession.token = crypto.randomUUID();
    newSession.createdAt = Date.now();
    newSession.lastAccessed = Date.now();
    
    this.sessions.set(sessionKey, newSession);

    // In production: Store old token in Redis with TTL for graceful rotation
    return {
      sessionId: newSession.id,
      newToken: newSession.token
    };
  }

  /**
   * Check if session has exceeded concurrent request limit
   */
  async checkConcurrentLimit(sessionId) {
    const key = `session:${sessionId}`;
    const sessionsEntry = this.sessions.get(key);

    if (!sessionsEntry || !this.requestCounters.has(sessionsEntry.id)) {
      return false; // No concurrent limit for first request
    }

    const currentCount = this.requestCounters.get(sessionsEntry.id);
    
    // Allow burst of 2 requests within TTL window, then enforce limit
    if (currentCount > 1 && currentCount >= this.maxConcurrentSessions) {
      return true;
    }

    return false;
  }

  /**
   * Cleanup session counters periodically
   */
  cleanupOldRequests() {
    const now = Date.now();
    const windowMs = 30 * 60 * 1000; // Keep for 30 mins

    for (const [sessionId, count] of this.requestCounters.entries()) {
      if (now - sessionId.timestamp > windowMs) {
        this.requestCounters.delete(sessionId);
      }
    }
  }
}

export default SessionManager;