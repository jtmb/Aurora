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
 * Load user-scoped API keys from provider_settings DB table (survives cache clears)
 */
const loadProviderSettingsFromDb = (userId) => {
  if (!userId) return {};
  try {
    runMigrations();
    const db = getDb();
    const row = db.prepare('SELECT settings_json FROM provider_settings WHERE user_id = ?').get(userId);
    if (!row) return {};
    const s = JSON.parse(row.settings_json);
    const result = {};
    if (s.deepseek) result.deepseek = s.deepseek;
    if (s.lmStudioUrl) result.lmStudioUrl = s.lmStudioUrl;
    if (!result.lmStudioUrl && s.lmStudioHost && s.lmStudioPort) {
      result.lmStudioUrl = `http://${s.lmStudioHost}:${s.lmStudioPort}/v1`;
    }
    if (s.lmStudioHost) result.lmStudioHost = String(s.lmStudioHost);
    if (s.lmStudioPort) result.lmStudioPort = String(s.lmStudioPort);
    if (s.lmStudioApiKey) result.lmStudioApiKey = s.lmStudioApiKey;
    return result;
  } catch (err) {
    console.error('[Aurora] Failed to load provider_settings from DB:', err.message);
    return {};
  }
};

/**
 * Extract API keys from request headers (sent by frontend from localStorage)
 * Falls back to: user-scoped keys (api_keys table) → provider_settings DB → environment variables
 * Provider_settings DB ensures keys survive browser cache clears.
 */
