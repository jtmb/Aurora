// @aurora/api-gateway - Model Router Middleware
// Provides intelligent provider selection with fallback chain strategy
// and handles model-specific configuration injection

/**
 * Configuration for model routing decision-making
 */
export class ModelRouterMiddleware {
  /**
   * Initialize with provider configurations
   * @param {Object} options
   * @param {Array<string>} options.providerIds - Ordered list of available providers
   * @param {Object} options.configs - Provider-specific configurations
   */
  constructor(options = {}) {
    this.providerIds = options.providerIds || ['openai', 'anthropic', 'ollama', 'lmstudio'];
    this.configs = options.configs || {};
    
    // Track routing decisions for analytics (disabled by default)
    this.routingStats = new Map();
  }

  /**
   * Main routing decision method
   * 
   * Decision Flow:
   * 1. Check for explicit model preference in headers/session
   * 2. Fall back to configured primary provider
   * 3. Enable fallback chain on error (configured via ENV)
   * 
   * @param {Object} request - Incoming request with headers and session info
   * @param {string} userApiKey - User's API key for authentication
   * @param {boolean} enableFallback - Whether to enable automatic provider fallback
   * @returns {{providerId: string, reason: string, config: Object}} Routing decision
   */
  async route(request, userApiKey = null, enableFallback = true) {
    const decisionLog = [];

    // Step 1: Check for explicit model preference
    const explicitModel = this.getExplicitModelPreference(request);
    
    if (explicitModel) {
      return this.resolveProvider(explicitModel, decisionLog);
    }

    // Step 2: Get primary provider from config
    let selectedProviderId = this.configs.primaryProvider || 
                               this.providerIds[0];

    // Step 3: Verify provider is enabled and has valid credentials
    const providerConfig = this.getProviderConfig(selectedProviderId);
    
    if (!providerConfig || !providerConfig.enabled) {
      throw new Error(`Primary provider "${selectedProviderId}" is disabled`);
    }

    // Validate credentials (check API key exists for authenticated users)
    if (userApiKey && !this.validateCredentials(providerConfig)) {
      throw new Error(`Invalid credentials for provider: ${selectedProviderId}`);
    }

    decisionLog.push({
      step: 'primary_selection',
      providerId: selectedProviderId,
      reason: 'Primary enabled provider'
    });

    return {
      providerId: selectedProviderId,
      reason: `Selected primary provider: ${selectedProviderId}`,
      config: this.buildProviderConfig(providerConfig)
    };
  }

  /**
   * Process fallback chain when primary provider fails
   */
  async processFallback(error, request, userApiKey = null) {
    const originalProvider = error.provider;
    
    if (!originalProvider) {
      throw new Error('Cannot fallback: No provider info in error');
    }

    // Check fallback configuration
    const fallbackEnabled = this.configs.fallbackEnabled ?? 
                           process.env.GATEWAY_FALLBACK_ENABLED === 'true';
    
    if (!fallbackEnabled) {
      throw new Error(`Provider "${originalProvider}" failed and fallback is disabled`);
    }

    // Build fallback chain: skip failed provider, try next enabled one
    const remainingProviders = this.providerIds.filter(
      id => id !== originalProvider && 
             (this.configs[id]?.enabled ?? true)
    );

    for (const candidateId of remainingProviders) {
      try {
        const retryAfterMs = 1000 * Math.min(this.configs.retryDelay || 5, 60);
        await new Promise(resolve => setTimeout(resolve, retryAfterMs));

        decisionLog.push({
          step: 'fallback_attempt',
          failedProvider: originalProvider,
          attemptedProvider: candidateId,
          reason: `Fallback from ${originalProvider} after error: ${error.message}`
        });

        return this.resolveProvider(candidateId, decisionLog);
      } catch (retryError) {
        decisionLog.push({
          step: 'fallback_attempt_failed',
          failedProvider: originalProvider,
          attemptedProvider: candidateId,
          reason: `Fallback to ${candidateId} also failed`
        });
        
        // Continue to next provider on this error
        if (retryError.provider === candidateId) {
          continue;
        }
        
        throw retryError;
      }
    }

    throw new Error('All fallback providers exhausted');
  }

