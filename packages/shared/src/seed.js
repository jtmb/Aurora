// @aurora/shared — Seed demo data on Redis connect
// Ensures demo@example.com user exists so existing login flow works.

import bcrypt from 'bcryptjs';
import { getRedis, isRedisAvailable } from './redis-client.js';
import { KEYS } from './redis-keys.js';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'password';
const DEMO_USER_ID = 'demo-user-id';

/**
 * Seed demo user if it doesn't exist in Redis.
 * Called automatically when Redis connects.
 */
export async function seedDemoUser() {
  const redis = getRedis();
  if (!redis) return;
  
  try {
    // Wait for connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Redis connect timeout')), 5000);
      redis.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      if (redis.status === 'ready') {
        clearTimeout(timeout);
        resolve();
      }
    });
    
    const exists = await redis.exists(KEYS.USER_BY_EMAIL(DEMO_EMAIL));
    if (exists) {
      console.log('[Seed] Demo user already exists');
      return;
    }
    
    const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
    
    const userData = {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      hashedPassword,
      name: 'Demo User',
      role: 'user',
      createdAt: new Date().toISOString()
    };
    
    // Store user by email (for login lookup) and by ID (for session lookup)
    await redis.hset(KEYS.USER_BY_EMAIL(DEMO_EMAIL), userData);
    await redis.hset(KEYS.USER_BY_ID(DEMO_USER_ID), userData);
    
    console.log('[Seed] Demo user created:', DEMO_EMAIL);
  } catch (err) {
    console.warn('[Seed] Could not seed demo user (Redis may not be ready):', err.message);
  }
}
