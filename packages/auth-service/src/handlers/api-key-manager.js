// @aurora/auth-service - API Key Manager (Redis-backed)
// Manages user API keys with Redis persistence + in-memory fallback.

import crypto from 'crypto';
import { getRedis, isRedisAvailable } from '@aurora/shared/redis-client';
import { KEYS, TTL } from '@aurora/shared/redis-keys';

export class ApiKeyManager {
  constructor(options = {}) {
    this.encryptionKey = options.encryptionKey || process.env.API_KEY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    this.keyPrefix = 'ak_';
    this.keys = new Map();
  }

  _getStorage() { return isRedisAvailable() ? 'redis' : 'memory'; }

  async createApiKey(userId, provider, options = {}) {
    const bytes = crypto.randomBytes(16);
    const rawKey = `${this.keyPrefix}${bytes.toString('hex')}`;
    const encryptedKey = this._encrypt(rawKey);
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    
    const keyData = {
      id: keyId, userId, provider, encryptedKey,
      isPrimary: options.isPrimary ? '1' : '0',
      name: options.name || `${provider} API Key`,
      createdAt: new Date().toISOString(),
      lastRotated: '', rotationCount: '0', revokedAt: ''
    };

    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      await redis.hset(KEYS.API_KEY(keyId), keyData);
      await redis.expire(KEYS.API_KEY(keyId), TTL.API_KEY);
      await redis.sadd(KEYS.USER_API_KEYS(userId), keyId);
    } else {
      this.keys.set(keyId, { ...keyData, rawKey });
    }
    return { id: keyId, rawKey, provider, createdAt: keyData.createdAt, isPrimary: options.isPrimary ?? false, name: keyData.name };
  }

  async getPrimaryKey(userId, provider) {
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      const keyIds = await redis.smembers(KEYS.USER_API_KEYS(userId));
      for (const keyId of keyIds) {
        const data = await redis.hgetall(KEYS.API_KEY(keyId));
        if (data && data.provider === provider && !data.revokedAt) {
          return { ...data, rawKey: this._decrypt(data.encryptedKey) };
        }
      }
      return null;
    }
    const keys = Array.from(this.keys.values()).filter(k => k.userId === userId && k.provider === provider);
    return keys.find(k => k.isPrimary === '1') || keys.find(k => !k.revokedAt) || null;
  }

  async listKeys(userId) {
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      const keyIds = await redis.smembers(KEYS.USER_API_KEYS(userId));
      const keys = [];
      for (const keyId of keyIds) {
        const data = await redis.hgetall(KEYS.API_KEY(keyId));
        if (data && Object.keys(data).length > 0) {
          keys.push({ id: data.id, provider: data.provider, name: data.name, createdAt: data.createdAt, isPrimary: data.isPrimary === '1' });
        }
      }
      return keys;
    }
    return Array.from(this.keys.values()).filter(k => k.userId === userId).map(k => ({ id: k.id, provider: k.provider, name: k.name, createdAt: k.createdAt, isPrimary: k.isPrimary === '1' }));
  }

  async rotateKey(keyId, userId) {
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      const data = await redis.hgetall(KEYS.API_KEY(keyId));
      if (!data || data.userId !== userId) throw new Error('Invalid or unauthorized key');
      const bytes = crypto.randomBytes(16);
      const newRawKey = `${this.keyPrefix}${bytes.toString('hex')}`;
      await redis.hset(KEYS.API_KEY(keyId), { encryptedKey: this._encrypt(newRawKey), lastRotated: new Date().toISOString(), rotationCount: (parseInt(data.rotationCount || '0') + 1).toString() });
      return { keyId, rawKey: newRawKey, rotationTimestamp: new Date().toISOString() };
    }
    const key = this.keys.get(keyId);
    if (!key || key.userId !== userId) throw new Error('Invalid or unauthorized key');
    const bytes = crypto.randomBytes(16);
    const newRawKey = `${this.keyPrefix}${bytes.toString('hex')}`;
    key.rawKey = newRawKey;
    key.encryptedKey = this._encrypt(newRawKey);
    key.lastRotated = new Date().toISOString();
    key.rotationCount = (parseInt(key.rotationCount || '0') + 1).toString();
    return { keyId, rawKey: newRawKey, rotationTimestamp: key.lastRotated };
  }

  async revokeKey(keyId, userId) {
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      const data = await redis.hgetall(KEYS.API_KEY(keyId));
      if (!data || data.userId !== userId) throw new Error('Invalid or unauthorized key');
      await redis.hset(KEYS.API_KEY(keyId), 'revokedAt', new Date().toISOString());
      await redis.srem(KEYS.USER_API_KEYS(userId), keyId);
      return { revoked: true };
    }
    const key = this.keys.get(keyId);
    if (!key || key.userId !== userId) throw new Error('Invalid or unauthorized key');
    key.revokedAt = new Date().toISOString();
    this.keys.delete(keyId);
    return { revoked: true };
  }

  async deleteKey(keyId, userId) {
    if (this._getStorage() === 'redis') {
      const redis = getRedis();
      await redis.del(KEYS.API_KEY(keyId));
      await redis.srem(KEYS.USER_API_KEYS(userId), keyId);
    } else { this.keys.delete(keyId); }
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
