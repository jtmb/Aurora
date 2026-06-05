// @aurora/shared - Shared Package Entry Point
// Exports common utilities, config, and constants used across all services

export * from './types';
export { formatDate, formatDuration, truncateText } from './utils';
export { getDb, isDbAvailable, closeDb } from './db-client';
export { runMigrations, SCHEMA } from './db-migrate';
