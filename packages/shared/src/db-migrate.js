// @aurora/shared — Database migration runner
// Creates all tables if they don't exist. Idempotent — safe to call on every startup.

import { getDb } from './db-client.js';

const SCHEMA = {
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      hashed_password TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `,

  sessions: `
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `,

  api_keys: `
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_rotated TEXT DEFAULT '',
      rotation_count INTEGER DEFAULT 0,
      revoked_at TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(user_id, provider);
  `,

  chats: `
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT DEFAULT 'New Chat',
      model_id TEXT DEFAULT '',
      provider TEXT DEFAULT '',
      message_count INTEGER DEFAULT 0,
      last_message_at TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
    CREATE INDEX IF NOT EXISTS idx_chats_created ON chats(created_at DESC);
  `,

  messages: `
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT DEFAULT '',
      provider TEXT DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      position INTEGER DEFAULT 0,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, position);
  `,

  usage_records: `
    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT DEFAULT '',
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_records(provider, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
  `,

  pricing_cache: `
    CREATE TABLE IF NOT EXISTS pricing_cache (
      provider TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
  `,

  local_model_mappings: `
    CREATE TABLE IF NOT EXISTS local_model_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      local_model_pattern TEXT NOT NULL DEFAULT '*',
      ref_provider TEXT NOT NULL,
      ref_model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, local_model_pattern),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lmm_user ON local_model_mappings(user_id);
  `
};

/**
 * Run all migrations. Idempotent — safe to call on every startup.
 * Returns the list of tables created.
 */
export function runMigrations() {
  const db = getDb();
  const created = [];

  for (const [name, sql] of Object.entries(SCHEMA)) {
    // Check if table already exists
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(name);

    db.exec(sql);

    if (!exists) {
      created.push(name);
      console.log(`[SQLite] Created table: ${name}`);
    }
  }

  // Seed default local model mapping for any users who don't have one
  db.prepare(`
    INSERT OR IGNORE INTO local_model_mappings (user_id, local_model_pattern, ref_provider, ref_model)
    SELECT DISTINCT u.id, '*', 'openai', 'gpt-4o-mini'
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM local_model_mappings lmm WHERE lmm.user_id = u.id AND lmm.local_model_pattern = '*'
    )
  `).run();

  if (created.length > 0) {
    console.log(`[SQLite] Migration complete — ${created.length} new table(s): ${created.join(', ')}`);
  } else {
    console.log('[SQLite] All tables already exist — no migration needed');
  }

  return created;
}

export { SCHEMA };
