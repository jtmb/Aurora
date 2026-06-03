// @aurora/api-gateway - Main entry point for the LLM API Gateway
// This package provides OpenAI-compatible chat completions endpoint
// with multi-model provider support (OpenAI, Anthropic, Ollama, LM Studio)

import { ChatCompletionRouter } from './routers/chat-completions';
import { ModelRouterMiddleware } from './middleware/model-router';
import { TokenUsageNormalizer } from './adapters/token-normalizer';
import { SystemPromptInjector } from './adapters/system-prompt-injector';

// Export core classes for use in Next.js routes
export { ChatCompletionRouter };
export { ModelRouterMiddleware };
export { TokenUsageNormalizer };
export { SystemPromptInjector };

// Default export: Main router instance (to be configured with env vars)
export function createGateway() {
  return new ChatCompletionRouter();
}