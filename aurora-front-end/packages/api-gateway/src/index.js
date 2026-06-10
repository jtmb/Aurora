// @aurora/api-gateway - Main router with environment variable fallbacks for LM Studio
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Aurora API Gateway
 * 
 * This service routes requests to different model providers based on configuration.
 * Supports OpenAI, Anthropic, Ollama, and LM Studio.
 * 
 * Configuration Priority:
 * 1. Environment variables (.env)
 * 2. localStorage (for development/testing without .env)
 * 
 * Usage:
 * - Set OPENAI_API_KEY in .env for OpenAI proxy
 * - Set LOSTUDIO_HOST=localhost, LM_STUDIO_PORT=1234 for local LM Studio
 */

// Get API keys from environment variables first, then fall back to localStorage
const getApiKey = (keyName) => {
  // Try environment variable first (production)
  const envKey = process.env[`${keyName}_API_KEY`];
  
  if (envKey) {
    return envKey;
  }
  
  // Fall back to localStorage (development/demo mode)
  const localStorageKey = localStorage.getItem(keyName);
  return localStorageKey || '';
};

// Get Ollama base URL from environment or localStorage
const getOllamaBase = () => {
  const envBase = process.env.OLLAMA_API_BASE;
  const localStorageBase = localStorage.getItem('OLLAMA_API_BASE');
  
  return envBase || (localStorageBase || 'http://localhost:11434');
};

// Get LM Studio host and port from environment or localStorage
const getLMStudioConfig = () => {
  const envHost = process.env.LM_STUDIO_HOST;
  const envPort = process.env.LM_STUDIO_PORT;
  const localStorageHost = localStorage.getItem('LM_STUDIO_HOST');
  const localStoragePort = localStorage.getItem('LM_STUDIO_PORT');
  
  return {
    host: envHost || localStorageHost || 'localhost',
    port: envPort || localStoragePort || '1234'
  };
};

export async function POST(request) {
  try {
    const body = await request.json();
    
    // Get model configuration from OpenAI-compatible format
    const modelName = body.model;
    if (!modelName) {
      return NextResponse.json(
        { error: 'Missing model parameter' },
        { status: 400 }
      );
    }

    console.log(`Routing request to model: ${modelName}`);

    // Check which provider this model belongs to
    const provider = detectProvider(modelName);
    
    if (!provider) {
      return NextResponse.json(
        { error: `Model "${modelName}" not found. Available models need configured API keys.` },
        { status: 404 }
      );
    }

    // Route to appropriate provider
    switch (provider.id) {
      case 'openai':
        return await proxyToOpenAI(body, request);
      
      case 'anthropic':
        return await proxyToAnthropic(body, request);
      
      case 'ollama':
      case 'lmstudio':
        return await proxyToLocalProvider(modelName, body);
      
      default:
        return NextResponse.json(
          { error: `Unsupported provider: ${provider.name}` },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Gateway error:', error.message);
    
    // Return standardized error format
    return NextResponse.json(
      { 
        error: {
          message: `Failed to get response from ${error.message || 'unknown provider'}`
        }
      },
      { status: 500 }
    );
  }
}

/**
 * Detect which provider a model belongs to based on model name patterns
 */
function detectProvider(modelName) {
  const lmConfig = getLMStudioConfig();
  
  // Check for Ollama models (standard ollama naming)
  if (/^(llama|mistral|gemma|codellama|qwen|mxbai)/.test(modelName.toLowerCase())) {
    return { id: 'ollama', name: 'Ollama' };
  }
  
  // Check for LM Studio models (they use OpenAI naming but run local)
  const lmStudioBaseUrl = `http://${lmConfig.host}:${lmConfig.port}`;
  if (!process.env.OPENAI_API_KEY && !localStorage.getItem('OPENAI_API_KEY')) {
    // Without OpenAI API key, treat as local LM Studio
    return { id: 'lmstudio', name: 'LM Studio' };
  }
  
  // Check for OpenAI models (gpt-4o, gpt-3.5-turbo, etc.)
  if (/^gpt-/i.test(modelName)) {
    const apiKey = getApiKey('OpenAI');
    if (apiKey) {
      return { id: 'openai', name: 'OpenAI' };
    }
  }
  
  // Check for Anthropic models
  if (/^(claude|haiku)/i.test(modelName)) {
    const apiKey = getApiKey('Anthropic');
    if (apiKey) {
      return { id: 'anthropic', name: 'Anthropic' };
    }
  }
  
  return null;
}

/**
 * Proxy request to local LM Studio/Ollama instance
 */
async function proxyToLocalProvider(modelName, body) {
  const lmConfig = getLMStudioConfig();
  
  // Use Ollama endpoint by default, or try LM Studio if configured without OpenAI key
  let baseUrl = `${getOllamaBase()}/v1/chat/completions`;
  
  // If no OpenAI key and local setup, default to LM Studio
  if (!process.env.OPENAI_API_KEY && !localStorage.getItem('OPENAI_API_KEY')) {
    const lmUrl = `http://${lmConfig.host}:${lmConfig.port}/v1/chat/completions`;
    return proxyFetch(lmUrl, body);
  }
  
  return proxyFetch(baseUrl, body);
}

/**
 * Make HTTP request to provider with timeout and retry logic
 */
async function proxyFetch(url, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response;

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    
    throw error;
  }
}

/**
 * Proxy request to OpenAI API
 */
async function proxyToOpenAI(body, originalRequest) {
  const apiKey = getApiKey('OpenAI');
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No OpenAI API key configured' },
      { status: 401 }
    );
  }

  const url = 'https://api.openai.com/v1/chat/completions';

  try {
    // Add OpenAI-specific headers
    const openaiBody = { ...body };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(openaiBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    return response;

  } catch (error) {
    console.error('OpenAI proxy error:', error.message);
    
    return NextResponse.json(
      { 
        error: {
          message: `Failed to connect to OpenAI API: ${error.message}`
        }
      },
      { status: 503 }
    );
  }
}

