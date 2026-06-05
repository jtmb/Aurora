// @aurora/shared — SQLite client singleton (replaces Redis)
// Uses better-sqlite3 for synchronous, zero-config storage.

import { createRequire } from 'module';
import path from 'path';

// Force CJS require to avoid Next.js ESM bundling issues with native addons
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let db = null;

function resolveDbPath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  return path.resolve(process.cwd(), 'aurora.db');
}

/**
 * Get the shared SQLite database instance.
 * Creates it on first call with WAL mode + foreign keys enabled.
 */
export function getDb() {
  if (db) return db;

  const DB_PATH = resolveDbPath();
  console.log('[SQLite] Opening database at:', DB_PATH);
  db = new Database(DB_PATH);

  // Performance & safety
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64 MB

  console.log('[SQLite] Connected to', DB_PATH);
  return db;
}

/**
 * Check if the database is available (always true for SQLite).
 */
export function isDbAvailable() {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the database gracefully.
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[SQLite] Connection closed');
  }
}
