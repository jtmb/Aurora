// @aurora/api-gateway - Chat Completions Router
// Main entry point for /v1/chat/completions OpenAI-compatible endpoint
// Handles request routing, provider selection, and response normalization

import { ModelRouterMiddleware } from '../middleware/model-router';
import { TokenUsageNormalizer } from '../adapters/token-normalizer';
import { SystemPromptInjector } from '../adapters/system-prompt-injector';

/**
 * ChatCompletionRouter - Core LLM API Gateway
 * 
 * Architecture:
 * 1. Receives OpenAI-compatible request at /v1/chat/completions
 * 2. Extracts user/session for model configuration lookup
 * 3. Routes to primary model provider based on config/priority
 * 4. Falls back to secondary providers if primary fails
 * 5. Normalizes response to OpenAI v1 format
 * 
 * @typedef {Object} ProviderConfig
 * @property {string} id - Provider identifier (openai|anthropic|ollama|lmstudio)
 * @property {string} baseUrl - Base URL for API endpoint
 * @property {string} apiKey - API key for authentication
 * @property {number} priority - Routing priority (lower = higher priority)
 * @property {boolean} enabled - Whether this provider is active
 */

/**
 * Normalized Chat Completion Response (OpenAI v1 format)
 * @typedef {Object} NormalizedResponse
 * @property {string} id - Unique request ID
 * @property {string} object - Always "chat.completion" or "chat.completion.chunk"
 * @property {string} model - Model identifier used
 * @property {Array} choices - Array of completion choices
 * @property {number} usage - Token usage (prompt_tokens, completion_tokens, total_tokens)
 * @property {number} created - Unix timestamp
 * @property {Object} system_fingerprint - Deployment fingerprint
 */

/**
 * Model Router Middleware
 * Implements intelligent model selection with fallback strategy
 */
class ModelRouterMiddleware {
  /**
   * Routes request to appropriate provider based on:
   * 1. Primary model configuration (if set)
   * 2. Auto-detection based on response format capability
   * 3. Fallback chain for fault tolerance
   * 
   * @param {{request: any, providerConfigs: ProviderConfig[], fallbackChain: string[]}} ctx - Context object
   * @returns {Promise<string>} Selected provider ID
   */
  async routeToProvider(ctx) {
    const { request, providerConfigs, fallbackChain } = ctx;

    // Check for explicit model preference in headers
    const preferredModel = this.extractModelPreference(request);

    // Build routing decision tree
    let selectedProvider = null;
    let reason = '';

    if (preferredModel) {
      selectedProvider = this.findProviderById(preferredModel);
      reason = `User specified model: ${preferredModel}`;
    } else {
      // Auto-select based on priority and enabled status
      selectedProvider = providerConfigs.find(p => p.enabled && p.priority === 1) || 
                         providerConfigs.find(p => p.enabled) || null;
      reason = 'Auto-selected primary provider';
    }

    if (!selectedProvider) {
      throw new Error('No available providers configured');
    }

    return selectedProvider.id;
  }

  /**
   * Extract model preference from request headers (if present)
   */
  extractModelPreference(request) {
    const authHeader = request.headers?.authorization || '';
    const modelHeader = request.headers?.['x-aux-model'] || '';
    
    // Parse Bearer token for model info (future: JWT claims)
    if (authHeader.startsWith('Bearer ')) {
      const userId = this.extractUserIdFromToken(authHeader.substring(7));
      // Check session for preferred model from user settings
      return null; // Would check database here in production
    }
    
    return modelHeader || null;
  }

  /**
   * Find provider by ID or alias
   */
  findProviderById(id) {
    return Array.from(this.providerConfigs.values()).find(p => p.id === id);
  }

  /**
   * Process fallback chain when primary fails
   */
  async processFallback(currentError, retryConfig = {}) {
    const { maxRetries = 3, backoffMs = 1000 } = retryConfig;

    for (let i = 1; i <= maxRetries; i++) {
      try {
        await new Promise(resolve => setTimeout(resolve, backoffMs * i));
        
        const nextProvider = Array.from(this.providerConfigs.values())
          .find(p => p.enabled && p.id !== currentError.provider);
        
        if (!nextProvider) {
          throw new Error('All providers exhausted');
        }

        return this.routeToProvider({
          request: this.request,
          providerConfigs: [{ id: nextProvider.id, ...nextProvider }],
          fallbackChain: [currentError.provider, nextProvider.id]
        });
      } catch (err) {
        continue; // Try next provider on error
      }
    }

    throw new Error('Gateway: All fallback providers failed');
  }
}

/**
 * System Prompt Injector
 * Injects system prompts and formats messages for non-OpenAI providers
 */
