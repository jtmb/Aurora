// @aurora/shared — Redis client singleton with graceful fallback
// Provides a shared ioredis instance across all packages.
// Falls back to null (in-memory) if Redis is unavailable.

import Redis from 'ioredis';

let redis = null;
let redisAvailable = false;

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'aurora:',
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 5000
};

/**
 * Initialize Redis connection. Safe to call multiple times — returns cached instance.
 */
export function getRedis() {
  if (redis) return redis;
  
  try {
    redis = new Redis(REDIS_CONFIG);
    
    redis.on('connect', () => {
      redisAvailable = true;
      console.log('[Redis] Connected to', REDIS_CONFIG.host + ':' + REDIS_CONFIG.port);
    });
    
    redis.on('error', (err) => {
      redisAvailable = false;
      console.warn('[Redis] Connection error (falling back to in-memory):', err.message);
    });
    
    redis.on('close', () => {
      redisAvailable = false;
    });
    
  } catch (err) {
    console.warn('[Redis] Failed to initialize (falling back to in-memory):', err.message);
    redis = null;
    redisAvailable = false;
  }
  
  return redis;
}

/**
 * Check if Redis is currently connected and available.
 * Auto-initializes the client if not yet created (lazy init).
 * ioredis queues commands during connection and replays them — so if the client
 * exists and isn't in a terminal state, it's safe to use.
 */
export function isRedisAvailable() {
  if (!redis) getRedis();
  if (!redis) return false;
  const terminal = ['end', 'close'];
  return !terminal.includes(redis.status);
}

/**
 * Gracefully close Redis connection (call on app shutdown)
 */
export async function closeRedis() {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
    redisAvailable = false;
  }
}
