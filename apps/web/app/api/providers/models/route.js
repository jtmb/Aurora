// @aurora/api/providers/models - Get available models from configured providers
// API keys accepted via request headers (x-openai-key, x-anthropic-key, etc.)
// When a valid JWT is provided, user-scoped keys from SQLite take priority over header keys

import { NextResponse } from 'next/server';
import { AuthHandler } from '@aurora/auth-service/handlers';
import { ApiKeyManager } from '@aurora/auth-service/handlers';

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
 * Extract API keys from request headers, with user-scoped key override
 */
const extractKeys = async (request) => {
  const headerKeys = {
    openai: request.headers.get('x-openai-key') || process.env.OPENAI_API_KEY || '',
    anthropic: request.headers.get('x-anthropic-key') || process.env.ANTHROPIC_API_KEY || '',
    ollamaBase: request.headers.get('x-ollama-base') || process.env.OLLAMA_API_BASE || 'http://localhost:11434',
    lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
    lmStudioHost: request.headers.get('x-lmstudio-host') || process.env.LM_STUDIO_HOST || '',
    lmStudioPort: request.headers.get('x-lmstudio-port') || process.env.LM_STUDIO_PORT || '',
    lmStudioApiKey: request.headers.get('x-lmstudio-api-key') || process.env.LM_STUDIO_API_KEY || '',
    deepseek: request.headers.get('x-deepseek-key') || process.env.DEEPSEEK_API_KEY || '',
  };

  // If authenticated, merge user-scoped keys (they take priority)
  const userId = getUserId(request);
  if (userId) {
    try {
      const userKeys = await apiKeyManager.listKeys(userId);
      for (const k of userKeys) {
        switch (k.provider?.toLowerCase()) {
          case 'openai':
            if (!headerKeys.openai) headerKeys.openai = k.rawKey;
            break;
          case 'anthropic':
            if (!headerKeys.anthropic) headerKeys.anthropic = k.rawKey;
            break;
          case 'ollama':
            if (!headerKeys.ollamaBase || headerKeys.ollamaBase === 'http://localhost:11434')
              headerKeys.ollamaBase = k.rawKey;
            break;
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map(m => ({
      id: m.id, name: m.id, owned_by: 'openai', source: 'OpenAI'
    }));
  } catch { return []; }
};

/**
 * Fetch models from Anthropic
 */
const fetchAnthropicModels = async (apiKey) => {
  if (!apiKey) return [];
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map(m => ({
      id: m.id, name: m.display_name || m.id, owned_by: 'anthropic', source: 'Anthropic'
    }));
  } catch { return []; }
};

/**
 * Fetch models from Ollama
 */
const fetchOllamaModels = async (baseUrl) => {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models || []).map(m => ({
      id: m.name, name: m.name, owned_by: 'ollama', source: 'Ollama'
    }));
  } catch { return []; }
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

    // Construct LM Studio URL from env vars if header not provided (same as chat completions)
    const lmStudioUrl = keys.lmStudioUrl || (keys.lmStudioHost && keys.lmStudioPort
      ? `http://${keys.lmStudioHost}:${keys.lmStudioPort}/v1`
      : '');

    // Construct Ollama URL from env vars if header not provided
    const ollamaBase = keys.ollamaBase || process.env.OLLAMA_API_BASE || 'http://localhost:11434';

    // Fetch models from all available providers in parallel
    const [openaiModels, anthropicModels, deepseekModels, ollamaModels, lmStudioModels] = await Promise.all([
      fetchOpenAIModels(keys.openai),
      fetchAnthropicModels(keys.anthropic),
      fetchDeepSeekModels(keys.deepseek),
      fetchOllamaModels(ollamaBase),
      fetchLmStudioModels(lmStudioUrl, keys.lmStudioApiKey)
    ]);

    const allModels = [
      ...openaiModels,
      ...anthropicModels,
      ...deepseekModels,
      ...ollamaModels,
      ...lmStudioModels
    ];

    return NextResponse.json({
      models: allModels,
      providers: {
        openai: !!keys.openai,
        anthropic: !!keys.anthropic,
        deepseek: !!keys.deepseek,
        ollama: true, // Always attempt Ollama
        lmstudio: !!lmStudioUrl
      }
    });

  } catch (error) {
    console.error('[Aurora] Models fetch error:', error.message);
    return NextResponse.json({ models: [], error: error.message });
  }
}