// @aurora/api/chat-completions - OpenAI-compatible chat completions endpoint
// Supports: OpenAI, Anthropic, Ollama, LM Studio with localStorage fallback

import { NextResponse } from 'next/server';

/**
 * Get API key with environment variable fallback to localStorage
 */
const getApiKey = (envKey, localStorageKey) => {
  if (process.env[envKey]) {
    return process.env[envKey];
  }
  try {
    const value = localStorage.getItem(localStorageKey);
    if (value && value.length > 10) {
      return value;
    }
  } catch (e) {
    // localStorage not available
  }
  return '';
};

/**
 * Check and update localStorage keys for runtime use
 */
const checkLocalStorageKeys = () => {
  const keys = {
    openai: localStorage.getItem('OPENAI_API_KEY'),
    anthropic: localStorage.getItem('ANTHROPIC_API_KEY')
  };
  
  for (const [key, value] of Object.entries(keys)) {
    if (value && !process.env[key.toUpperCase().replace('API_', '')]) {
      console.log(`Setting ${key} from localStorage`);
      process.env[`${key.toUpperCase().replace('_', '')}_API_KEY`] = value;
    }
  }
};

// Check on startup
checkLocalStorageKeys();

/**
 * Get all configured providers - checks environment variables first, falls back to localStorage
 */