const extractKeysFromHeaders = async (request) => {
  const headerKeys = {
    lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
    lmStudioHost: request.headers.get('x-lmstudio-host') || '',
    lmStudioPort: request.headers.get('x-lmstudio-port') || '',
    lmStudioApiKey: request.headers.get('x-lmstudio-api-key') || '',
    deepseek: request.headers.get('x-deepseek-key') || '',
  };

  const userId = getUserId(request);

  // If no userId (no JWT), try to read keys from provider_settings DB anyway
  // This supports server-side callers like agent-runner that don't have auth tokens
  if (!userId && !headerKeys.deepseek && !headerKeys.lmStudioUrl) {
    // Check Authorization header for API key (OpenAI-compatible clients like Cline)
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ') && !authHeader.startsWith('Bearer eyJ')) {
      const token = authHeader.substring(7);
      // If token looks like an API key (not a JWT), use it as DeepSeek key
      if (token && token !== 'aurora-no-key' && token.length > 10) {
        headerKeys.deepseek = token;
        return headerKeys;
      }
    }
    try {
      runMigrations();
      const db = getDb();
      // Get ALL provider_settings rows and prefer one with deepseek enabled
      const rows = db.prepare('SELECT settings_json FROM provider_settings').all();
      let bestRow = null;
      for (const row of rows) {
        try {
          const s = JSON.parse(row.settings_json);
          // Prefer row where deepseek is enabled and has a key
          if (s.providerEnabled?.deepseek && s.deepseek) {
            bestRow = row;
            break;
          }
          // Fallback: prefer row with lmstudio enabled
          if (!bestRow && s.providerEnabled?.lmstudio) {
            bestRow = row;
          }
          // Last resort: any row
          if (!bestRow) bestRow = row;
        } catch { /* skip malformed rows */ }
      }
      const row = bestRow || rows[0];
      if (row) {
        const s = JSON.parse(row.settings_json);
        if (s.deepseek && !headerKeys.deepseek && s.providerEnabled?.deepseek !== false) headerKeys.deepseek = s.deepseek;
        if (s.lmStudioUrl && !headerKeys.lmStudioUrl) headerKeys.lmStudioUrl = s.lmStudioUrl;
        if (!headerKeys.lmStudioUrl && s.lmStudioHost && s.lmStudioPort) {
          headerKeys.lmStudioUrl = `http://${s.lmStudioHost}:${s.lmStudioPort}/v1`;
        }
        if (s.lmStudioHost && !headerKeys.lmStudioHost) headerKeys.lmStudioHost = String(s.lmStudioHost);
        if (s.lmStudioPort && !headerKeys.lmStudioPort) headerKeys.lmStudioPort = String(s.lmStudioPort);
        if (s.lmStudioApiKey && !headerKeys.lmStudioApiKey) headerKeys.lmStudioApiKey = s.lmStudioApiKey;
      }
    } catch (err) {
      console.error('[Aurora] DB fallback (no-auth) failed:', err.message);
    }
    // Final fallback: environment variables
    if (!headerKeys.deepseek && process.env.DEEPSEEK_API_KEY) headerKeys.deepseek = process.env.DEEPSEEK_API_KEY;
    if (!headerKeys.lmStudioUrl && process.env.LMSTUDIO_URL) headerKeys.lmStudioUrl = process.env.LMSTUDIO_URL;
    if (!headerKeys.lmStudioHost && process.env.LM_STUDIO_HOST) headerKeys.lmStudioHost = process.env.LM_STUDIO_HOST;
    if (!headerKeys.lmStudioPort && process.env.LM_STUDIO_PORT) headerKeys.lmStudioPort = process.env.LM_STUDIO_PORT;
    if (!headerKeys.lmStudioApiKey && process.env.LMSTUDIO_API_KEY) headerKeys.lmStudioApiKey = process.env.LMSTUDIO_API_KEY;
    return headerKeys;
  }

  if (!userId) return headerKeys;

  // Fallback 1: API keys table (legacy)
  const userKeys = await loadUserKeysFromStorage(userId);
  if (userKeys.lmStudioUrl && !headerKeys.lmStudioUrl) headerKeys.lmStudioUrl = userKeys.lmStudioUrl;
  if (userKeys.deepseek && !headerKeys.deepseek) headerKeys.deepseek = userKeys.deepseek;

  // Fallback 2: provider_settings DB — this user first, then ANY user (survives cache clears)
  if (!headerKeys.deepseek || !headerKeys.lmStudioUrl) {
    const dbKeys = loadProviderSettingsFromDb(userId);
    if (!headerKeys.deepseek && dbKeys.deepseek) headerKeys.deepseek = dbKeys.deepseek;
    if (!headerKeys.lmStudioUrl && dbKeys.lmStudioUrl) headerKeys.lmStudioUrl = dbKeys.lmStudioUrl;
    if (!headerKeys.lmStudioHost && dbKeys.lmStudioHost) headerKeys.lmStudioHost = dbKeys.lmStudioHost;
    if (!headerKeys.lmStudioPort && dbKeys.lmStudioPort) headerKeys.lmStudioPort = dbKeys.lmStudioPort;
    if (!headerKeys.lmStudioApiKey && dbKeys.lmStudioApiKey) headerKeys.lmStudioApiKey = dbKeys.lmStudioApiKey;
  }

  // Fallback 3: ALL users' provider_settings when this user has none (server-side callers)
  if (!headerKeys.deepseek && !headerKeys.lmStudioUrl) {
    try {
      runMigrations();
      const db = getDb();
      const rows = db.prepare('SELECT settings_json FROM provider_settings').all();
      for (const row of rows) {
        try {
          const s = JSON.parse(row.settings_json);
          if (!headerKeys.deepseek && s.deepseek && s.providerEnabled?.deepseek !== false) headerKeys.deepseek = s.deepseek;
          if (!headerKeys.lmStudioUrl && s.lmStudioUrl) headerKeys.lmStudioUrl = s.lmStudioUrl;
          if (!headerKeys.lmStudioUrl && s.lmStudioHost && s.lmStudioPort) {
            headerKeys.lmStudioUrl = `http://${s.lmStudioHost}:${s.lmStudioPort}/v1`;
          }
          if (!headerKeys.lmStudioHost && s.lmStudioHost) headerKeys.lmStudioHost = String(s.lmStudioHost);
          if (!headerKeys.lmStudioPort && s.lmStudioPort) headerKeys.lmStudioPort = String(s.lmStudioPort);
          if (!headerKeys.lmStudioApiKey && s.lmStudioApiKey) headerKeys.lmStudioApiKey = s.lmStudioApiKey;
          if (headerKeys.deepseek || headerKeys.lmStudioUrl) break;
        } catch { /* skip malformed */ }
      }
    } catch (err) {
      console.error('[Aurora] All-users DB fallback failed:', err.message);
    }
  }

  // Final fallback: environment variables
  if (!headerKeys.deepseek && process.env.DEEPSEEK_API_KEY) headerKeys.deepseek = process.env.DEEPSEEK_API_KEY;
  if (!headerKeys.lmStudioUrl && process.env.LMSTUDIO_URL) headerKeys.lmStudioUrl = process.env.LMSTUDIO_URL;
  if (!headerKeys.lmStudioHost && process.env.LM_STUDIO_HOST) headerKeys.lmStudioHost = process.env.LM_STUDIO_HOST;
  if (!headerKeys.lmStudioPort && process.env.LM_STUDIO_PORT) headerKeys.lmStudioPort = process.env.LM_STUDIO_PORT;
  if (!headerKeys.lmStudioApiKey && process.env.LMSTUDIO_API_KEY) headerKeys.lmStudioApiKey = process.env.LMSTUDIO_API_KEY;

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
 * Check if a user has explicitly provisioned model access.
 * Returns:
 *   null  — user has full access (admin or unauthenticated)
 *   Set   — user may only use models in this set ("provider:model" keys)
 *           An empty Set means no models are allowed.
 */