class SystemPromptInjector {
  /**
   * Converts OpenAI format to Anthropic messages format if needed
   * @param {Array} messages - OpenAI format messages
   * @param {string} providerId - Target provider ID
   * @returns {Array} Provider-specific message format
   */
  convertMessages(messages, providerId) {
    const systemPrompt = this.getSystemPromptForProvider(providerId);

    // Anthropic uses "anthropic" role instead of "system"
    if (providerId === 'anthropic') {
      const converted = messages.map(m => ({
        role: m.role === 'system' ? 'assistant' : m.role,
        content: this.sanitizeContent(m.content)
      }));
      
      // Inject system prompt as first message
      if (systemPrompt) {
        converted.unshift({ role: 'assistant', content: systemPrompt });
      }
      return converted;
    }

    // Ollama/LM Studio may need model-specific formatting
    if (providerId === 'ollama' || providerId === 'lmstudio') {
      return this.ollamaFormat(messages);
    }

    return messages; // OpenAI/Generic: no conversion needed
  }

  /**
   * Ollama uses "system" role, not "assistant"
   */
  ollamaFormat(messages) {
    let systemContent = null;
    const converted = messages.map(m => {
      if (m.role === 'system') {
        systemContent = m.content;
        return { role: 'user', content: m.content };
      }
      return { role: m.role, content: m.content };
    });

    if (systemContent) {
      converted.unshift({ role: 'system', content: systemContent });
    }
    return converted;
  }

  /**
   * Sanitize content by removing potentially problematic characters
   */
  sanitizeContent(content) {
    // Remove base64 encoded images for providers that don't support them
    const result = content.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=\n]+/g, '');
    
    // Limit length if too long (Claude has different limits than OpenAI)
    if (result.length > 128 * 1024) {
      return result.slice(0, 128 * 1024) + ' [content truncated]';
    }
    
    return result;
  }

  /**
   * Get system prompt for specific provider (configured via env or settings)
   */
  getSystemPromptForProvider(providerId) {
    const prompts = {
      openai: process.env.OPENAI_SYSTEM_PROMPT || 'You are a helpful assistant.',
      anthropic: process.env.ANTHROPIC_SYSTEM_PROMPT || 'You are a helpful assistant. Use the Claude model conventions.',
      ollama: process.env.OLLAMA_SYSTEM_PROMPT || null,
      lmstudio: process.env.LM_STUDIO_SYSTEM_PROMPT || null
    };

    return prompts[providerId];
  }

  /**
   * Extract user ID from JWT token (simple implementation)
   */
  extractUserIdFromToken(token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return payload.sub || payload.userId || null;
    } catch {
      return null;
    }
  }
}

/**
 * Token Usage Normalizer
 * Standardizes token counts across providers to OpenAI format
 */
class TokenUsageNormalizer {
  /**
   * Normalizes provider-specific usage data to OpenAI format
   * @param {Object} rawUsage - Raw usage from API response
   * @param {string} providerId - Provider that returned the usage
   * @returns {OpenAIUsage} Normalized usage object
   */
  normalizeUsage(rawUsage, providerId) {
    const normalized = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    // OpenAI format (already compatible)
    if (rawUsage.prompt_tokens !== undefined) {
      return rawUsage;
    }

    // Anthropic uses input/output tokens with different names
    if (providerId === 'anthropic') {
      normalized.input_tokens = rawUsage?.input_tokens || 0;
      normalized.output_tokens = rawUsage?.output_tokens || 0;
      normalized.total_tokens = normalized.input_tokens + normalized.output_tokens;
      
      // Convert to OpenAI naming for compatibility
      return {
        prompt_tokens: normalized.input_tokens,
        completion_tokens: normalized.output_tokens,
        total_tokens: normalized.total_tokens
      };
    }

    // Ollama/LM Studio use various formats
    if (providerId === 'ollama' || providerId === 'lmstudio') {
      const raw = rawUsage;
      normalized.completion_tokens = raw?.num_generated_tokens || 0;
      
      // Try to estimate prompt tokens from total minus completion
      const total = raw?.num_predict || raw?.total_tokens || 0;
      normalized.prompt_tokens = Math.max(0, total - normalized.completion_tokens);
      normalized.total_tokens = total;
    }

    return normalized;
  }
}

/**
 * Main Chat Completions Router Implementation
 */
export class ChatCompletionRouter {
  constructor(options = {}) {
    this.modelRouter = new ModelRouterMiddleware();
    this.systemInjector = new SystemPromptInjector();
    this.tokenNormalizer = new TokenUsageNormalizer();
    this.providerConfigs = options.providerConfigs || [];
    this.retryConfig = options.retryConfig || {};
    
    // Cache for response streaming state
    this.streamState = {
      chunksSent: 0,
      isStreaming: false
    };
  }

