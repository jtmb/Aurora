// @aurora/api-gateway - Provider Adapters
// Handles direct API calls to underlying LLM providers
// Each adapter handles its specific authentication and response handling

/**
 * OpenAIAPIAdapter
 * Connects to OpenAI's Chat Completions API
 */
export class OpenAIAPIAdapter {
  /**
   * Create adapter instance with configuration
   * @param {Object} config - Adapter configuration
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.defaultModel = config.defaultModel || process.env.DEFAULT_MODEL || 'gpt-3.5-turbo';
  }

  /**
   * Fetch chat completion from OpenAI API
   */
  async fetchCompletion(options) {
    if (!this.apiKey) {
      throw new Error('OpenAI_API_KEY not configured');
    }

    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model: options.model || this.defaultModel,
      messages: options.messages,
      temperature: options.temperature ?? 1.0,
      top_p: options.top_p ?? 1.0,
      frequency_penalty: options.frequency_penalty ?? 0.0,
      presence_penalty: options.presence_penalty ?? 0.0,
      max_tokens: options.max_tokens,
      stream: options.stream
    };

    // Add optional params if provided
    if (options.stop) body.stop = options.stop;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
    });

    // Check for errors
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (errorData.error) {
        throw new Error(`OpenAI API error: ${errorData.error.message}`);
      }
      
      throw new Error(`OpenAI request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Check if model is available
   */
  async checkModelAvailability(model) {
    const url = `${this.baseUrl}/models`;
    
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      if (!response.ok) return null;

      const data = await response.json();
      
      const availableModels = data.data || [];
      return availableModels.some(m => m.id === model);
    } catch {
      return false;
    }
  }
}

/**
 * AnthropicAPIAdapter
 * Connects to Anthropic's Messages API (Claude)
 */
export class AnthropicAPIAdapter {
  /**
   * Create adapter instance with configuration
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.defaultModel = config.defaultModel || process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-20241022';
  }

  /**
   * Fetch chat completion from Anthropic API
   */
  async fetchCompletion(options) {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const url = this.baseUrl;

    // Build messages array in Anthropic format (already converted by injector)
    const messages = options.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user', // Convert 'system' to 'assistant'
      content: Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]
    }));

    const body = {
      model: options.model || this.defaultModel,
      max_tokens: options.max_tokens || 1024,
      messages,
      system: options.system, // Optional system prompt
      stream: options.stream
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (errorData.error) {
        throw new Error(`Anthropic API error: ${errorData.error.message}`);
      }
      
      throw new Error(`Anthropic request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Check model availability (Anthropic doesn't have a models endpoint, so we assume available)
   */
  async checkModelAvailability(model) {
    // Anthropic's supported models are documented here: https://docs.anthropic.com/claude/docs/models-overview
    return true;
  }
}

/**
 * OllamaAPIAdapter
 * Connects to Ollama's native API (local LLMs)
 */
export class OllamaAPIAdapter {
  /**
   * Create adapter instance with configuration
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.defaultModel = config.defaultModel || process.env.DEFAULT_MODEL;
  }

  /**
   * Fetch chat completion from Ollama API
   */
  async fetchCompletion(options) {
    // Check if model is loaded, try to pull if not
    await this.ensureModelLoaded(options.model);

    const url = `${this.baseUrl}/api/chat`;

    const body = {
      model: options.model || (this.defaultModel || 'qwen2.5:7b'),
      messages: options.messages.map(m => ({ role: m.role, content: m.content })),
      stream: options.stream,
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p ?? 0.9
    };

    // Add stop sequences if provided
    if (options.stop && Array.isArray(options.stop)) {
      body.stop = options.stop;
    } else if (typeof options.stop === 'string') {
      body.stop = [options.stop];
    }

    // Add max_tokens if provided (Ollama uses num_predict)
    if (options.max_tokens || options.top_p > 1) {
      const numPredict = options.max_tokens ?? this.getDefaultMaxTokens(options.model);
      body.num_predict = numPredict;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (errorData.error) {
        throw new Error(`Ollama API error: ${errorData.error}`);
      }
      
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Ensure model is loaded in Ollama container
   */
  async ensureModelLoaded(model) {
    try {
      const url = `${this.baseUrl}/api/show?name=${encodeURIComponent(model.split(':')[0] || 'qwen2.5:7b')}`;
      
      // Try to get model info (will fail if not loaded)
      try {
        await fetch(url);
        return true;
      } catch {
        // Model not found, pull it
        const pullUrl = `${this.baseUrl}/api/pull`;
        
        await fetch(pullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model.split(':')[0] })
        });
        
        return true;
      }
    } catch (err) {
      // Container might not be running - will handle in caller
      throw new Error('Ollama is not running or container not accessible');
    }
  }

  /**
   * Get default max tokens based on model name (simplified)
   */
  getDefaultMaxTokens(model) {
    const modelName = model.split(':')[0] || 'qwen2.5:7b';
    
    if (modelName.includes('codellama')) return 4096;
    if (modelName.includes('llava')) return 2048;
    return 2048; // Default for Qwen
  }
}

