// @aurora/auth-service - Authentication Service Entry Point
// Provides secure authentication, session management, and API key handling

import { AuthHandler } from './handlers/auth-handler';
import { SessionManager } from './handlers/session-manager';
import { ApiKeyManager } from './handlers/api-key-manager';

/**
 * AuthService - Main authentication service
 */
export class AuthService {
  constructor(options = {}) {
    this.authHandler = new AuthHandler({
      jwtSecret: options.jwtSecret || process.env.JWT_SECRET,
      issuer: options.issuer || 'aurora-gateway',
      audience: options.audience || 'aurora-users'
    });

    this.sessionManager = new SessionManager();
    this.apiKeyManager = new ApiKeyManager();
  }

  /**
   * Authenticate a user (login)
   */
  async authenticate(credentials) {
    const { email, password } = credentials;

    // Verify user exists and validate credentials
    await this.validateUser(email, password);

    // Generate JWT token
    const token = this.authHandler.signToken({
      sub: email,
      email: credentials.email,
      userId: this.apiKeyManager.getUserIdByApiKey(credentials.apiKey),
      roles: ['user']
    });

    // Create session record
    await this.sessionManager.createSession(token);

    return { token };
  }

  /**
   * Validate user credentials (placeholder for real auth)
   */
  async validateUser(email, password) {
    // In production: Query database for user and verify password hash
    const hashedPassword = process.env.HASHED_PASSWORD_FOR_TEST_USER; // Placeholder
    
    if (!hashedPassword || password !== hashedPassword) {
      throw new Error('Invalid credentials');
    }

    return { email };
  }

  /**
   * Verify token signature and decode payload
   */
  async verifyToken(token) {
    const decoded = this.authHandler.verifyToken(token);
    
    if (!decoded || !decoded.sub) {
      throw new Error('Invalid or expired token');
    }

    return decoded;
  }

  /**
   * Get current user from auth context
   */
  getCurrentUser() {
    return this.authHandler.getCurrentTokenPayload();
  }

  /**
   * Get API key manager for key operations
   */
  getApiKeyManager() {
    return this.apiKeyManager;
  }
}

export default AuthService;