  /**
   * Get explicit model preference from request
   * Checks: headers, session storage, user settings
   */
  getExplicitModelPreference(request) {
    // Check X-Aux-Model header (for direct model selection)
    const auxModel = request.headers?.['x-aux-model']?.toLowerCase();
    if (auxModel && this.configs[auxModel]) {
      return auxModel;
    }

    // Check Accept-Encoding for quantized models preference
    const acceptEncoding = request.headers?.['accept-encoding'];
    if (acceptEncoding && this.configs.gpt35Quant) {
      // User prefers gpt-3.5-turbo-kimi-v2:6b
      return 'gpt-3.5-turbo-kimi-v2:6b';
    }

    return null;
  }

  /**
   * Resolve provider ID to full configuration object
   */
  resolveProvider(providerId, decisionLog = []) {
    const config = this.getProviderConfig(providerId);
    
    if (!config) {
      throw new Error(`No configuration found for provider: ${providerId}`);
    }

    // Validate that model is available in the current environment
    const modelStatus = this.checkModelAvailability(config.model);
    
    if (modelStatus.status === 'unavailable') {
      throw new Error(`${config.model} is not available in the current environment`);
    }

    decisionLog.push({
      step: 'provider_resolved',
      providerId,
      model: config.model,
      status: modelStatus.status
    });

    return {
      providerId,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey, // In production: never expose in logs
      model: config.model,
      enabled: config.enabled,
      costPerToken: config.costPerToken
    };
  }

  /**
   * Get provider configuration by ID
   */
  getProviderConfig(providerId) {
    return this.configs[providerId] || null;
  }

  /**
   * Build final API endpoint configuration from base config
   */
  buildProviderConfig(baseConfig) {
    const env = process.env;
    
    // Use environment overrides for common fields
    return {
      ...baseConfig,
      baseUrl: env[`${providerId.toUpperCase()}_BASE_URL`] || baseConfig.baseUrl,
      apiKey: env[`${providerId.toUpperCase()}_API_KEY`] || baseConfig.apiKey,
      model: env[`${providerId.toUpperCase()}_DEFAULT_MODEL`] || baseConfig.model
    };
  }

  /**
   * Validate API credentials (simplified check)
   */
  validateCredentials(config) {
    if (!config.apiKey) {
      return false;
    }

    // In production: Perform actual credential validation
    // For now: Return true if key has minimum length
    return config.apiKey.length > 10;
  }

  /**
   * Check model availability in current environment
   */
  checkModelAvailability(modelName) {
    const availableModels = process.env.MODEL_AVAILABILITY?.split(',') || [];
    
    if (availableModels.includes(modelName)) {
      return { status: 'available' };
    }

    // Ollama models are auto-detectable based on container registry
    if (modelName.startsWith('ollama/')) {
      return { status: 'auto_detect' };
    }

    return { status: 'unknown' };
  }

  /**
   * Get primary provider ID from configuration
   */
  getPrimaryProvider() {
    return this.configs.primaryProvider || this.providerIds[0];
  }

  /**
   * Check if fallback is enabled for a given provider
   */
  isFallbackEnabled(providerId) {
    return (this.configs.fallbackEnabled ?? true) && 
           !this.configs[providerId]?.fallbackDisabled;
  }

  /**
   * Log routing decision for analytics/observability
   */
  logRoutingDecision(decision, latencyMs = null) {
    const key = `${decision.providerId}-${decision.model || ''}`;
    
    this.routingStats.set(key, (this.routingStats.get(key) || 0) + 1);

    // Export to monitoring system in production
    if (env.METRICS_EXPORT_ENABLED) {
      metricsService.recordRoutingDecision(decision, latencyMs);
    }
  }
}