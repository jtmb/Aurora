// @aurora/api/providers/models - Get available models from configured providers
// Supports: DeepSeek, LM Studio
// API keys accepted via request headers (x-deepseek-key, x-lmstudio-url)
// Falls back to provider_settings DB table when headers are empty (survives cache clears)

import { NextResponse } from 'next/server';
import { AuthHandler } from '@aurora/auth-service/handlers';
import { ApiKeyManager } from '@aurora/auth-service/handlers';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';

const authHandler = new AuthHandler();
const apiKeyManager = new ApiKeyManager();

/**
 * Extract userId from JWT if present
 */
const getUserId = (request) => {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = authHandler.verifyToken(authHeader.substring(7));
    return decoded.userId;
  } catch { return null; }
};

/**
 * Extract API keys from request headers, with fallback chain:
 * 1. Request headers (x-deepseek-key, etc) — from localStorage
 * 2. API keys table (apiKeyManager.listKeys) — legacy
 * 3. provider_settings DB table — survives cache clears
 */
const extractKeys = async (request) => {
  const headerKeys = {
    lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
    lmStudioHost: request.headers.get('x-lmstudio-host') || '',
    lmStudioPort: request.headers.get('x-lmstudio-port') || '',
    lmStudioApiKey: request.headers.get('x-lmstudio-api-key') || '',
    deepseek: request.headers.get('x-deepseek-key') || '',
  };

  const userId = getUserId(request);
  if (!userId) return headerKeys;

  // Fallback 2: API keys table (legacy)
  try {
    const userKeys = await apiKeyManager.listKeys(userId);
    for (const k of userKeys) {
      switch (k.provider?.toLowerCase()) {
        case 'lmstudio':
        case 'lm_studio':
          if (!headerKeys.lmStudioUrl) headerKeys.lmStudioUrl = k.rawKey;
          break;
        case 'deepseek':
          if (!headerKeys.deepseek) headerKeys.deepseek = k.rawKey;
          break;
      }
    }
  } catch (err) {
    console.error('[Aurora] Failed to load user keys for models:', err.message);
  }

  // Fallback 3: provider_settings DB table (survives cache clears, per-key check)
  if (!headerKeys.deepseek || !headerKeys.lmStudioUrl) {
    try {
      runMigrations();
      const db = getDb();
      const row = db.prepare('SELECT settings_json FROM provider_settings WHERE user_id = ?').get(userId);
      if (row) {
        const settings = JSON.parse(row.settings_json);
        if (!headerKeys.deepseek && settings.deepseek) headerKeys.deepseek = settings.deepseek;
        if (!headerKeys.lmStudioUrl && settings.lmStudioUrl) headerKeys.lmStudioUrl = settings.lmStudioUrl;
        if (!headerKeys.lmStudioUrl && settings.lmStudioHost && settings.lmStudioPort) {
          headerKeys.lmStudioUrl = `http://${settings.lmStudioHost}:${settings.lmStudioPort}/v1`;
        }
        if (!headerKeys.lmStudioHost && settings.lmStudioHost) headerKeys.lmStudioHost = String(settings.lmStudioHost);
        if (!headerKeys.lmStudioPort && settings.lmStudioPort) headerKeys.lmStudioPort = String(settings.lmStudioPort);
        if (!headerKeys.lmStudioApiKey && settings.lmStudioApiKey) headerKeys.lmStudioApiKey = settings.lmStudioApiKey;
      }
    } catch (err) {
      console.error('[Aurora] Failed to load provider_settings fallback:', err.message);
    }
  }

  return headerKeys;
};

/**
 * Fetch models from DeepSeek (OpenAI-compatible)
 */
const fetchDeepSeekModels = async (apiKey) => {
  if (!apiKey) return [];
  try {
    const response = await fetch('https://api.deepseek.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map(m => ({
      id: m.id, name: m.id, owned_by: 'deepseek', source: 'DeepSeek'
    }));
  } catch { return []; }
};

/**
 * Fetch models from LM Studio
 */
const fetchLmStudioModels = async (url, apiKey) => {
  if (!url) return [];
  try {
    // Normalize: strip trailing /v1 if present, then call /v1/models
    const base = url.replace(/\/+$/, '').replace(/\/v1$/, '');
    const fetchHeaders = {};
    if (apiKey) {
      fetchHeaders['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await fetch(`${base}/v1/models`, {
      headers: fetchHeaders,
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    const models = data.data || (Array.isArray(data) ? data : []);
    return models.map(m => ({
      id: m.id, name: m.id, owned_by: 'lmstudio', source: 'LM Studio'
    }));
  } catch { return []; }
};

export async function GET(request) {
  try {
    const keys = await extractKeys(request);

    // Construct LM Studio URL from env vars if header not provided
    const lmStudioUrl = keys.lmStudioUrl || (keys.lmStudioHost && keys.lmStudioPort
      ? `http://${keys.lmStudioHost}:${keys.lmStudioPort}/v1`
      : '');

    // Fetch models from available providers in parallel
    const [deepseekModels, lmStudioModels] = await Promise.all([
      fetchDeepSeekModels(keys.deepseek),
      fetchLmStudioModels(lmStudioUrl, keys.lmStudioApiKey)
    ]);

    const allModels = [
      ...deepseekModels,
      ...lmStudioModels
    ];

    return NextResponse.json({
      models: allModels,
      providers: {
        deepseek: !!keys.deepseek,
        lmstudio: !!lmStudioUrl
      }
    });

  } catch (error) {
    console.error('[Aurora] Models fetch error:', error.message);
    return NextResponse.json({ models: [], error: error.message });
  }
}