  /**
   * Main chat completions handler (OpenAI v1 format)
   */
  async handleChatCompletions(rawRequest, headers) {
    const request = this.parseRequest(rawRequest);

    // Validate and extract required fields
    if (!request.messages || !Array.isArray(request.messages)) {
      throw new Error('Missing or invalid messages array');
    }

    const modelName = request.model || this.getDefaultModel();
    
    // Prepare routing context
    const ctx = {
      request,
      providerConfigs: this.getAvailableProviders(),
      fallbackChain: ['openai', 'anthropic', 'ollama']
    };

    try {
      // Route to primary provider
      const selectedProviderId = await this.modelRouter.routeToProvider(ctx);
      
      // Inject system prompt if needed
      const formattedMessages = this.systemInjector.convertMessages(
        request.messages, 
        selectedProviderId
      );

      // Call underlying provider API
      const providerResponse = await this.callProvider(selectedProviderId, {
        model: modelName,
        messages: formattedMessages,
        temperature: request.temperature,
        top_p: request.top_p,
        frequency_penalty: request.frequency_penalty,
        presence_penalty: request.presence_penalty,
        max_tokens: request.max_tokens,
        stream: !!request.stream,
        stop: request.stop
      });

      // Normalize usage data to OpenAI format
      const normalizedResponse = this.normalizeToOpenAIFormat(providerResponse, selectedProviderId);

      return { ...normalizedResponse, provider: selectedProviderId };

    } catch (error) {
      // Check if it's a fallback-worthy error
      if (this.shouldFallback(error)) {
        try {
          throw await this.modelRouter.processFallback(error, this.retryConfig);
        } catch (fallbackError) {
          return this.createErrorResponse(fallbackError.message);
        }
      }
      
      throw error;
    }
  }

  /**
   * Call underlying provider API
   */
  async callProvider(providerId, params) {
    // In production: Fetch from actual provider endpoint
    // For scaffold: Return mock response structure
    return {
      id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: this.generateMockResponse(params) },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 128,
        completion_tokens: 64,
        total_tokens: 192
      },
      created: Date.now() / 1000,
      model: params.model || 'gpt-3.5-turbo'
    };
  }

  /**
   * Normalize response to OpenAI v1 format
   */
  normalizeToOpenAIFormat(providerResponse, providerId) {
    const base = {
      ...providerResponse,
      object: 'chat.completion',
      system_fingerprint: process.env.SYSTEM_FINGERPRINT || 'fp_default'
    };

    // Handle streaming responses separately
    if (providerResponse.choices?.[0]?.delta && !providerResponse.usage) {
      return providerResponse;
    }

    // Normalize Anthropic usage
    if (providerId === 'anthropic') {
      base.usage = this.tokenNormalizer.normalizeUsage(base.usage || {}, 'anthropic');
    }

    // Ensure OpenAI format fields exist
    base.usage = base.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    return base;
  }

  /**
   * Generate mock response for testing (replace with actual provider call in production)
   */
  generateMockResponse(params) {
    const model = params.model || 'gpt-3.5-turbo';
    
    if (model.includes('ollama') || model.includes('llama')) {
      return `This is a mock response from the ${model} model. In production, this would be the actual completion from your configured provider.`;
    }

    return 'Hello! This is Aurora Gateway responding to your chat completion request. I\'m ready to help you with any tasks or questions.';
  }

  /**
   * Determine if error warrants fallback strategy
   */
  shouldFallback(error) {
    const retryable = ['timeout', 'rate_limit', 'service_unavailable', 'unavailable'];
    return error && retryable.some(r => error.message?.includes(r.toLowerCase()));
  }

  /**
   * Create standard OpenAI API error response
   */
  createErrorResponse(message) {
    return {
      error: {
        message: message,
        type: 'invalid_request_error',
        param: null,
        code: 'generic'
      }
    };
  }

  /**
   * Parse incoming request to OpenAI-compatible format
   */
  parseRequest(rawRequest) {
    return {
      messages: rawRequest.messages || [],
      model: rawRequest.model,
      temperature: rawRequest.temperature ?? 1.0,
      top_p: rawRequest.top_p ?? 1.0,
      frequency_penalty: rawRequest.frequency_penalty ?? 0.0,
      presence_penalty: rawRequest.presence_penalty ?? 0.0,
      max_tokens: rawRequest.max_tokens,
      stream: !!rawRequest.stream,
      stop: rawRequest.stop
    };
  }

  /**
   * Get default model when none specified
   */
  getDefaultModel() {
    return process.env.DEFAULT_MODEL || 'gpt-3.5-turbo';
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders() {
    return this.providerConfigs;
  }

  /**
   * Stream chat completions (OpenAI streaming format)
   */
  async streamChatCompletions(messages, options = {}) {
    const { temperature = 1.0, top_p = 1.0 } = options;

    // In production: Set up streaming with SSE events
    // For scaffold: Simulate streaming chunks
    
    const response = new Response(null, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

    try {
      await this.handleChatCompletions({ messages }, {});
      
      // Send final completion event
      const data = JSON.stringify({
        id: `chat-${Date.now()}`,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', content: '' } }]
      });
      await response.write(`data: ${data}\n\n`);

    } catch (error) {
      await response.write('data: [ERROR]\n\n');
      await response.write(JSON.stringify(error));
    }

    return response;
  }
}

export default ChatCompletionRouter;