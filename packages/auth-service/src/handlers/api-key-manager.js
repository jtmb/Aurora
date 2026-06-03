// @aurora/auth-service - API Key Manager
// Manages user API keys (OAuth, service tokens, provider credentials)
// Handles encryption, rotation, and secure storage

import crypto from 'crypto';

/**
 * ApiKeyManager
 * Securely manages API keys for OAuth integration and service accounts
 */
export class ApiKeyManager {
  constructor(options = {}) {
    this.encryptionKey = options.encryptionKey || 
                         process.env.API_KEY_ENCRYPTION_KEY ||
                         this.generateEncryptionKey();
    
    this.keyPrefix = 'ak_';
    this.storageStrategy = options.storageStrategy ?? 'encrypted_plain'; // encrypted | plain
    
    // In production: Use Redis or database for persistence
    // For now: Use in-memory store (clear on restart)
    this.keys = new Map();
  }

  /**
   * Generate secure random encryption key (run once at startup)
   */
  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create API key for user
   */
  async createApiKey(userId, provider, options = {}) {
    const userIdentity = options.identity || 'api_key';
    
    // Generate secure random key material
    let rawKey;
    
    if (provider === 'ollama' && options.fromModel) {
      // Ollama model-based auth: generate from model hash
      rawKey = this.generateModelBasedKey(options.fromModel);
    } else {
      // Random API key (24 chars hex)
      const bytes = crypto.randomBytes(16);
      rawKey = `${userIdentity}_key_` + bytes.toString('hex');
    }

    // Encrypt the key for storage
    const encryptedKey = this.encrypt(rawKey);

    // Store key metadata and value
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    
    this.keys.set(keyId, {
      id: keyId,
      userId,
      provider,
      rawKey,           // Encrypted storage uses decrypted value
      encryptedKey,     // For backup/audit purposes
      isPrimary: options.isPrimary ?? false,
      name: options.name || `${provider} API Key`,
      createdAt: new Date().toISOString(),
      lastRotated: null,
      revokedAt: null,
      rotationCount: 0,
      allowedIpRanges: options.allowedIpRanges || [],
      rateLimitMs: options.rateLimitMs ?? 5 * 60 * 1000 // Default 5 min per request
    });

    // Return plaintext key only once (for first use)
    return {
      id: keyId,
      rawKey,
      provider,
      createdAt: new Date().toISOString(),
      isPrimary: options.isPrimary ?? false,
      name: options.name || ''
    };
  }

  /**
   * Rotate (cycle) existing API key securely
   */
  async rotateKey(keyId, userId, options = {}) {
    const oldKey = this.keys.get(keyId);
    
    if (!oldKey || oldKey.userId !== userId) {
      throw new Error('Invalid or unauthorized key');
    }

    if (oldKey.revokedAt && !options.force) {
      throw new Error('Cannot rotate revoked key. Force rotation to override.');
    }

    // Generate new key material
    const provider = oldKey.provider;
    
    // For Ollama: generate from model hash for consistent key
    if (provider === 'ollama' && options.fromModel) {
      const newRawKey = this.generateModelBasedKey(options.fromModel);
    } else {
      const bytes = crypto.randomBytes(16);
      const newRawKey = `${oldKey.identity || 'api_key'}_key_${bytes.toString('hex')}`;
    }

    // Encrypt and store new key
    const encryptedKey = this.encrypt(newRawKey);
    
    oldKey.rawKey = newRawKey;
    oldKey.encryptedKey = encryptedKey;
    oldKey.lastRotated = new Date().toISOString();
    oldKey.rotationCount++;

    return {
      keyId: keyId,
      rawKey: newRawKey,
      rotationTimestamp: new Date().toISOString(),
      isSame: false
    };
  }

  /**
   * Generate consistent key for Ollama model-based authentication
   */
  generateModelBasedKey(modelName) {
    // Hash model name to create consistent auth token
    const hash = crypto.createHash('sha256')
      .update(`${modelName}:${process.env.OLLAMA_API_KEY || ''}`)
      .digest('hex')
      .substring(0, 32);

    return `ollama_auth_${hash}`;
  }

  /**
   * Get primary API key for user's provider
   */
  getPrimaryKey(userId, provider) {
    const providerKeys = Array.from(this.keys.values())
      .filter(k => k.userId === userId && k.provider === provider);

    // Return primary if exists, otherwise first available
    return providerKeys.find(k => k.isPrimary) || 
           providerKeys.find(k => !k.revokedAt) || null;
  }

  /**
   * Revoke API key (invalidate immediately)
   */
  async revokeKey(keyId, userId) {
    const key = this.keys.get(keyId);
    
    if (!key || key.userId !== userId) {
      throw new Error('Invalid or unauthorized key');
    }

    key.revokedAt = new Date().toISOString();
    
    // Clear from active set to prevent use
    this.keys.delete(keyId);

    return { revoked: true };
  }

  /**
   * List all API keys for user (optionally with plaintext for authorized)
   */
  async listKeys(userId, includeRaw = false) {
    const keys = Array.from(this.keys.values())
      .filter(k => k.userId === userId);

    return keys.map(k => ({
      id: k.id,
      provider: k.provider,
      name: k.name,
      createdAt: k.createdAt,
      lastRotated: k.lastRotated ?? null,
      rotationCount: k.rotationCount,
      revokedAt: k.revokedAt ? new Date(k.revokedAt).toLocaleDateString() : null,
      isPrimary: k.isPrimary
    }));
  }

  /**
   * Delete API key from storage
   */
  async deleteKey(keyId, userId) {
    const key = this.keys.get(keyId);
    
    if (!key || key.userId !== userId) {
      throw new Error('Invalid or unauthorized key');
    }

    this.keys.delete(keyId);
    return { deleted: true };
  }

  /**
   * Update API key properties
   */
  async updateKey(keyId, userId, updates) {
    const key = this.keys.get(keyId);
    
    if (!key || key.userId !== userId) {
      throw new Error('Invalid or unauthorized key');
    }

    // Allow certain updates without rotation
    const allowedUpdates = ['name', 'allowedIpRanges', 'rateLimitMs'];
    
    for (const [field, value] of Object.entries(updates)) {
      if (allowedUpdates.includes(field)) {
        key[field] = value;
      }
    }

    return true;
  }

  /**
   * Encrypt value using AES-256-CBC
   */
  encrypt(value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV + encrypted data (32-char IV + 96-char hex = 128 chars)
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt encrypted value
   */
  decrypt(encrypted) {
    const [ivHex, encryptedHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

export default ApiKeyManager;