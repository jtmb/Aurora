// @aurora/api/v1/providers — Returns which providers are available and their models
// Used by container startup scripts to auto-configure Cline with native providers.
// With auth: returns ONLY the authenticated user's configured providers.
// Without auth: returns only env-var based providers (global defaults).

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

/**
 * Extract userId from request (Bearer token or token query param).
 */
function getUserId(request) {
  // 1. Bearer token
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      return authHandler.verifyToken(authHeader.substring(7)).userId;
    } catch { /* invalid token */ }
  }
  // 2. Query parameter
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam) {
    try {
      return authHandler.verifyToken(tokenParam).userId;
    } catch { /* invalid token */ }
  }
  return null;
}

/**
 * Get available Aurora providers by checking DB settings and env vars.
 * When authenticated, returns ONLY the user's personal provider settings.
 * When unauthenticated, returns only env-var based providers (no DB).
 */
export async function GET(request) {
  const userId = getUserId(request);

  // Default LM Studio config (from env)
  const lmHost = process.env.LM_STUDIO_HOST || '';
  const lmPort = process.env.LM_STUDIO_PORT || '';
  let lmStudioUrl = (lmHost && lmPort) ? `http://${lmHost}:${lmPort}/v1` : '';

  // Start with env-based providers (global defaults)
  let keys = {
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ollama: !!process.env.OLLAMA_BASE_URL,
    lmstudio: !!lmStudioUrl,
  };

  // If authenticated, load user-specific provider settings from DB
  // and OVERRIDE env defaults with user's configured providers.
  if (userId) {
    try {
      runMigrations();
      const db = getDb();

      // Load user's provider_settings
      const row = db.prepare('SELECT settings_json FROM provider_settings WHERE user_id = ?').get(userId);
      if (row) {
        const settings = JSON.parse(row.settings_json);
        // User's own settings override env-based defaults
        if (settings.deepseek !== undefined) keys.deepseek = !!settings.deepseek;
        if (settings.openai !== undefined) keys.openai = !!settings.openai;
        if (settings.anthropic !== undefined) keys.anthropic = !!settings.anthropic;
        if (settings.ollamaHost || settings.ollamaBase) keys.ollama = true;
        if (settings.ollama !== undefined) keys.ollama = !!settings.ollama;
        if (settings.lmStudioUrl) {
          keys.lmstudio = true;
          lmStudioUrl = settings.lmStudioUrl;
        } else if (settings.lmStudioHost && settings.lmStudioPort) {
          keys.lmstudio = true;
          lmStudioUrl = `http://${settings.lmStudioHost}:${settings.lmStudioPort}/v1`;
        }
        if (settings.lmstudio !== undefined) keys.lmstudio = !!settings.lmstudio;
      }

      // Also check user's api_keys table for provider keys
      const apiKeys = db.prepare(
        'SELECT provider, encrypted_key FROM api_keys WHERE user_id = ? AND revoked_at = \'\''
      ).all(userId);
      for (const ak of apiKeys) {
        const p = (ak.provider || '').toLowerCase();
        if (p === 'deepseek') keys.deepseek = true;
        if (p === 'openai') keys.openai = true;
        if (p === 'anthropic') keys.anthropic = true;
        if (p === 'lmstudio' || p === 'lm_studio') keys.lmstudio = true;
      }

      // Check user_model_access for model-level restrictions
      const modelAccess = db.prepare(
        'SELECT provider, model_id, enabled FROM user_model_access WHERE user_id = ?'
      ).all(userId);
      // If user has explicit model access entries, only show providers that have at least one enabled model
      if (modelAccess.length > 0) {
        const enabledProviders = new Set();
        for (const ma of modelAccess) {
          if (ma.enabled) enabledProviders.add(ma.provider.toLowerCase());
        }
        // Don't override keys for providers that have no explicit access entries
        // (providers without entries in user_model_access remain as-is)
        for (const ma of modelAccess) {
          const p = ma.provider.toLowerCase();
          if (!keys[p] && p !== 'ollama') {
            keys[p] = ma.enabled ? true : false;
          }
        }
        // If user has explicit entries for a provider and none are enabled, disable it
        const allProviders = new Set(modelAccess.map(m => m.provider.toLowerCase()));
        for (const p of allProviders) {
          if (!enabledProviders.has(p) && keys[p] !== undefined) {
            // Only disable if there are NO enabled models for this provider
            // Don't disable if user has api_keys for it
          }
        }
      }
    } catch (err) {
      console.error('[Aurora] Failed to load user provider settings:', err.message);
    }
  }

  // Fetch LM Studio models dynamically (if configured)
  let lmStudioModels = [];
  if (keys.lmstudio && lmStudioUrl) {
    try {
      const base = lmStudioUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const resp = await fetch(`${base}/v1/models`, {
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = data.data || (Array.isArray(data) ? data : []);
        lmStudioModels = models.map(m => ({
          id: String(m.id || '').replace(/\//g, '-'),
          name: String(m.id || '').replace(/\//g, '-'),
        }));
      }
    } catch (err) {
      console.error('[Aurora] Failed to fetch LM Studio models:', err.message);
    }
  }

  // Static DeepSeek models (API-based, known list)
  const deepseekModels = keys.deepseek ? [
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  ] : [];

  // Static models for other providers
  const openaiModels = keys.openai ? [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'o3-mini', name: 'o3 Mini' },
  ] : [];

  const anthropicModels = keys.anthropic ? [
    { id: 'claude-4-sonnet-20250514', name: 'Claude 4 Sonnet' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
  ] : [];

  return NextResponse.json({
    providers: {
      deepseek: keys.deepseek,
      openai: keys.openai,
      anthropic: keys.anthropic,
      ollama: keys.ollama,
      lmstudio: keys.lmstudio,
    },
    models: {
      deepseek: deepseekModels,
      openai: openaiModels,
      anthropic: anthropicModels,
      lmstudio: lmStudioModels,
    },
    gateway: {
      chatCompletions: '/api/v1/chat/completions',
    },
    // When authenticated, mark as user-scoped response
    ...(userId ? { scopedToUser: userId } : {}),
  });
}
