// @aurora/auth-service - API Key Manager (SQLite-backed)
// Manages user API keys with SQLite persistence.

import crypto from 'crypto';
import { getDb } from '@aurora/shared/db-client';

export class ApiKeyManager {
  constructor(options = {}) {
    const jwtSecret = process.env.JWT_SECRET || 'aurora-fallback-jwt-secret-min-32-chars';
    this.encryptionKey = options.encryptionKey
      || process.env.API_KEY_ENCRYPTION_KEY
      || crypto.createHash('sha256').update(jwtSecret).digest('hex');
    this.keyPrefix = 'ak_';
  }

  async createApiKey(userId, provider, options = {}) {
    const db = getDb();
    const rawKey = options.rawKey || `${this.keyPrefix}${crypto.randomBytes(16).toString('hex')}`;
    const encryptedKey = this._encrypt(rawKey);
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    // Check if user already has a key for this provider — update it
    const existing = db.prepare(`
      SELECT id FROM api_keys WHERE user_id = ? AND provider = ? AND revoked_at = ''
    `).get(userId, provider);

    const keyData = {
      id: existing ? existing.id : keyId,
      userId,
      provider,
      encryptedKey,
      isPrimary: options.isPrimary ? 1 : 0,
      name: options.name || `${provider} API Key`,
      createdAt: new Date().toISOString()
    };

    if (existing) {
      db.prepare(`
        UPDATE api_keys SET encrypted_key = ?, is_primary = ?, name = ?, last_rotated = datetime('now')
        WHERE id = ?
      `).run(encryptedKey, keyData.isPrimary, keyData.name, existing.id);
      return { id: existing.id, rawKey, provider, createdAt: keyData.createdAt, isPrimary: options.isPrimary ?? false, name: keyData.name };
    }

    db.prepare(`
      INSERT INTO api_keys (id, user_id, provider, encrypted_key, is_primary, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(keyId, userId, provider, encryptedKey, keyData.isPrimary, keyData.name, keyData.createdAt);

    return { id: keyId, rawKey, provider, createdAt: keyData.createdAt, isPrimary: options.isPrimary ?? false, name: keyData.name };
  }

  async getPrimaryKey(userId, provider) {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM api_keys WHERE user_id = ? AND provider = ? AND revoked_at = ''
      ORDER BY is_primary DESC LIMIT 1
    `).get(userId, provider);

    if (!row) return null;
    return { ...row, rawKey: this._decrypt(row.encrypted_key), isPrimary: row.is_primary === 1 };
  }

  async listKeys(userId) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM api_keys WHERE user_id = ? AND revoked_at = '' ORDER BY created_at DESC
    `).all(userId);

    return rows
      .map(row => {
        try {
          return {
            id: row.id,
            provider: row.provider,
            name: row.name,
            createdAt: row.created_at,
            isPrimary: row.is_primary === 1,
            rawKey: this._decrypt(row.encrypted_key)
          };
        } catch {
          // Stale/corrupt key — remove it
          db.prepare('DELETE FROM api_keys WHERE id = ?').run(row.id);
          return null;
        }
      })
      .filter(Boolean);
  }

  async rotateKey(keyId, userId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(keyId, userId);
    if (!row) throw new Error('Invalid or unauthorized key');

    const newRawKey = `${this.keyPrefix}${crypto.randomBytes(16).toString('hex')}`;
    db.prepare(`
      UPDATE api_keys SET encrypted_key = ?, last_rotated = datetime('now'), rotation_count = rotation_count + 1
      WHERE id = ?
    `).run(this._encrypt(newRawKey), keyId);

    return { keyId, rawKey: newRawKey, rotationTimestamp: new Date().toISOString() };
  }

  async revokeKey(keyId, userId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(keyId, userId);
    if (!row) throw new Error('Invalid or unauthorized key');

    db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").run(keyId);
    return { revoked: true };
  }

  async deleteKey(keyId, userId) {
    const db = getDb();
    db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(keyId, userId);
    return { deleted: true };
  }

  _encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(this.encryptionKey.slice(0, 32), 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  _decrypt(encrypted) {
    const [ivHex, data] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = Buffer.from(this.encryptionKey.slice(0, 32), 'utf8');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