const getAllowedModels = (userId) => {
  // Unauthenticated requests (API keys only, no JWT) get full access
  if (!userId) return null;

  try {
    runMigrations();
    const db = getDb();

    // Admins always have full access
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (user?.role === 'admin') return null;

    // Check if any access rules exist for this user (enabled or not)
    const anyRows = db.prepare(
      'SELECT COUNT(*) as count FROM user_model_access WHERE user_id = ?'
    ).get(userId);

    // No rules configured yet → deny all access (admin must provision first)
    if (anyRows.count === 0) return new Set();

    // Rules exist: return only models explicitly enabled
    const rows = db.prepare(
      'SELECT provider, model_id FROM user_model_access WHERE user_id = ? AND enabled = 1'
    ).all(userId);
    return new Set(rows.map(r => `${r.provider}:${r.model_id}`));
  } catch {
    // DB not ready, table missing — deny access to be safe
    return new Set();
  }
};

/**
 * Normalize response to OpenAI v1 format regardless of provider
 */
const normalizeToOpenAIFormat = (data, providerId, modelName) => {
  // DeepSeek / LM Studio — already OpenAI-compatible
  // Preserve cache hit tokens when present (DeepSeek disk cache)
  const usage = data.usage || {};
  // Preserve reasoning_content from providers that emit it (Qwen, DeepSeek R1, etc.)
  const normalizeMessage = (msg) => {
    const result = { role: msg?.role || 'assistant' };
    const rawContent = msg?.content || '';
    const rawReasoning = msg?.reasoning_content || '';

    // If the model spent all tokens on reasoning and produced no content,
    // surface the reasoning as content so the UI isn't blank
    if (!rawContent && rawReasoning) {
      result.content = rawReasoning;
      result.reasoning_content = rawReasoning;
      result.reasoning_truncated = true;
    } else {
      result.content = rawContent;
      if (rawReasoning) result.reasoning_content = rawReasoning;
    }

    // Preserve tool_calls if present
    if (msg?.tool_calls) result.tool_calls = msg.tool_calls;
    return result;
  };

  const rawChoices = data.choices || [{
    index: 0,
    message: { role: 'assistant', content: data.message?.content || '' },
    finish_reason: 'stop'
  }];

  return {
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: data.created || Math.floor(Date.now() / 1000),
    model: data.model || modelName,
    choices: rawChoices.map((c, i) => ({
      index: c.index ?? i,
      message: normalizeMessage(c.message),
      finish_reason: c.finish_reason || 'stop',
      logprobs: c.logprobs || null,
    })),
    usage: {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens || 0,
      prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens || 0,
    },
    system_fingerprint: 'fp_aurora'
  };
};

