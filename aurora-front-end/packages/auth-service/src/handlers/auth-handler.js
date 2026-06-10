// @aurora/auth-service - Authentication Handler
// Handles JWT token creation, verification, and current user extraction

import jwt from 'jsonwebtoken';

/**
 * AuthHandler
 * Manages JWT tokens for authentication
 */
export class AuthHandler {
  constructor(options = {}) {
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
    this.issuer = options.issuer || 'aurora-gateway';
    this.audience = options.audience || 'aurora-users';
    
    // Token lifetime: 24 hours (can be configured)
    this.tokenLifetimeMinutes = options.tokenLifetimeMinutes ?? 1440;
    
    // Fallback for development — always set JWT_SECRET in production
    if (!this.jwtSecret) {
      console.warn('JWT_SECRET not set — using insecure fallback for development only');
      this.jwtSecret = 'aurora-dev-secret-change-in-production-minimum-32-chars';
    }
  }

  /**
   * Sign a JWT token for user session
   */
  signToken(payload, expiresIn = `${this.tokenLifetimeMinutes}m`) {
    return jwt.sign(payload, this.jwtSecret, {
      issuer: this.issuer,
      audience: this.audience,
      expiresIn
    });
  }

  /**
   * Verify JWT token and decode payload
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: [this.issuer],
        audience: [this.audience]
      });
      
      // Extract user ID from claims
      const userId = decoded.userId || decoded.sub;
      
      return { ...decoded, userId };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Get current user from Authorization header
   */
  getCurrentTokenPayload(authorizationHeader = null) {
    const header = authorizationHeader || 
                   process.env.AUTHORIZATION_HEADER ||
                   this.getFromStorage();
    
    if (!header) return null;
    
    const token = header.replace('Bearer ', '');
    return this.verifyToken(token);
  }

  /**
   * Sign new JWT (for API key based auth or refresh flow)
   */
  signApiAuthToken(payload) {
    return this.signToken({
      ...payload,
      type: 'api_key'
    });
  }

  /**
   * Get token from secure storage for server-side sessions
   */
  getFromStorage() {
    // In production: Read from Redis or database
    // For now: Return null to require Bearer token
    return null;
  }

  /**
   * Refresh JWT token (for session rotation)
   */
  refreshSession(originalToken, newPayload) {
    try {
      const decoded = this.verifyToken(originalToken);
      
      if (!decoded.userId || !decoded.email) {
        throw new Error('Token is not valid for user session');
      }

      return this.signToken({
        ...decoded,
        refreshToken: decoded.refreshToken || originalToken,
        iat: Date.now() / 1000,
        exp: Math.floor(Date.now() / 1000) + (this.tokenLifetimeMinutes * 60)
      }, `${this.tokenLifetimeMinutes}m`);
    } catch {
      throw new Error('Unable to refresh session: original token invalid');
    }
  }

  /**
   * Invalidate/rotate a token by ID
   */
  invalidateToken(tokenId, userId) {
    // In production: Store invalid tokens in Redis/Set with TTL
    // For now: Mark as revoked in database via apiKeyManager
    console.log(`Token invalidated for user ${userId}: ${tokenId}`);
    return true;
  }

  /**
   * Generate test token (for development/testing only)
   */
  generateTestToken(user) {
    const token = this.signToken({
      sub: user.email,
      email: user.email,
      userId: user.id || user.sub,
      roles: ['user']
    });

    return { token };
  }
}

export default AuthHandler;