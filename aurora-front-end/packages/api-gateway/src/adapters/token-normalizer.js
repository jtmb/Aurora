// @aurora/api-gateway - Token Usage Normalizer
// Standardizes token usage reporting across all LLM providers to OpenAI format
// Ensures consistent analytics and billing regardless of underlying provider

/**
 * TokenUsageNormalizer
 * 
 * Different providers use different field names for token counts:
 * - OpenAI: prompt_tokens, completion_tokens, total_tokens
 * - Anthropic: input_tokens, output_tokens, total_tokens  
 * - Ollama: num_predict (completion), total_tokens (or inferred)
 * - LM Studio: varies by endpoint implementation
 * 
 * This normalizer converts all to OpenAI's standard format.
 */
export class TokenUsageNormalizer {
  /**
   * Normalize raw usage data from any provider to OpenAI format
   * 
   * @param {Object} rawUsage - Usage object from provider response
   * @param {string} providerId - ID of provider that returned the usage
   * @returns {Object} Normalized OpenAI-format usage object
   */
  normalize(rawUsage, providerId = 'openai') {
    if (!rawUsage) {
      return this.createEmptyUsage();
    }

    // OpenAI format (already compatible)
    if (this.isOpenAIFormat(rawUsage)) {
      return rawUsage;
    }

    // Anthropic uses input/output tokens
    if (providerId === 'anthropic' || providerId === 'claude') {
      return this.convertAnthropicFormat(rawUsage);
    }

    // Ollama format
    if (providerId === 'ollama') {
      return this.convertOllamaFormat(rawUsage);
    }

    // LM Studio or unknown format
    return this.tryCommonFormats(rawUsage);
  }

  /**
   * Check if usage is already in OpenAI format
   */
  isOpenAIFormat(usage) {
    return !!usage.prompt_tokens && 
           (usage.completion_tokens || usage.output_tokens);
  }

  /**
   * Convert Anthropic's input/output format to OpenAI format
   */
  convertAnthropicFormat(rawUsage) {
    const normalized = {
      prompt_tokens: rawUsage.input_tokens || 0,
      completion_tokens: rawUsage.output_tokens || 0,
      total_tokens: rawUsage.input_tokens + rawUsage.output_tokens || 0,
      // Preserve other fields for compatibility
      cost?: rawUsage.cost || null,
      cache_read_tokens?: rawUsage.cache_read_tokens || null,
      cache_creation_tokens?: rawUsage.cache_creation_tokens || null
    };

    return normalized;
  }

  /**
   * Convert Ollama's num_predict format to OpenAI format
   */
  convertOllamaFormat(rawUsage) {
    const completionTokens = rawUsage.num_generated_tokens || 
                             rawUsage.num_predict || 0;
    
    // Ollama often reports total tokens including prompt in num_predict
    const totalTokens = rawUsage.total_tokens || rawUsage.num_predict || completionTokens;
    
    // Prompt tokens = total - completion (best estimate)
    const promptTokens = Math.max(0, totalTokens - completionTokens);

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
    };
  }

  /**
   * Try common formats for unknown providers
   */
  tryCommonFormats(rawUsage) {
    // Try various field name permutations
    const promptToken = rawUsage.prompt_tokens || 
                        rawUsage.inputTokens || 
                        rawUsage.para_input_tokens ||
                        rawUsage['input_tokens'] ||
                        0;

    const completionToken = rawUsage.completion_tokens || 
                            rawUsage.output_tokens || 
                            rawUsage.outputTokens ||
                            rawUsage.num_generated_tokens ||
                            0;

    const totalToken = rawUsage.total_tokens || 
                       rawUsage.para_prompt_tokens + rawUsage.num_predict ||
                       promptToken + completionToken;

    return {
      prompt_tokens: promptToken,
      completion_tokens: completionToken,
      total_tokens: totalToken
    };
  }

  /**
   * Create empty usage object (for errors or missing data)
   */
  createEmptyUsage() {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
  }

  /**
   * Format usage for display/serialization
   */
  formatForDisplay(usage) {
    const formatted = { ...usage };
    
    // Add human-readable token labels
    if (formatted.total_tokens > 0) {
      formatted['~$'] = this.estimateCost(formatted);
    }
    
    return formatted;
  }

  /**
   * Estimate cost based on typical rates (simplified)
   */
  estimateCost(usage) {
    const ratePerMille = 0.15; // ~$0.15 per 1M tokens average
    
    if (!usage.total_tokens) return 0;
    
    return (usage.total_tokens / 1000000) * ratePerMille.toFixed(4);
  }

  /**
   * Aggregate usage from multiple responses (e.g., streaming chunks)
   */
  aggregate(usages) {
    const aggregated = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    for (const usage of usages) {
      if (usage.prompt_tokens) aggregated.prompt_tokens += usage.prompt_tokens;
      if (usage.completion_tokens) aggregated.completion_tokens += usage.completion_tokens;
      if (usage.total_tokens) aggregated.total_tokens += usage.total_tokens;
    }

    return aggregated;
  }
}