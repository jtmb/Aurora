// @aurora/shared — Database migration runner
// Creates all tables if they don't exist. Idempotent — safe to call on every startup.

import { getDb } from './db-client.js';

// Guard: only run startup-time marking once per process lifetime.
// runMigrations() is called on every API request, but marking running→interrupted
// should only happen once on server boot.
let _startupMarkDone = false;

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
      workspace_id TEXT DEFAULT '',
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
      thinking TEXT NOT NULL DEFAULT '',
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
  `,

  provider_settings: `
    CREATE TABLE IF NOT EXISTS provider_settings (
      user_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `,

  agent_jobs: `
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      model TEXT DEFAULT '',
      provider TEXT DEFAULT '',
      thinking_effort TEXT DEFAULT 'high',
      agent_mode TEXT DEFAULT 'agent',
      user_request TEXT DEFAULT '',
      plan_todos TEXT DEFAULT '[]',
      plan_summary TEXT DEFAULT '',
      iteration INTEGER DEFAULT 0,
      conversation TEXT DEFAULT '[]',
      file_manifest TEXT DEFAULT '[]',
      api_keys TEXT DEFAULT '{}',
      error_message TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_workspace ON agent_jobs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status);
  `,

  user_model_access: `
    CREATE TABLE IF NOT EXISTS user_model_access (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider, model_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_uma_user ON user_model_access(user_id);
    CREATE INDEX IF NOT EXISTS idx_uma_user_provider ON user_model_access(user_id, provider);
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

  // Migrate existing chats table: add workspace_id column (new in 2026-06)
  try {
    db.exec(`ALTER TABLE chats ADD COLUMN workspace_id TEXT DEFAULT ''`);
    console.log('[SQLite] Added workspace_id column to chats (migration)');
  } catch {
    // Column already exists — safe to ignore
  }

  // Migrate existing messages table: add thinking column (new in 2026-06)
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN thinking TEXT NOT NULL DEFAULT ''`);
    console.log('[SQLite] Added thinking column to messages (migration)');
  } catch {
    // Column already exists — safe to ignore
  }

  // Create workspace index if it doesn't exist (must run after column migration)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_workspace ON chats(workspace_id)`);
  } catch {
    // Already exists — safe to ignore
  }

  // Migrate usage_records: add cache hit columns (new in 2026-06)
  try {
    db.exec(`ALTER TABLE usage_records ADD COLUMN prompt_cache_hit_tokens INTEGER DEFAULT 0`);
    console.log('[SQLite] Added prompt_cache_hit_tokens column to usage_records (migration)');
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE usage_records ADD COLUMN prompt_cache_miss_tokens INTEGER DEFAULT 0`);
    console.log('[SQLite] Added prompt_cache_miss_tokens column to usage_records (migration)');
  } catch {
    // Column already exists — safe to ignore
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

  // Auto-restart: mark OLD running jobs as 'interrupted' so they can be resumed.
  // Only mark jobs that haven't been updated in the last 60 seconds —
  // this prevents killing jobs that were just started (e.g., during tests).
  // Only runs ONCE per process lifetime.
  if (!_startupMarkDone) {
    _startupMarkDone = true;
    try {
      const staleJobs = db.prepare(
        "SELECT id, workspace_id FROM agent_jobs WHERE status = 'running' AND updated_at < datetime('now', '-60 seconds')"
      ).all();
      if (staleJobs.length > 0) {
        console.log(`[SQLite] Found ${staleJobs.length} stale agent job(s) — marking interrupted for restart`);
        db.prepare(
          "UPDATE agent_jobs SET status = 'interrupted', updated_at = datetime('now') WHERE status = 'running' AND updated_at < datetime('now', '-60 seconds')"
        ).run();
      }
    } catch {
      // agent_jobs table might not exist yet — safe to ignore
    }
  }
  try {
    db.exec(`ALTER TABLE agent_jobs ADD COLUMN api_keys TEXT DEFAULT '{}'`);
    console.log('[SQLite] Added api_keys column to agent_jobs (migration)');
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE agent_jobs ADD COLUMN pending_question TEXT DEFAULT ''`);
    console.log('[SQLite] Added pending_question column to agent_jobs (migration)');
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE agent_jobs ADD COLUMN user_id TEXT DEFAULT ''`);
    console.log('[SQLite] Added user_id column to agent_jobs (migration)');
  } catch {
    // Column already exists — safe to ignore
  }

  // Bootstrap admin user from env var (idempotent)
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const result = db.prepare(
        "UPDATE users SET role = 'admin' WHERE email = ? AND role != 'admin'"
      ).run(adminEmail);
      if (result.changes > 0) {
        console.log(`[SQLite] Promoted ${adminEmail} to admin role`);
      }
    } catch (err) {
      console.error('[SQLite] Admin bootstrap failed:', err.message);
    }
  }

  if (created.length > 0) {
    console.log(`[SQLite] Migration complete — ${created.length} new table(s): ${created.join(', ')}`);
  } else {
    console.log('[SQLite] All tables already exist — no migration needed');
  }

  return created;
}

export { SCHEMA };
