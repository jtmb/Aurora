// @aurora/shared - Shared Type Definitions
// Shared type definitions used across all services (JavaScript version)

/**
 * OpenAI Compatible Request Shape
 */
export const OPEN_AI_COMPATIBLE_REQUEST_SHAPE = {
  messages: [{ role: 'user' | 'system' | 'assistant', content: String }],
  model: String,
  temperature: Number,
  top_p: Number,
  frequency_penalty: Number,
  presence_penalty: Number,
  max_tokens: Number,
  stop: [String],
  stream: Boolean
};

/**
 * OpenAI Compatible Response Shape
 */
export const OPEN_AI_COMPATIBLE_RESPONSE_SHAPE = {
  id: String,
  object: 'chat.completion' | 'chat.completion.chunk',
  choices: [{
    index: Number,
    message: {
      role: 'assistant' | 'user' | 'system',
      content: String,
      tool_calls: [
        {
          id: String,
          type: 'function',
          function: { name: String, arguments: String }
        }
      ]
    },
    finish_reason: 'stop' | 'length' | 'tool_calls' || null
  }],
  usage: {
    prompt_tokens: Number,
    completion_tokens: Number,
    total_tokens: Number
  },
  created: Number,
  provider: String // Which provider generated the response
};

/**
 * Provider configuration for routing decisions
 */
export const PROVIDER_CONFIG_SHAPE = {
  id: 'openai' | 'anthropic' | 'ollama' | 'lmstudio',
  enabled: Boolean,
  priority: Number,
  baseUrl: String,
  apiKey: String || undefined,
  model: String,
  fallbackEnabled: Boolean || undefined,
  fallbackDisabled: Boolean || undefined
};

/**
 * User session data structure
 */
export const USER_SESSION_SHAPE = {
  id: String,
  userId: String,
  token: String,
  createdAt: Date,
  lastAccessed: Date,
  status: 'active' | 'inactive' | 'expired',
  requestCounters: Number || undefined
};

/**
 * API Key structure (stored in database)
 */
export const API_KEY_RECORD_SHAPE = {
  id: String,
  userId: String,
  provider: 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'LM_STUDIO',
  keyHash: String,
  isPrimary: Boolean,
  name: String || undefined,
  lastRotated: Date || undefined,
  rotationCount: Number,
  revokedAt: Date || undefined,
  createdAt: Date
};

/**
 * Chat message structure (database model)
 */
export const CHAT_MESSAGE_SHAPE = {
  id: String,
  chatId: String,
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'FUNCTION',
  content: String || undefined,
  model: String || undefined,
  finishReason: 'STOP' | 'LENGTH' | 'FUNCTION_CALL' || null,
  provider: String || undefined,
  tokensUsed: Number,
  createdAt: Date
};

/**
 * Usage metrics for analytics (aggregated by minute)
 */
export const USAGE_METRICS_SHAPE = {
  id: String,
  userId: String || undefined, // Null for system-wide metrics
  chatId: String || undefined,
  provider: String,
  model: String,
  tokensUsed: Number,
  costUSD: Number || undefined,
  timestamp: Date
};

/**
 * Error types for gateway errors
 */
export class GatewayError extends Error {
  constructor(message, code = 'GATEWAY_ERROR', provider, retryable = false) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.provider = provider;
    this.retryable = retryable;
  }
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Provider availability status constants
 */
export const PROVIDER_STATUS = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  DEGRADED: 'degraded',
  UNKNOWN: 'unknown'
};

/**
 * Message type for streaming responses
 */
export const STREAM_CHUNK_TYPE = {
  CONTENT: 'content',
  DONE: 'done',
  ERROR: 'error',
  KEEPALIVE: 'keepalive'
};

/**
 * Model information structure
 */
export const MODEL_INFO_SHAPE = {
  id: String,
  name: String,
  contextWindow: Number,
  pricing: {
    promptPerMille: Number || undefined,
    completionPerMille: Number || undefined
  } || undefined
};