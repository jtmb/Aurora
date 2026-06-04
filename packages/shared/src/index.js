// @aurora/shared - Shared Package Entry Point
// Exports common utilities, config, and constants used across all services

export * from './types';
export { formatDate, formatDuration, truncateText } from './utils';
export { getRedis, isRedisAvailable, closeRedis } from './redis-client';
export { KEYS, TTL } from './redis-keys';
export { seedDemoUser } from './seed';