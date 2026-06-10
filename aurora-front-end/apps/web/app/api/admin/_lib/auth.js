// @aurora/api/admin/_lib/auth — Admin authorization helper
// Reuses the same pattern as getUserId() across existing route handlers

import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

/**
 * Verify that the request has a valid JWT with admin role.
 * Returns { userId, error } — one is always null.
 * Pattern matches existing getUserId() in provider-settings and change-password routes.
 */
export function requireAdmin(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { userId: null, error: { message: 'Unauthorized', status: 401 } };
  }

  let decoded;
  try {
    decoded = authHandler.verifyToken(authHeader.substring(7));
  } catch {
    return { userId: null, error: { message: 'Invalid or expired token', status: 401 } };
  }

  const roles = decoded.roles || [];
  if (!roles.includes('admin')) {
    return { userId: null, error: { message: 'Forbidden — admin access required', status: 403 } };
  }

  return { userId: decoded.userId, error: null };
}