/**
 * Proxy request to Anthropic API (convert to their format)
 */
async function proxyToAnthropic(body, originalRequest) {
  const apiKey = getApiKey('Anthropic');
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No Anthropic API key configured' },
      { status: 401 }
    );
  }

  // Convert OpenAI format to Anthropic format
  let messages = body.messages || [];
  
  const anthropicBody = {
    model: body.model || 'claude-3-5-sonnet-20241022',
    max_tokens: body.max_tokens || 1024,
    temperature: body.temperature ?? 1,
    top_p: body.top_p ?? 1,
    messages: [],
    system: ''
  };

  // Convert OpenAI message format to Anthropic
  for (const msg of messages) {
    const anthropicMsg = {
      role: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'user',
      content: []
    };

    if (typeof msg.content === 'string') {
      anthropicMsg.content.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') {
          anthropicMsg.content.push({ type: 'text', text: part });
        } else if (part.type === 'text') {
          anthropicMsg.content.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url' && part.image_url?.url) {
          const imageUrl = part.image_url.url;
          let source;
          try {
            const domain = new URL(imageUrl).hostname;
            source = domain.includes('openai') ? 'url' : 'base64';
          } catch {
            source = 'url';
          }
          anthropicMsg.content.push({
            type: 'image',
            source: { type, data: imageUrl, media_type: part.image_url?.detail || 'image/jpeg' }
          });
        }
      }
    }

    anthropic.messages.push(anthropicMsg);
  }

  // Extract system prompt if present
  const systemMsg = messages.find(m => m.role === 'system');
  if (systemMsg) {
    anthropic.system = typeof systemMsg.content === 'string' 
      ? systemMsg.content 
      : systemMsg.content[0]?.text || '';
  }

  const url = 'https://api.anthropic.com/v1/messages';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    // Convert Anthropic response to OpenAI format
    return anthropicToOpenaiFormat(response);

  } catch (error) {
    console.error('Anthropic proxy error:', error.message);
    
    return NextResponse.json(
      { 
        error: {
          message: `Failed to connect to Anthropic API: ${error.message}`
        }
      },
      { status: 503 }
    );
  }
}

/**
 * Convert Anthropic response format to OpenAI-compatible format
 */
function anthropicToOpenaiFormat(response) {
  return response.json().then(anthropicData => {
    const openaiResponse = {
      id: `chat-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: anthropicData.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: anthropicData.content[0]?.type === 'text' 
            ? anthropicData.content[0].text 
            : '',
          thinking: anthropicData.thinking || ''
        },
        finish_reason: anthropicData.stop_reason || 'stop',
        logprobs: null
      }],
      usage: {
        prompt_tokens: anthropicData.usage?.input_tokens || 0,
        completion_tokens: anthropicData.usage?.output_tokens || 0,
        total_tokens: anthropicData.usage?.input_tokens + anthropicData.usage?.output_tokens
      },
      system_fingerprint: null
    };

    return new Response(JSON.stringify(openaiResponse), response);
  }).catch(() => {
    // Return empty response on parse error
    return new Response(JSON.stringify({
      id: `chat-${Date.now()}`,
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }), { status: 500 });
  });
}

export default function handler(request) {
  // Support Next.js App Router POST handler
  if (request.method === 'POST') {
    return NextResponse.json({ error: 'Use the OpenAI-compatible /chat/completions endpoint' }, { status: 405 });
  }
  
  return NextResponse.json({ message: 'Aurora API Gateway' });
}