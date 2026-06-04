// @aurora/api/chat-completions - OpenAI-compatible chat completions endpoint
// Supports: OpenAI, Anthropic, Ollama, LM Studio
// API keys accepted via headers (x-openai-key, x-anthropic-key) or environment variables

import { NextResponse } from 'next/server';

/**
 * Extract API keys from request headers (sent by frontend from localStorage)
 * Falls back to environment variables for production deployments.
 */
const extractKeysFromHeaders = (request) => {
  return {
    openai: request.headers.get('x-openai-key') || process.env.OPENAI_API_KEY || '',
    anthropic: request.headers.get('x-anthropic-key') || process.env.ANTHROPIC_API_KEY || '',
    ollamaBase: request.headers.get('x-ollama-base') || process.env.OLLAMA_API_BASE || '',
    lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
    lmStudioHost: process.env.LM_STUDIO_HOST || '',
    lmStudioPort: process.env.LM_STUDIO_PORT || ''
  };
};

/**
 * Build provider list from available keys/configuration
 */
const getProviders = (keys) => {
  const providers = [];
  
  if (keys.openai) {
    providers.push({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: keys.openai,
      name: 'OpenAI'
    });
  }

  if (keys.anthropic) {
    providers.push({
      id: 'anthropic',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      apiKey: keys.anthropic,
      name: 'Anthropic'
    });
  }

  // Ollama - try the configured base URL or default localhost
  const ollamaBase = keys.ollamaBase || 'http://localhost:11434';
  providers.push({
    id: 'ollama',
    baseUrl: ollamaBase,
    apiKey: '',
    name: 'Ollama'
  });

  // LM Studio - only if custom URL configured
  if (keys.lmStudioUrl || (keys.lmStudioHost && keys.lmStudioPort)) {
    const lmUrl = keys.lmStudioUrl || `http://${keys.lmStudioHost}:${keys.lmStudioPort}/v1`;
    providers.push({
      id: 'lmstudio',
      baseUrl: lmUrl,
      apiKey: '',
      name: 'LM Studio'
    });
  }

  return providers;
};

/**
 * Normalize response to OpenAI v1 format regardless of provider
 */
const normalizeToOpenAIFormat = (data, providerId, modelName) => {
  if (providerId === 'anthropic') {
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: data.content?.[0]?.text || data.content || ''
        },
        finish_reason: data.stop_reason || 'stop'
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      },
      system_fingerprint: 'fp_aurora_anthropic'
    };
  }

  // Ollama typically returns OpenAI-compatible format
  if (providerId === 'ollama') {
    return {
      id: data.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: data.created || Math.floor(Date.now() / 1000),
      model: data.model || modelName,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: data.message?.content || data.choices?.[0]?.message?.content || ''
        },
        finish_reason: data.done_reason || data.choices?.[0]?.finish_reason || 'stop'
      }],
      usage: {
        prompt_tokens: data.prompt_eval_count || data.usage?.prompt_tokens || 0,
        completion_tokens: data.eval_count || data.usage?.completion_tokens || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0) || data.usage?.total_tokens || 0
      },
      system_fingerprint: 'fp_aurora_ollama'
    };
  }

  // OpenAI / LM Studio - already compatible
  return {
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: data.created || Math.floor(Date.now() / 1000),
    model: data.model || modelName,
    choices: data.choices || [{
      index: 0,
      message: { role: 'assistant', content: data.message?.content || '' },
      finish_reason: 'stop'
    }],
    usage: data.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    system_fingerprint: 'fp_aurora'
  };
};

/**
 * Build the provider-specific request URL and body
 */
const buildProviderRequest = (provider, model, messages, temperature, maxTokens) => {
  let url, body, headers = { 'Content-Type': 'application/json' };

  switch (provider.id) {
    case 'openai':
      url = `${provider.baseUrl}/chat/completions`;
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
      body = { model, messages, temperature, max_tokens: maxTokens };
      break;

    case 'anthropic':
      url = `${provider.baseUrl}/messages`;
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      // Anthropic requires system prompt as top-level, not in messages
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMessages = messages.filter(m => m.role !== 'system');
      body = {
        model,
        max_tokens: maxTokens || 4096,
        system: systemMsg?.content || 'You are a helpful assistant.',
        messages: chatMessages.map(m => ({ role: m.role, content: m.content }))
      };
      break;

    case 'ollama':
      url = `${provider.baseUrl}/api/chat`;
      body = {
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: { temperature }
      };
      break;

    case 'lmstudio':
      url = `${provider.baseUrl}/chat/completions`;
      body = { model, messages, temperature, max_tokens: maxTokens };
      break;

    default:
      throw new Error(`Unsupported provider: ${provider.id}`);
  }

  return { url, body, headers };
};

export async function POST(request) {
  try {
    const body = await request.json();
    const model = body.model || 'llama3';
    const messages = body.messages || [];
    const temperature = body.temperature ?? 0.7;
    const requestedProvider = body.provider || '';

    if (messages.length === 0) {
      return NextResponse.json(
        { error: { message: 'Messages array is required', type: 'invalid_request_error' } },
        { status: 400 }
      );
    }

    // Add system message if not provided
    if (!messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: 'You are a helpful assistant.' });
    }

    // Extract API keys from request headers
    const keys = extractKeysFromHeaders(request);
    const providers = getProviders(keys);

    // Select provider: requested > openai/anthropic (if keyed) > ollama (fallback)
    let selectedProvider = null;

    if (requestedProvider) {
      selectedProvider = providers.find(p => p.id === requestedProvider);
    }
    
    if (!selectedProvider) {
      // Prefer provider that matches the model name
      if (model.startsWith('gpt-') && keys.openai) {
        selectedProvider = providers.find(p => p.id === 'openai');
      } else if (model.startsWith('claude-') && keys.anthropic) {
        selectedProvider = providers.find(p => p.id === 'anthropic');
      }
    }

    if (!selectedProvider) {
      // Pick first provider with an API key, otherwise fall back to Ollama
      selectedProvider = providers.find(p => p.apiKey) || providers.find(p => p.id === 'ollama');
    }

    if (!selectedProvider) {
      return NextResponse.json(
        { error: { message: 'No LLM provider configured. Set API keys in Settings or configure environment variables.', type: 'configuration_error' } },
        { status: 400 }
      );
    }

    // Build and send the provider request
    const { url, body: providerBody, headers } = buildProviderRequest(
      selectedProvider, model, messages, temperature, body.max_tokens
    );

    console.log(`[Aurora] Routing to ${selectedProvider.name} (${selectedProvider.id}) -> ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(providerBody),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let errorMessage = `${selectedProvider.name} returned ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch {}
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const normalized = normalizeToOpenAIFormat(data, selectedProvider.id, model);
    normalized.provider = selectedProvider.id;

    return NextResponse.json(normalized);

  } catch (error) {
    console.error('[Aurora] Chat completion error:', error.message);
    
    return NextResponse.json(
      {
        error: {
          message: error.message || 'An error occurred while processing your request',
          type: 'api_error'
        }
      },
      { status: error.message?.includes('timed out') ? 504 : 502 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Aurora Chat Completions API',
    version: '1.0.0',
    endpoint: '/api/v1/chat/completions',
    format: 'OpenAI v1 compatible',
    supportedProviders: ['openai', 'anthropic', 'ollama', 'lmstudio']
  });
}