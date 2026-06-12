// @aurora/api/providers/models - Get available models from ALL configured providers
// Supports: OpenAI, Anthropic, DeepSeek, Ollama, LM Studio
// API keys accepted via request headers (x-openai-key, x-anthropic-key, x-deepseek-key, etc.)
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
 * 1. Request headers (x-openai-key, x-anthropic-key, etc.) — from localStorage
 * 2. API keys table (apiKeyManager.listKeys) — legacy
 * 3. provider_settings DB table — survives cache clears
 */
const extractKeys = async (request) => {
  const headerKeys = {
    openai: request.headers.get('x-openai-key') || '',
    anthropic: request.headers.get('x-anthropic-key') || '',
    deepseek: request.headers.get('x-deepseek-key') || '',
    ollamaBase: request.headers.get('x-ollama-base') || '',
    lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
    lmStudioHost: request.headers.get('x-lmstudio-host') || '',
    lmStudioPort: request.headers.get('x-lmstudio-port') || '',
    lmStudioApiKey: request.headers.get('x-lmstudio-api-key') || '',
  };

  const userId = getUserId(request);

  // Fallback: provider_settings DB table (survives cache clears)
  // When authenticated: read that user's row. When unauthenticated (e.g.
  // container setup scripts): read ALL rows to find any configured keys.
  try {
    runMigrations();
    const db = getDb();
    const rows = userId
      ? [db.prepare('SELECT settings_json FROM provider_settings WHERE user_id = ?').get(userId)].filter(Boolean)
      : db.prepare('SELECT settings_json FROM provider_settings').all();

    for (const row of rows) {
      const settings = JSON.parse(row.settings_json);
      if (!headerKeys.openai && settings.openai) headerKeys.openai = settings.openai;
      if (!headerKeys.anthropic && settings.anthropic) headerKeys.anthropic = settings.anthropic;
      if (!headerKeys.deepseek && settings.deepseek) headerKeys.deepseek = settings.deepseek;
      if (!headerKeys.ollamaBase && settings.ollamaBase) headerKeys.ollamaBase = settings.ollamaBase;
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

  // Final fallback: server-side environment variables (.env.local)
  if (!headerKeys.deepseek && process.env.DEEPSEEK_API_KEY) headerKeys.deepseek = process.env.DEEPSEEK_API_KEY;
  if (!headerKeys.lmStudioHost && process.env.LM_STUDIO_HOST) headerKeys.lmStudioHost = process.env.LM_STUDIO_HOST;
  if (!headerKeys.lmStudioPort && process.env.LM_STUDIO_PORT) headerKeys.lmStudioPort = process.env.LM_STUDIO_PORT;
  if (!headerKeys.lmStudioApiKey && process.env.LMSTUDIO_API_KEY) headerKeys.lmStudioApiKey = process.env.LMSTUDIO_API_KEY;
  if (!headerKeys.lmStudioUrl && headerKeys.lmStudioHost && headerKeys.lmStudioPort) {
    headerKeys.lmStudioUrl = `http://${headerKeys.lmStudioHost}:${headerKeys.lmStudioPort}/v1`;
  }

  return headerKeys;
};

/**
 * Fetch models from OpenAI
 */
const fetchOpenAIModels = async (apiKey) => {
  if (!apiKey) return [];
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    // Filter to chat-capable models only
    const chatPrefixes = ['gpt-', 'o1', 'o3'];
    return (data.data || [])
      .filter(m => chatPrefixes.some(p => m.id.startsWith(p)))
      .map(m => ({
        id: m.id, name: m.id, owned_by: 'openai', source: 'OpenAI'
      }));
  } catch { return []; }
};

/**
 * Fetch models from Anthropic
 * Anthropic doesn't have a /v1/models endpoint, so return known models
 * when a valid API key is configured.
 */
const fetchAnthropicModels = async (apiKey) => {
  if (!apiKey) return [];
  // Try to validate the key by listing models — Anthropic doesn't expose
  // a model list API, so verify the key works and return known models.
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      }),
      signal: AbortSignal.timeout(8000)
    });
    // Any response (even error) means the key is valid and hitting the API
    // 401/403 = invalid key, other codes likely mean valid key
    if (response.status === 401 || response.status === 403) return [];
  } catch { return []; }

  // Return known Anthropic models
  return [
    { id: 'claude-4-sonnet-20250514', name: 'Claude 4 Sonnet', owned_by: 'anthropic', source: 'Anthropic' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', owned_by: 'anthropic', source: 'Anthropic' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', owned_by: 'anthropic', source: 'Anthropic' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', owned_by: 'anthropic', source: 'Anthropic' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', owned_by: 'anthropic', source: 'Anthropic' },
  ];
};

/**
 * Fetch models from DeepSeek (OpenAI-compatible)
 */
const fetchDeepSeekModels = async (apiKey) => {
  if (!apiKey) return [];
  try {
    const response = await fetch('https://api.deepseek.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map(m => ({
      id: m.id, name: m.id, owned_by: 'deepseek', source: 'DeepSeek'
    }));
  } catch { return []; }
};