/**
 * Build the provider-specific request URL and body
 */
const buildProviderRequest = (provider, model, messages, temperature, maxTokens, stream = false, extraParams = {}) => {
  let url, body, headers = { 'Content-Type': 'application/json' };
  // Reasoning models (Qwen, DeepSeek R1, etc.) need more tokens — default 8192
  const effectiveMaxTokens = maxTokens || 8192;

  switch (provider.id) {
    case 'lmstudio':
      // LM Studio uses OpenAI-compatible /v1/chat/completions endpoint
      // Ensure /v1 prefix regardless of whether settings already includes it
      const lmBase = provider.baseUrl.endsWith('/v1') ? provider.baseUrl : `${provider.baseUrl}/v1`;
      url = `${lmBase}/chat/completions`;
      body = { model, messages, temperature, max_tokens: effectiveMaxTokens, stream, ...extraParams };
      // OpenAI-compatible: request usage stats in stream chunks (needed for token tracking)
      if (stream) {
        body.stream_options = { include_usage: true };
      }
      break;

    case 'deepseek':
      // DeepSeek uses OpenAI-compatible API
      // Thinking mode uses { "thinking": {"type": "enabled"} } + reasoning_effort (NOT extended_thinking)
      // In thinking mode temperature/top_p are ignored by DeepSeek
      url = `${provider.baseUrl}/chat/completions`;
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
      body = {
        model,
        messages,
        max_tokens: effectiveMaxTokens,
        stream,
        ...extraParams,
        // Only add temperature/top_p if NOT in thinking mode
        ...(extraParams.thinking || extraParams.reasoning_effort
          ? {}
          : { temperature }
        ),
      };
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
    
    // DEBUG: Log incoming request to diagnose Jinja template errors
    const msgRoles = messages.map(m => m.role).join(',');
    const msgTypes = messages.map(m => `${m.role}:${typeof m.content}${Array.isArray(m.content)?'['+m.content.length+']':''}`).join('|');
    console.log(`[COPILOT-DEBUG] model=${model} roles=[${msgRoles}] types=[${msgTypes}] bodyKeys=${Object.keys(body).join(',')}`);
    if (model.includes('qwen') || model.includes('coder')) {
      console.log('[COPILOT-DEBUG] Full body:', JSON.stringify(body).slice(0, 2000));
    }
    
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
    
    // Normalize messages for providers that use strict Jinja templates (LM Studio Qwen, etc.)
    // Some clients (Copilot LM API) may send content as arrays of parts; flatten to string
    // Also ensure string content for strict Jinja template compatibility
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Flatten array content to string
      if (Array.isArray(msg.content)) {
        msg.content = msg.content
          .map(part => (typeof part === 'string') ? part : (part.text || part.value || JSON.stringify(part)))
          .join('\n');
      }
      // Ensure content is a string
      if (typeof msg.content !== 'string') {
        msg.content = String(msg.content || '');
      }
    }
    
    // Ensure there's at least one user message (some Jinja templates require it)
    if (!messages.some(m => m.role === 'user')) {
      // If there's only a system prompt but no user message, move system to user
      const systemOnly = messages.every(m => m.role === 'system');
      if (systemOnly && messages.length > 0) {
        // Convert the last system message to user
        messages[messages.length - 1].role = 'user';
        console.log('[COPILOT-DEBUG] Normalized: converted last system→user');
      } else if (messages.length === 0) {
        messages.push({ role: 'user', content: 'Hello' });
        console.log('[COPILOT-DEBUG] Normalized: added default user message');
      } else {
        // Mixed roles but no user — convert first non-system to user
        const firstNonSystem = messages.findIndex(m => m.role !== 'system');
        if (firstNonSystem >= 0) {
          console.log(`[COPILOT-DEBUG] Normalized: converted messages[${firstNonSystem}] ${messages[firstNonSystem].role}→user`);
          messages[firstNonSystem].role = 'user';
        } else {
          console.log('[COPILOT-DEBUG] WARNING: no user message and no non-system to convert!');
          messages.push({ role: 'user', content: 'Hello' });
        }
      }
    }
    
    // DEBUG: Log messages AFTER normalization
    const normalizedRoles = messages.map(m => m.role).join(',');
    console.log(`[COPILOT-DEBUG] After normalization: roles=[${normalizedRoles}]`);

    // Extract API keys from request headers
    const keys = await extractKeysFromHeaders(request);
    const providers = getProviders(keys);

    // Select provider: explicit request > model-name match > first available
    let selectedProvider = null;

    if (requestedProvider) {
      selectedProvider = providers.find(p => p.id === requestedProvider);
      if (!selectedProvider) {
        // User explicitly asked for a provider that has no API key configured.
        // Do NOT silently fall back to another provider — that would route to the wrong model.
        return NextResponse.json(
          { error: { message: `Provider "${requestedProvider}" is not configured. Add an API key for it in Settings, or select a different model.`, type: 'configuration_error' } },
          { status: 400 }
        );
      }
    }

    if (!selectedProvider) {
      // Prefer provider that matches the model name
      // DeepSeek: models start with "deepseek-"
      // LM Studio: anything else (general-purpose model names)
      if (model.startsWith('deepseek-') && keys.deepseek) {
        selectedProvider = providers.find(p => p.id === 'deepseek');
      } else if (!model.startsWith('deepseek-') && providers.find(p => p.id === 'lmstudio')) {
        // Non-DeepSeek model: if LM Studio is available, use it
        selectedProvider = providers.find(p => p.id === 'lmstudio');
      }
    }

    if (!selectedProvider) {
      // Pick first available provider
      selectedProvider = providers[0];
    }

    if (!selectedProvider) {
      return NextResponse.json(
        { error: { message: 'No LLM provider configured. Set API keys in Settings or configure environment variables.', type: 'configuration_error' } },
        { status: 400 }
      );
    }

    // Model access gating: if admin has provisioned access for this user, check against the allowlist
    const userIdForAccess = getUserId(request);
    const allowedModels = getAllowedModels(userIdForAccess);
    if (allowedModels !== null && !allowedModels.has(`${selectedProvider.id}:${model}`)) {
      return NextResponse.json(
        { error: { message: `Model "${model}" is not available for your account. Contact your administrator.`, type: 'access_restricted' } },
        { status: 403 }
      );
    }

    // Build and send the provider request
    const streamMode = body.stream === true;
    console.log(`[Aurora] Request model="${model}" provider="${requestedProvider}" → selected="${selectedProvider?.id || 'none'}" providers=[${providers.map(p => p.id).join(',')}]`);
    const extraParams = {};
    // Anthropic-format thinking (LM Studio / Anthropic)
    if (body.extended_thinking) extraParams.extended_thinking = true;
    if (body.thinking) extraParams.thinking = body.thinking;
    // OpenAI-format thinking (DeepSeek): reasoning_effort + thinking: { type: "enabled" }
    if (body.reasoning_effort) extraParams.reasoning_effort = body.reasoning_effort;
    if (body.thinking_type === 'enabled') extraParams.thinking = { type: 'enabled' };
    // Native tool calling (OpenAI-compatible): pass tools + tool_choice through to provider
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      extraParams.tools = body.tools;
      extraParams.tool_choice = body.tool_choice || 'auto';
    }
    const { url, body: providerBody, headers } = buildProviderRequest(
      selectedProvider, model, messages, temperature, body.max_tokens, streamMode, extraParams
    );

    console.log(`[Aurora] Routing to ${selectedProvider.name} (${selectedProvider.id}) -> ${url}${streamMode ? ' [stream]' : ''}`);
    console.log(`[COPILOT-DEBUG] Sending to ${selectedProvider.id}: model=${providerBody.model} stream=${streamMode} msgs=${JSON.stringify(providerBody.messages?.map(m => ({role:m.role,content:typeof m.content==='string'?m.content.substring(0,100):typeof m.content})))}`);

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
      console.error(`[COPILOT-DEBUG] ${selectedProvider.id} HTTP ${response.status} — body: ${errorText.substring(0, 1000)}`);
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

      // Capture the final usage payload from the last SSE data chunk (with finish_reason: "stop")
      let finalUsage = null;

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
              // Relay SSE events as-is; capture usage from the last data chunk (finish_reason: stop)
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.usage) {
                      finalUsage = parsed.usage;
                    }
                  } catch {}
                }
                controller.enqueue(encoder.encode(line + '\n'));
              }
            }
          } catch (err) {
            console.error('[Aurora] Stream error:', err.message);
            controller.error(err);
          }
        }
      });

      // Track streaming usage — insert placeholder, then update when usage arrives
      const userId = getUserId(request);
      if (userId) {
        try {
          runMigrations();
          const db = getDb();
          const result = db.prepare(`
            INSERT INTO usage_records (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(userId, selectedProvider.id, model, 0, 0, 0, 0, 0);

          // After stream completes, update with actual usage (including cache tokens)
          const usageRecordId = result.lastInsertRowid;
          const updateUsage = () => {
            try {
              if (finalUsage) {
                db.prepare(`
                  UPDATE usage_records
                  SET prompt_tokens = ?, completion_tokens = ?, total_tokens = ?,
                      prompt_cache_hit_tokens = ?, prompt_cache_miss_tokens = ?
                  WHERE rowid = ?
                `).run(
                  finalUsage.prompt_tokens || 0,
                  finalUsage.completion_tokens || 0,
                  finalUsage.total_tokens || 0,
                  finalUsage.prompt_cache_hit_tokens || 0,
                  finalUsage.prompt_cache_miss_tokens || 0,
                  usageRecordId
                );
              }
            } catch (err) {
              console.error('[Aurora] Failed to update stream usage:', err.message);
            }
          };

          // Schedule update after stream finishes (won't block response)
          const scheduledStream = new ReadableStream({
            async start(controller) {
              const reader = stream.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  updateUsage();
                  controller.close();
                  break;
                }
                controller.enqueue(value);
              }
            }
          });

          return new Response(scheduledStream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'X-Provider': selectedProvider.id
            }
          });
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
    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      const rawText = await response.text().catch(() => '');
      console.error(`[COPILOT-DEBUG] ${selectedProvider.id} response.json() failed — raw body: ${rawText.substring(0, 2000)}`);
      throw new Error(`${selectedProvider.name} returned non-JSON response: ${rawText.substring(0, 200)}`);
    }
    console.log(`[Aurora] ${selectedProvider.id} raw response - id: ${data.id}, model: ${data.model}, choices: ${data.choices?.length || 0}, usage: ${JSON.stringify(data.usage || {})}`);
    if (data.choices?.[0]) {
      const c = data.choices[0];
      console.log(`[Aurora] choice[0] finish_reason: ${c.finish_reason}, content length: ${c.message?.content?.length || 0}, content[:200]: ${(c.message?.content || '').substring(0, 200)}`);
    } else {
      console.error(`[COPILOT-DEBUG] ${selectedProvider.id} response has no choices — full: ${JSON.stringify(data).substring(0, 1000)}`);
    }
    const normalized = normalizeToOpenAIFormat(data, selectedProvider.id, model);
    normalized.provider = selectedProvider.id;

    // Track usage — fire and forget (don't block the response)
    const userId = getUserId(request);
    if (userId) {
      try {
        runMigrations();
        const db = getDb();
        db.prepare(`
          INSERT INTO usage_records (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          selectedProvider.id,
          model,
          normalized.usage?.prompt_tokens || 0,
          normalized.usage?.completion_tokens || 0,
          normalized.usage?.total_tokens || 0,
          normalized.usage?.prompt_cache_hit_tokens || 0,
          normalized.usage?.prompt_cache_miss_tokens || 0
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