const getProviders = () => {
  const providers = [];
  
  // OpenAI provider
  const openaiApiKey = getApiKey('OPENAI_API_KEY', 'OPENAI_API_KEY');
  if (openaiApiKey) {
    providers.push({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: openaiApiKey,
      name: 'OpenAI',
      models: [] // Will be fetched dynamically
    });
  }

  // Anthropic provider
  const anthropicApiKey = getApiKey('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
  if (anthropicApiKey) {
    providers.push({
      id: 'anthropic',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      apiKey: anthropicApiKey,
      name: 'Anthropic',
      models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307']
    });
  }

  // Ollama provider (no API key needed for localhost)
  const ollamaBase = process.env.OLLAMA_API_BASE || 'http://localhost:11434';
  if (ollamaBase && ollamaBase !== 'http://localhost:11434' || 
      localStorage.getItem('OLLAMA_API_BASE') === ollamaBase) {
    providers.push({
      id: 'ollama',
      baseUrl: ollamaBase,
      apiKey: '',
      name: 'Ollama',
      models: [] // Will be fetched dynamically
    });
  }

  // LM Studio provider
  const lmStudioHost = process.env.LM_STUDIO_HOST || localStorage.getItem('LM_STUDIO_HOST') || 'localhost';
  const lmStudioPort = process.env.LM_STUDIO_PORT || localStorage.getItem('LM_STUDIO_PORT') || '1234';
  
  // Only add LM Studio if it's not the default localhost:1234 (skip for backward compatibility)
  // Check if custom LM Studio URL is configured in localStorage (e.g., http://192.168.0.13:1234)
  const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
  if ((lmStudioHost !== 'localhost' && lmStudioPort !== '1234') || 
      process.env.LM_STUDIO_HOST || lmStudioUrl) {
    providers.push({
      id: 'lmstudio',
      baseUrl: lmStudioUrl || `http://${lmStudioHost}:${lmStudioPort}/v1`,
      apiKey: '', // LM Studio doesn't require API key for localhost
      name: 'LM Studio',
      models: [] // Will be fetched dynamically
    });
  }

  return providers;
};

/**
 * Fetch available models from provider - supports custom LM Studio URL (e.g., http://192.168.0.13:1234)
 */
const fetchModelsFromProvider = async (provider) => {
  try {
    const token = provider.apiKey ? `Bearer ${provider.apiKey}` : '';
    const headers = token ? { 'Authorization': token } : {};
    
    // Ollama and LM Studio use different endpoints for models
    if (provider.id === 'ollama' || provider.id === 'lmstudio') {
      const url = `${provider.baseUrl}/tags` + 
        (provider.apiKey ? `?apiKey=${provider.apiKey}` : '');
      
      const response = await fetch(url, { headers });
      if (response.ok) {
        const data = await response.json();
        // Ollama returns models in different format
        const models = Array.isArray(data.models) ? data.models : 
                        (Array.isArray(data.default_models) ? data.default_models : []);
        return models.map(m => ({
          id: m.name,
          name: m.name,
          owned_by: 'ollama'
        }));
      }
    } else {
      // OpenAI and Anthropic use /models endpoint
      const url = `${provider.baseUrl}/models`;
      const response = await fetch(url, { headers });
      if (response.ok) {
        const data = await response.json();
        return data.data?.map(m => ({
          id: m.id,
          name: m.id.replace('model:', ''),
          owned_by: provider.name
        }));
      }
    }
  } catch (error) {
    console.warn(`Failed to fetch models from ${provider.name}:`, error.message);
  }
  
  return [];
};

/**
 * Normalize response to OpenAI v1 format regardless of provider
 */
const normalizeToOpenAIFormat = (response, providerId) => {
  let normalized;
  
  if (providerId === 'anthropic') {
    normalized = {
      id: `msg_${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model || 'claude-3-sonnet-20240229',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.content?.[0]?.text || response.content || ''
        },
        finish_reason: response.stop_reason || 'stop'
      }],
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      },
      system_fingerprint: 'fp_default'
    };
  } else if (providerId === 'lmstudio') {
    // LM Studio responses are mostly already compatible
    normalized = {
      ...response,
      object: 'chat.completion',
      system_fingerprint: response.system_fingerprint || 'fp_lms_' + Date.now()
    };
  } else if (providerId === 'ollama') {
    // Ollama responses are compatible but we need to normalize usage
    normalized = {
      ...response,
      object: 'chat.completion',
      system_fingerprint: response.system_fingerprint || 'fp_ollama_' + Date.now()
    };
    
    // Ensure we have a proper message format
    if (!normalized.choices || !normalized.choices[0].message) {
      normalized.message = response.message;
    }
  } else {
    // OpenAI - mostly already compatible
    normalized = response;
  }
  
  return normalized;
};

/**
 * Handle streaming response
 */
const streamResponse = async (messages, model, provider) => {
  const token = provider.apiKey ? `Bearer ${provider.apiKey}` : '';
  let headers = { 'Content-Type': 'application/json' };
  
  if (token && provider.id === 'openai') {
    headers['Authorization'] = token;
  } else if (!token && [ 'ollama', 'lmstudio' ].includes(provider.id)) {
    // Ollama/LM Studio don't need auth header
    const url = `${provider.baseUrl}/chat`;
    
    const body = JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.7,
      stream: true
    });

    const response = await fetch(url, { method: 'POST', headers, body });
    
    if (!response.ok) {
      throw new Error(`Failed to stream from ${provider.name}: ${response.status}`);
    }

    return response.body;
  } else if (provider.id === 'anthropic') {
    // Anthropic uses different streaming endpoint
    const url = `${provider.baseUrl}/v1/messages`;
    const anthropicHeaders = { ...headers, 'anthropic-version': '2023-06-01' };
    
    const body = JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: messages[0].content }]
    });

    const response = await fetch(url, { method: 'POST', headers: anthropicHeaders, body });
    
    if (!response.ok) {
      throw new Error(`Failed to stream from ${provider.name}: ${response.status}`);
    }

    return response.body;
  } else {
    // OpenAI streaming
    const url = `${provider.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.7,
      stream: true
    });

    const response = await fetch(url, { method: 'POST', headers, body });
    
    if (!response.ok) {
      throw new Error(`Failed to stream from ${provider.name}: ${response.status}`);
    }

    return response.body;
  }
};

export async function POST(request) {
  try {
    const body = await request.json();
    const model = body.model || process.env.DEFAULT_MODEL || 'llama3';
    const messages = body.messages || [];
    const temperature = body.temperature ?? 0.7;
    const stream = request.headers.get('accept')?.includes('text/event-stream');
    
    if (messages.length === 0) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    // Add system message if not provided
    const hasSystem = messages.some(m => m.role === 'system');
    if (!hasSystem) {
      messages.unshift({ role: 'system', content: 'You are a helpful assistant.' });
    }

    // Get providers
    const providers = getProviders();
    
    // If no providers configured and model matches a default, try without API key (Ollama/LM Studio style)
    let selectedProvider;
    if (providers.length > 0) {
      // Select provider based on request or default
      selectedProvider = providers.find(p => p.id === body.providerId || false) || providers[0];
    } else {
      // Check if we can use Ollama/LM Studio directly without configured keys
      const ollamaBase = process.env.OLLAMA_API_BASE || 'http://localhost:11434';
      const lmStudioHost = process.env.LM_STUDIO_HOST || 'localhost';
      const lmStudioPort = process.env.LM_STUDIO_PORT || '1234';
      
      if (model === model.toLowerCase().includes('llama') || 
          model.toLowerCase().includes('mistral')) {
        selectedProvider = { id: 'ollama', baseUrl: ollamaBase, apiKey: '', name: 'Ollama' };
      } else if (lmStudioHost !== 'localhost' || lmStudioPort !== '1234') {
        selectedProvider = { id: 'lmstudio', baseUrl: `http://${lmStudioHost}:${lmStudioPort}/v1`, apiKey: '', name: 'LM Studio' };
      } else {
        return NextResponse.json({ error: 'No LLM provider configured. Please set environment variables or configure via Settings.' }, { status: 400 });
      }
    }

    // Fetch models for the first time if empty and using Ollama/LM Studio
    if (model === '' && ['ollama', 'lmstudio'].includes(selectedProvider.id)) {
      try {
        const url = `${selectedProvider.baseUrl}/tags`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          // Ollama returns models in different format
          const availableModels = Array.isArray(data.models) ? data.models : [];
          
          // Set default model to first available one
          if (availableModels.length > 0 && model === 'model' || !model.includes('/')) {
            selectedProvider.models = availableModels;
            model = availableModels[0]?.name || model;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch Ollama/LM Studio models:', e.message);
      }
    }

    // Build headers
    const headers = { 'Content-Type': 'application/json' };
    if (selectedProvider.apiKey && selectedProvider.id === 'openai') {
      headers['Authorization'] = `Bearer ${selectedProvider.apiKey}`;
    }

    // Handle streaming
    if (stream) {
      return NextResponse.stream(streamResponse(messages, model, selectedProvider), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        }
      });
    }

    // Handle non-streaming
    const response = await fetch(
      `${selectedProvider.baseUrl}/${selectedProvider.id === 'anthropic' ? 'messages' : selectedProvider.id === 'ollama' || selectedProvider.id === 'lmstudio' ? 'chat' : 'chat/completions'}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          temperature,
          top_p: 1,
          max_tokens: body.max_tokens
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Request to ${selectedProvider.name} failed: ${response.status}`);
    }

    const data = await response.json();
    
    // Normalize to OpenAI format
    const normalized = normalizeToOpenAIFormat(data, selectedProvider.id);
    
    return NextResponse.json(normalized);

  } catch (error) {
    console.error('Chat completion error:', error.message);
    
    return NextResponse.json({ 
      error: 'An error occurred while processing your request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    const providers = getProviders();
    
    // Fetch models from each configured provider
    for (const provider of providers) {
      if (provider.id === 'openai') {
        // Skip OpenAI model fetch in GET (too slow for discovery)
        continue;
      }
      
      const models = await fetchModelsFromProvider(provider);
      
      return NextResponse.json({
        providerId: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: models || [],
        hasApiKey: !!provider.apiKey
      });
    }
    
    return NextResponse.json({ 
      error: 'No providers configured',
      message: 'Please configure API keys in Settings or set environment variables'
    }, { status: 404 });

  } catch (error) {
    console.error('Models discovery error:', error.message);
    
    // Return empty models if any provider can't be reached
    return NextResponse.json({ 
      providerId: 'openai',
      models: []
    }, { status: 200 });
  }
}