/**
 * Fetch models from Ollama
 */
const fetchOllamaModels = async (baseUrl) => {
  if (!baseUrl) return [];
  try {
    const url = baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models || []).map(m => ({
      id: m.name || m.model,
      name: m.name || m.model,
      owned_by: 'ollama',
      source: 'Ollama'
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

/**
 * Static fallback model lists — used when live provider APIs are unreachable.
 * Returns known models for any provider with a configured key, so the UI
 * always shows something useful even when provider servers are down.
 */
const STATIC_MODELS = {
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat (V4)', owned_by: 'deepseek', source: 'DeepSeek' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', owned_by: 'deepseek', source: 'DeepSeek' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', owned_by: 'deepseek', source: 'DeepSeek' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', owned_by: 'openai', source: 'OpenAI' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', owned_by: 'openai', source: 'OpenAI' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', owned_by: 'openai', source: 'OpenAI' },
    { id: 'o3-mini', name: 'o3 Mini', owned_by: 'openai', source: 'OpenAI' },
  ],
  anthropic: [
    { id: 'claude-4-sonnet-20250514', name: 'Claude 4 Sonnet', owned_by: 'anthropic', source: 'Anthropic' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', owned_by: 'anthropic', source: 'Anthropic' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', owned_by: 'anthropic', source: 'Anthropic' },
  ],
  ollama: [], // Ollama is local-only; no static fallback
  lmstudio: [], // LM Studio is local-only; no static fallback
};

const getStaticFallbackModels = (keys) => {
  const models = [];
  if (keys.deepseek) models.push(...STATIC_MODELS.deepseek);
  if (keys.openai) models.push(...STATIC_MODELS.openai);
  if (keys.anthropic) models.push(...STATIC_MODELS.anthropic);
  if (keys.ollamaBase) models.push(...STATIC_MODELS.ollama);
  return models;
};

export async function GET(request) {
  try {
    const keys = await extractKeys(request);

    // Construct LM Studio URL from host/port if header not provided
    const lmStudioUrl = keys.lmStudioUrl || (keys.lmStudioHost && keys.lmStudioPort
      ? `http://${keys.lmStudioHost}:${keys.lmStudioPort}/v1`
      : '');

    // Only fetch Ollama if a base URL is configured
    const [openaiModels, anthropicModels, deepseekModels, ollamaModels, lmStudioModels] =
      await Promise.all([
        fetchOpenAIModels(keys.openai),
        fetchAnthropicModels(keys.anthropic),
        fetchDeepSeekModels(keys.deepseek),
        keys.ollamaBase ? fetchOllamaModels(keys.ollamaBase) : Promise.resolve([]),
        fetchLmStudioModels(lmStudioUrl, keys.lmStudioApiKey)
      ]);

    let allModels = [
      ...openaiModels,
      ...anthropicModels,
      ...deepseekModels,
      ...ollamaModels,
      ...lmStudioModels
    ];

    // Per-provider static fallback: if a provider has a key but its live fetch
    // returned nothing, use static models so the UI always shows known models.
    if (openaiModels.length === 0 && keys.openai) allModels.push(...STATIC_MODELS.openai);
    if (anthropicModels.length === 0 && keys.anthropic) allModels.push(...STATIC_MODELS.anthropic);
    if (deepseekModels.length === 0 && keys.deepseek) allModels.push(...STATIC_MODELS.deepseek);
    if (ollamaModels.length === 0 && keys.ollamaBase) allModels.push(...STATIC_MODELS.ollama);

    // If absolutely nothing, use static fallback for any provider with a key
    if (allModels.length === 0) {
      allModels = getStaticFallbackModels(keys);
    }

    // For non-admin users, filter models to only those provisioned via user_model_access
    const userId = getUserId(request);
    if (userId) {
      try {
        runMigrations();
        const db = getDb();
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
        if (user?.role !== 'admin') {
          const allowed = db.prepare(
            'SELECT provider, model_id FROM user_model_access WHERE user_id = ? AND enabled = 1'
          ).all(userId);
          if (allowed.length > 0) {
            const allowedSet = new Set(allowed.map(r => `${r.provider}:${r.model_id}`));
            allModels = allModels.filter(m => allowedSet.has(`${m.owned_by}:${m.id}`));
          } else {
            // No access rules — deny all models
            allModels = [];
          }
        }
      } catch (e) {
        console.error('[Aurora] Model access filter error:', e.message);
      }
    }

    return NextResponse.json({
      models: allModels,
      providers: {
        openai: !!keys.openai,
        anthropic: !!keys.anthropic,
        deepseek: !!keys.deepseek,
        ollama: !!keys.ollamaBase,
        lmstudio: !!lmStudioUrl
      }
    });

  } catch (error) {
    console.error('[Aurora] Models fetch error:', error.message);
    return NextResponse.json({ models: [], error: error.message });
  }
}