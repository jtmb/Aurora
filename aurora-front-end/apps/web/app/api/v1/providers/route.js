// @aurora/api/v1/providers — Returns which providers are available and their models
// Used by container startup scripts to auto-configure Cline with native providers.
// No auth required — reads from provider_settings DB + env vars.

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';

/**
 * Get available Aurora providers by checking DB settings and env vars.
 * Returns a simple { providers: { deepseek: true, lmstudio: true, ... }, models: [...] } shape.
 */
export async function GET() {
  // Default LM Studio config (from env)
  const lmHost = process.env.LM_STUDIO_HOST || '';
  const lmPort = process.env.LM_STUDIO_PORT || '';
  let lmStudioUrl = (lmHost && lmPort) ? `http://${lmHost}:${lmPort}/v1` : '';

  let keys = {
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ollama: !!process.env.OLLAMA_BASE_URL,
    lmstudio: !!lmStudioUrl,
  };

  // Try DB fallback for provider settings
  try {
    runMigrations();
    const db = getDb();
    const rows = db.prepare('SELECT settings_json FROM provider_settings').all();
    for (const row of rows) {
      const settings = JSON.parse(row.settings_json);
      if (!keys.deepseek && settings.deepseek) keys.deepseek = true;
      if (!keys.openai && settings.openai) keys.openai = true;
      if (!keys.anthropic && settings.anthropic) keys.anthropic = true;
      if (!keys.ollama && (settings.ollamaBase || settings.ollamaHost)) keys.ollama = true;
      if (!keys.lmstudio && (settings.lmStudioUrl || (settings.lmStudioHost && settings.lmStudioPort))) {
        keys.lmstudio = true;
        if (!lmStudioUrl && settings.lmStudioHost && settings.lmStudioPort) {
          lmStudioUrl = `http://${settings.lmStudioHost}:${settings.lmStudioPort}/v1`;
        } else if (!lmStudioUrl && settings.lmStudioUrl) {
          lmStudioUrl = settings.lmStudioUrl;
        }
      }
    }
  } catch (err) {
    console.error('[Aurora] provider_settings DB read error:', err.message);
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
  });
}
