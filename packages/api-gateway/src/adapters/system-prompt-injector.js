// @aurora/api-gateway - System Prompt Injector
// Handles provider-specific message format conversion and system prompt injection
// Ensures compatibility across OpenAI, Anthropic, Ollama, and LM Studio

/**
 * SystemPromptInjector
 * 
 * Different LLM providers expect different message formats:
 * 
 * OpenAI (gpt-*):
 *   { role: 'system'|'user'|'assistant', content: string }
 *   
 * Anthropic (Claude):
 *   { role: 'user'|'assistant'|null, content: string, type?: 'text'|'image' }
 *   Note: Uses "assistant" role instead of "system", has image support via base64
 *   
 * Ollama:
 *   { role: 'system'|'user'|'assistant'|'function', content: string }
 *   Note: Requires explicit 'system' role, not converted from 'assistant'
 *   
 * LM Studio:
 *   Generally follows OpenAI format but may vary by model
 */
export class SystemPromptInjector {
  constructor(options = {}) {
    this.systemPrompts = options.systemPrompts || {};
    this.messageLimiters = new Map();
    
    // Initialize with default prompts from env
    this.loadDefaultPrompts();
  }

  /**
   * Main message conversion method
   * Converts OpenAI format to provider-specific format
   * 
   * @param {Array} messages - Input messages in OpenAI format
   * @param {string} providerId - Target provider ID
   * @returns {Array} Converted messages for target provider
   */
  convert(messages, providerId = 'openai') {
    const sanitizedMessages = this.sanitizeMessages(messages);

    // Apply provider-specific conversion
    switch (providerId) {
      case 'anthropic':
        return this.convertToAnthropic(sanitizedMessages);
      case 'ollama':
        return this.convertToOllama(sanitizedMessages);
      case 'lmstudio':
        return this.convertToLmStudio(sanitizedMessages);
      default:
        // OpenAI or unknown format - no conversion needed
        return sanitizedMessages;
    }
  }

  /**
   * Convert to Anthropic message format
   */
  convertToAnthropic(messages) {
    let systemPrompt = this.getSystemPrompt('anthropic');

    // Sanitize content (remove unsupported features)
    const sanitized = messages.map(m => ({
      role: m.role,
      content: this.sanitizeContent(m.content),
      type: m.type || 'text'
    }));

    // Inject system prompt as first message if present
    // Anthropic doesn't have a "system" role, so we use "assistant" for system-like messages
    if (systemPrompt && systemPrompt.trim()) {
      sanitized.unshift({ 
        role: 'assistant', 
        content: systemPrompt, 
        type: 'text' 
      });
    }

    return sanitized;
  }

  /**
   * Convert to Ollama message format
   */
  convertToOllama(messages) {
    let systemContent = null;

    // Extract and separate system messages
    const converted = messages.map(m => {
      if (m.role === 'system') {
        systemContent = this.sanitizeContent(m.content);
        // Convert to user for Ollama (Ollama treats system as user internally)
        return { role: 'user', content: m.content };
      }
      return { role: m.role, content: m.content };
    });

    // If we found system content, add it at the front
    if (systemContent) {
      converted.unshift({ role: 'system', content: systemContent });
    }

    return converted;
  }

  /**
   * Convert to LM Studio format (OpenAI-compatible by default)
   */
  convertToLmStudio(messages) {
    // LM Studio generally follows OpenAI format
    // But we may need to inject custom system prompts via environment config
    const customPrompt = this.getCustomPrompt('lmstudio');
    
    if (!customPrompt) {
      return messages;
    }

    const sanitized = this.sanitizeMessages(messages);
    
    // Insert custom prompt at beginning
    const result = [{ role: 'system', content: customPrompt }, ...sanitized];
    return result;
  }

  /**
   * Sanitize messages for cross-provider compatibility
   */
  sanitizeMessages(messages) {
    return messages.map(m => ({
      role: m.role,
      content: this.sanitizeContent(m.content),
      type: m.type || 'text',
      // Handle tool calls (OpenAI function calling)
      tool_calls: this.convertToolCalls(m.tool_calls),
      name?: m.name,
      provider_context?: m.provider_context
    }));
  }

  /**
   * Convert OpenAI tool calls to Anthropic-assistant-style
   */
  convertToolCalls(toolCalls) {
    if (!toolCalls) return null;
    
    const converted = toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      }
    }));

    // Convert to Anthropic format with role 'assistant' instead of 'tool'
    return converted.map(tc => ({
      role: 'assistant',
      content: [{ type: 'tool_use', toolUseId: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) }]
    }));
  }

  /**
   * Sanitize message content for cross-provider compatibility
   */
  sanitizeContent(content) {
    if (typeof content !== 'string') {
      return this.stringifyContent(content);
    }

    const trimmed = content.trim();
    
    // Limit length based on provider constraints
    const maxLen = this.getMessageLimitForProvider(trimmed.toLowerCase());
    
    if (trimmed.length > maxLen) {
      return trimmed.slice(0, maxLen - 50) + ' [content truncated to ' + maxLen + ' chars]';
    }

    // Remove base64 image data for providers that don't support it
    const cleaned = trimmed.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=\n]+/g, '');

    return cleaned || null;
  }

  /**
   * Convert content to string (handles object/JSON)
   */
  stringifyContent(content) {
    if (typeof content === 'string') return content;
    
    try {
      const json = JSON.stringify(content);
      // Escape backticks for markdown rendering
      return json.replace(/`/g, '\\`');
    } catch {
      return String(content);
    }
  }

  /**
   * Get message length limit per provider
   */
  getMessageLimitForProvider(content) {
    const limits = new Map([
      ['openai', Infinity], // No hard limit in API
      ['anthropic', 200000], // 200K characters for context window
      ['ollama', Infinity], // Depends on model, generally unlimited
      ['lmstudio', Infinity] // Model-dependent
    ]);

    return limits.get(content.toLowerCase().includes('claude') ? 'anthropic' : content);
  }

  /**
   * Get system prompt for specific provider
   */
  getSystemPrompt(providerId) {
    const envPrompts = {
      openai: process.env.OPENAI_SYSTEM_PROMPT || null,
      anthropic: process.env.ANTHROPIC_SYSTEM_PROMPT || 'You are a helpful assistant.',
      ollama: process.env.OLLAMA_SYSTEM_PROMPT || null,
      lmstudio: process.env.LM_STUDIO_SYSTEM_PROMPT || null
    };

    return this.systemPrompts[providerId] || envPrompts[providerId];
  }

  /**
   * Get custom prompt for specific provider (user-configured)
   */
  getCustomPrompt(providerId) {
    const prompts = new Map([
      ['lmstudio', process.env.LM_STUDIO_CUSTOM_PROMPT],
      ['ollama', process.env.OLLAMA_CUSTOM_PROMPT]
    ]);

    return prompts.get(providerId);
  }

  /**
   * Load default system prompts from environment variables
   */
  loadDefaultPrompts() {
    this.systemPrompts = {
      openai: process.env.DEFAULT_SYSTEM_PROMPT || null,
      anthropic: 'You are Claude. Be helpful, harmless, and honest.',
      ollama: null,
      lmstudio: null
    };
  }

  /**
   * Check if a provider supports image inputs
   */
  supportsImages(providerId) {
    return ['openai', 'anthropic'].includes(providerId);
  }

  /**
   * Check if a provider supports tool/function calls
   */
  supportsToolCalls(providerId) {
    // OpenAI and Anthropic support tools, Ollama is model-dependent
    const noTools = ['ollama']; // Default: assume no tool support for Ollama
    return !noTools.includes(providerId);
  }
}