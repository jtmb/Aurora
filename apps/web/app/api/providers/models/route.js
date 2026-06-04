// @aurora/api/providers/models - Get available models from configured providers
// API keys accepted via request headers (x-openai-key, x-anthropic-key, etc.)

import { NextResponse } from 'next/server';

/**
 * Extract API keys from request headers
 */
const extractKeys = (request) => ({
  openai: request.headers.get('x-openai-key') || process.env.OPENAI_API_KEY || '',
  anthropic: request.headers.get('x-anthropic-key') || process.env.ANTHROPIC_API_KEY || '',
  ollamaBase: request.headers.get('x-ollama-base') || process.env.OLLAMA_API_BASE || 'http://localhost:11434',
  lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
  lmStudioHost: process.env.LM_STUDIO_HOST || '',
  lmStudioPort: process.env.LM_STUDIO_PORT || ''
});

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
 * Fetch models from LM Studio
 */
const fetchLmStudioModels = async (url) => {
  if (!url) return [];
  try {
    const response = await fetch(`${url}/v1/models`);
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
    const keys = extractKeys(request);

    // Fetch models from all available providers in parallel
    const [openaiModels, anthropicModels, ollamaModels, lmStudioModels] = await Promise.all([
      fetchOpenAIModels(keys.openai),
      fetchAnthropicModels(keys.anthropic),
      fetchOllamaModels(keys.ollamaBase),
      fetchLmStudioModels(keys.lmStudioUrl)
    ]);

    const allModels = [
      ...openaiModels,
      ...anthropicModels,
      ...ollamaModels,
      ...lmStudioModels
    ];

    return NextResponse.json({
      models: allModels,
      providers: {
        openai: !!keys.openai,
        anthropic: !!keys.anthropic,
        ollama: true, // Always attempt Ollama
        lmstudio: !!(keys.lmStudioUrl || keys.lmStudioHost)
      }
    });

  } catch (error) {
    console.error('[Aurora] Models fetch error:', error.message);
    return NextResponse.json({ models: [], error: error.message });
  }
}