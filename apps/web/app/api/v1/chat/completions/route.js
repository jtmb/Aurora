// @aurora/api/chat-completions - OpenAI-compatible chat completions endpoint
// Supports: DeepSeek, LM Studio
// API keys accepted via headers (x-deepseek-key, x-lmstudio-url) or environment variables
// When a valid JWT is provided, user-scoped keys from SQLite take priority over header keys

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
 * Load user-scoped API keys from SQLite (encrypted storage, per-user)
 * Returns keys object compatible with extractKeysFromHeaders format.
 */
const loadUserKeysFromStorage = async (userId) => {
  if (!userId) return {};
  try {
    const keys = await apiKeyManager.listKeys(userId);
    const result = {};
    for (const k of keys) {
      switch (k.provider?.toLowerCase()) {
        case 'lmstudio':
        case 'lm_studio':
          result.lmStudioUrl = result.lmStudioUrl || k.rawKey;
          break;
        case 'deepseek':
          result.deepseek = result.deepseek || k.rawKey;
          break;
      }
    }
    return result;
  } catch (err) {
    console.error('[Aurora] Failed to load user keys from storage:', err.message);
    return {};
  }
};

/**
 * Extract API keys from request headers (sent by frontend from localStorage)
 * Falls back to environment variables for production deployments.
 * User-scoped keys from SQLite take priority over header/env keys when JWT is present.
 */
const extractKeysFromHeaders = async (request) => {
  const headerKeys = {
    lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
    lmStudioHost: request.headers.get('x-lmstudio-host') || process.env.LM_STUDIO_HOST || '',
    lmStudioPort: request.headers.get('x-lmstudio-port') || process.env.LM_STUDIO_PORT || '',
    lmStudioApiKey: request.headers.get('x-lmstudio-api-key') || process.env.LM_STUDIO_API_KEY || '',
    deepseek: request.headers.get('x-deepseek-key') || process.env.DEEPSEEK_API_KEY || '',
  };

  // If user is authenticated, merge user-scoped keys (they take priority)
  const userId = getUserId(request);
  if (userId) {
    const userKeys = await loadUserKeysFromStorage(userId);
    if (userKeys.lmStudioUrl) headerKeys.lmStudioUrl = userKeys.lmStudioUrl;
    if (userKeys.deepseek) headerKeys.deepseek = userKeys.deepseek;
  }

  return headerKeys;
};

/**
 * Build provider list from available keys/configuration
 */
const getProviders = (keys) => {
  const providers = [];

  // DeepSeek — OpenAI-compatible
  if (keys.deepseek) {
    providers.push({
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: keys.deepseek,
      name: 'DeepSeek'
    });
  }

  // LM Studio — only if URL configured
  if (keys.lmStudioUrl || (keys.lmStudioHost && keys.lmStudioPort)) {
    const lmUrl = keys.lmStudioUrl || `http://${keys.lmStudioHost}:${keys.lmStudioPort}/v1`;
    providers.push({
      id: 'lmstudio',
      baseUrl: lmUrl,
      apiKey: keys.lmStudioApiKey || '',
      name: 'LM Studio'
    });
  }

  return providers;
};

/**
 * Normalize response to OpenAI v1 format regardless of provider
 */
const normalizeToOpenAIFormat = (data, providerId, modelName) => {
  // DeepSeek / LM Studio — already OpenAI-compatible
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
const buildProviderRequest = (provider, model, messages, temperature, maxTokens, stream = false) => {
  let url, body, headers = { 'Content-Type': 'application/json' };

  switch (provider.id) {
    case 'lmstudio':
      // LM Studio uses OpenAI-compatible /v1/chat/completions endpoint
      // Ensure /v1 prefix regardless of whether settings already includes it
      const lmBase = provider.baseUrl.endsWith('/v1') ? provider.baseUrl : `${provider.baseUrl}/v1`;
      url = `${lmBase}/chat/completions`;
      body = { model, messages, temperature, max_tokens: maxTokens, stream };
      break;

    case 'deepseek':
      // DeepSeek uses OpenAI-compatible API
      url = `${provider.baseUrl}/chat/completions`;
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
      body = { model, messages, temperature, max_tokens: maxTokens, stream };
      break;

    default:
      throw new Error(`Unsupported provider: ${provider.id}`);
  }

  return { url, body, headers };
};

export async function POST(request) {
  try {
    const body = await request.json();
    const model = body.model || 'deepseek-chat';
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
    const keys = await extractKeysFromHeaders(request);
    const providers = getProviders(keys);

    // Select provider: requested > openai/anthropic (if keyed) > ollama (fallback)
    let selectedProvider = null;

    if (requestedProvider) {
      selectedProvider = providers.find(p => p.id === requestedProvider);
    }
    
    if (!selectedProvider) {
      // Prefer provider that matches the model name
      if (model.startsWith('deepseek-') && keys.deepseek) {
        selectedProvider = providers.find(p => p.id === 'deepseek');
      }
    }

    if (!selectedProvider) {
      // Pick first available provider (LM Studio doesn't require API key for local)
      selectedProvider = providers[0];
    }

    if (!selectedProvider) {
      return NextResponse.json(
        { error: { message: 'No LLM provider configured. Set API keys in Settings or configure environment variables.', type: 'configuration_error' } },
        { status: 400 }
      );
    }

    // Build and send the provider request
    const streamMode = body.stream === true;
    const { url, body: providerBody, headers } = buildProviderRequest(
      selectedProvider, model, messages, temperature, body.max_tokens, streamMode
    );

    console.log(`[Aurora] Routing to ${selectedProvider.name} (${selectedProvider.id}) -> ${url}${streamMode ? ' [stream]' : ''}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

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

    // Streaming mode: pipe provider SSE stream directly to client
    if (streamMode && response.body) {
      const reader = response.body.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const stream = new ReadableStream({
        async start(controller) {
          let buffer = '';
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // Flush remaining buffer
                if (buffer.trim()) {
                  controller.enqueue(encoder.encode(buffer));
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                break;
              }
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;
              // Relay SSE events as-is
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                controller.enqueue(encoder.encode(line + '\n'));
              }
            }
          } catch (err) {
            console.error('[Aurora] Stream error:', err.message);
            controller.error(err);
          }
        }
      });

      // Track usage — fire and forget for streaming too
      const userId = getUserId(request);
      if (userId) {
        try {
          runMigrations();
          const db = getDb();
          db.prepare(`
            INSERT INTO usage_records (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(userId, selectedProvider.id, model, 0, 0, 0);
        } catch (err) {
          console.error('[Aurora] Failed to track usage:', err.message);
        }
      }

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Provider': selectedProvider.id
        }
      });
    }

    // Non-streaming mode: return normalized JSON
    const data = await response.json();
    const normalized = normalizeToOpenAIFormat(data, selectedProvider.id, model);
    normalized.provider = selectedProvider.id;

    // Track usage — fire and forget (don't block the response)
    const userId = getUserId(request);
    if (userId) {
      try {
        runMigrations();
        const db = getDb();
        db.prepare(`
          INSERT INTO usage_records (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          selectedProvider.id,
          model,
          normalized.usage?.prompt_tokens || 0,
          normalized.usage?.completion_tokens || 0,
          normalized.usage?.total_tokens || 0
        );
      } catch (err) {
        console.error('[Aurora] Failed to track usage:', err.message);
      }
    }

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