/**
 * LMStudioAPIAdapter
 * Connects to LM Studio's native API
 */
export class LMStudioAPIAdapter {
  /**
   * Create adapter instance with configuration
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234';
    this.apiKey = config.apiKey || '';
    this.defaultModel = config.defaultModel || process.env.DEFAULT_MODEL;
  }

  /**
   * Fetch chat completion from LM Studio API (OpenAI-compatible)
   */
  async fetchCompletion(options) {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body = {
      model: options.model || (this.defaultModel || 'qwen2.5:7b'),
      messages: options.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 1.0,
      top_p: options.top_p ?? 1.0,
      stream: options.stream
    };

    if (options.stop && Array.isArray(options.stop)) {
      body.stop = options.stop;
    } else if (typeof options.stop === 'string') {
      body.stop = [options.stop];
    }

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (errorData.error) {
        throw new Error(`LM Studio API error: ${errorData.error}`);
      }
      
      throw new Error(`LM Studio request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Check if model is loaded (by querying available models)
   */
  async checkModelAvailability(model) {
    try {
      const url = `${this.baseUrl}/v1/models`;
      const response = await fetch(url);
      
      if (!response.ok) return false;

      const data = await response.json();
      return (data.data || []).some(m => m.id === model);
    } catch {
      return false;
    }
  }
}

/**
 * GenericProviderAdapter
 * Fallback adapter for any OpenAI-compatible API
 */
export class GenericProviderAdapter {
  /**
   * Create generic adapter instance
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || '';
    this.apiKey = config.apiKey || '';
    this.defaultModel = config.defaultModel || process.env.DEFAULT_MODEL;
    this.supportsOpenAIFunctionCalling = config.supportsOpenAIFunctionCalling ?? true;
  }

  /**
   * Fetch chat completion from any OpenAI-compatible API
   */
  async fetchCompletion(options) {
    if (!this.baseUrl) {
      throw new Error('GenericProviderAdapter: No base URL configured');
    }

    const url = `${this.baseUrl}/v1/chat/completions`;

    const body = {
      model: options.model || this.defaultModel,
      messages: options.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 1.0,
      top_p: options.top_p ?? 1.0,
      stream: options.stream
    };

    // Add OpenAI-specific params if provider supports them
    if (options.frequency_penalty !== undefined) {
      body.frequency_penalty = options.frequency_penalty;
    }
    if (options.presence_penalty !== undefined) {
      body.presence_penalty = options.presence_penalty;
    }
    if (options.max_tokens) {
      body.max_tokens = options.max_tokens;
    }
    if (options.stop && Array.isArray(options.stop)) {
      body.stop = options.stop;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      throw new Error(`${response.status}: ${errorData.error?.message || response.statusText}`);
    }

    return response;
  }
}

/**
 * ProviderFactory
 * Factory for creating the appropriate provider adapter
 */
export class ProviderFactory {
  /**
   * Create adapter based on provider ID and configuration
   */
  static create(providerId, config) {
    const adapters = new Map([
      ['openai', OpenAIAPIAdapter],
      ['anthropic', AnthropicAPIAdapter],
      ['ollama', OllamaAPIAdapter],
      ['lmstudio', LMStudioAPIAdapter]
    ]);

    // Create adapter for known providers
    if (adapters.has(providerId)) {
      return new adapters.get(providerId)(config);
    }

    // Fallback to generic adapter for any other provider
    return new GenericProviderAdapter(config);
  }

  /**
   * Get adapter instance by ID (singleton pattern)
   */
  static getAdapter(providerId, config = {}) {
    const key = `${providerId}-${JSON.stringify(this.normalizeConfig(config))}`;
    
    if (!this.adapterCache.has(key)) {
      this.adapterCache.set(key, this.create(providerId, config));
    }

    return this.adapterCache.get(key);
  }

  /**
   * Clear adapter cache (useful for testing)
   */
  static clearCache() {
    this.adapterCache.clear();
  }
}

// Initialize cache as singleton in module scope
ProviderFactory.adapterCache = new Map();

export default ProviderFactory;