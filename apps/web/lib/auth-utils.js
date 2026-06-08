// @aurora/web - Shared authentication utilities
// Used by API routes to extract user identity from JWT tokens.

import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

/**
 * Extract userId from the Authorization header of a request.
 * Returns null if no valid JWT is present.
 */
export function getUserId(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      return authHandler.verifyToken(authHeader.substring(7)).userId;
    } catch {
      return null;
    }
  }
  // Internal server-to-server calls from the agent runner pass user ID via this header
  const internalUserId = request.headers.get('x-internal-user-id');
  if (internalUserId) return internalUserId;
  return null;
}

/**
 * Require authentication. Returns { userId } or sends a 401 JSON response.
 * Usage:
 *   const auth = requireAuth(request);
 *   if (auth.error) return auth.error;  // 401 response
 *   const { userId } = auth;
 */
export function requireAuth(request) {
  const userId = getUserId(request);
  if (!userId) {
    // Dynamically import NextResponse to avoid bundling issues
    const { NextResponse } = require('next/server');
    return { error: NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 }) };
  }
  return { userId };
}
