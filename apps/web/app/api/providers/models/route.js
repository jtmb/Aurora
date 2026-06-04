// @aurora/api/providers/models - Get available models from configured providers

import { NextResponse } from 'next/server';

// JWT secret for token verification (in production: use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-here-minimum-32-chars';
const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER || 'openai';

/**
 * Verify user's auth token and extract email
 */
const verifyToken = (token) => {
  try {
    // Simple base64 decode for demo - in production use JWT library
    const payload = JSON.parse(Buffer.from(token.substring(7), 'base64').toString());
    return payload?.email;
  } catch {
    return null;
  }
};

/**
 * Fetch models from OpenAI - returns empty array if no API key configured
 */
const fetchOpenAIModels = async () => {
  try {
    // Only attempt fetch if API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return [];
    }
    
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error(`OpenAI API call failed with status ${response.status}`);
    
    const data = await response.json();
    return (data.data || []).map(model => ({
      id: model.id,
      name: model.id.replace('models/', ''),
      owned_by: model.owned_by || 'openai'
    }));

  } catch (error) {
    console.warn('OpenAI models fetch error:', error.message);
    return [];
  }
};

/**
 * Fetch models from Ollama - returns empty array if no API base configured
 */
const fetchOllamaModels = async () => {
  try {
    // Only attempt fetch if Ollama is configured
    if (!process.env.OLLAMA_API_BASE) {
      return [];
    }
    
    const baseUrl = process.env.OLLAMA_API_BASE;
    const response = await fetch(`${baseUrl}/api/tags`, {
      headers: {}
    });

    if (!response.ok) throw new Error(`Ollama API call failed with status ${response.status}`);
    
    const data = await response.json();
    return (data.models || []).map(model => ({
      id: model.name.split('@')[0], // Remove digest for ID
      name: model.name.split('@')[0],
      owned_by: 'ollama'
    }));

  } catch (error) {
    console.warn('Ollama models fetch error:', error.message);
    return [];
  }
};

/**
 * Fetch models from LM Studio - returns empty array if no host configured
 */
const fetchLmStudioModels = async () => {
  try {
    // Only attempt fetch if LM Studio is configured
    if (!process.env.LM_STUDIO_HOST) {
      return [];
    }
    
    const host = process.env.LM_STUDIO_HOST || 'localhost';
    const port = process.env.LM_STUDIO_PORT || '1234';
    const apiKey = process.env.LM_STUDIO_API_KEY || '';
    
    const response = await fetch(`http://${host}:${port}/v1/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) throw new Error(`LM Studio API call failed with status ${response.status}`);
    
    const data = await response.json();
    return (Array.isArray(data) ? data : [data]).map(model => ({
      id: model.id,
      name: model.id,
      owned_by: 'lmstudio'
    }));

  } catch (error) {
    console.warn('LM Studio models fetch error:', error.message);
    return [];
  }
};

/**
 * Fetch models from Anthropic - returns empty array if no API key configured
 */
const fetchAnthropicModels = async () => {
  try {
    // Only attempt fetch if Anthropic API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return [];
    }
    
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) throw new Error(`Anthropic API call failed with status ${response.status}`);
    
    const data = await response.json();
    return (data.models || []).map(model => ({
      id: model.id,
      name: model.id.replace('claude-', ''),
      owned_by: 'anthropic'
    }));

  } catch (error) {
    console.warn('Anthropic models fetch error:', error.message);
    return [];
  }
};

/**
 * Get configured provider ID from auth token or default
 */
const getProviderId = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return DEFAULT_PROVIDER;
  
  const email = verifyToken(authHeader.substring(7));
  // In production: query database for user's configured provider
  
  // For now, return default
  return DEFAULT_PROVIDER;
};

export async function GET(request) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const providerId = getProviderId(authHeader);
    
    // Fetch models from all available providers (only if keys are configured)
    let [openaiModels, ollamaModels, lmStudioModels, anthropicModels] = await Promise.all([
      fetchOpenAIModels(),
      process.env.OLLAMA_API_BASE ? fetchOllamaModels() : Promise.resolve([]),
      process.env.LM_STUDIO_HOST ? fetchLmStudioModels() : Promise.resolve([]),
      process.env.ANTHROPIC_API_KEY ? fetchAnthropicModels() : Promise.resolve([])
    ]);
    
    // Combine models from all providers that returned data
    const allModels = [
      ...openaiModels.map(m => ({ ...m, source: 'OpenAI' })),
      ...ollamaModels.map(m => ({ ...m, source: 'Ollama' })),
      ...lmStudioModels.map(m => ({ ...m, source: 'LM Studio' })),
      ...anthropicModels.map(m => ({ ...m, source: 'Anthropic' }))
    ];
    
    // Only cache if we have models
    if (allModels.length > 0) {
      const cacheKey = 'models_cache';
      const cachedTime = localStorage.getItem(cacheKey);
      if (cachedTime && (Date.now() - parseInt(cachedTime, 10)) < 3600000) {
        return NextResponse.json({ providerId, models: allModels });
      }
      
      // Save to cache
      localStorage.setItem(cacheKey, Date.now().toString());
    }
    
    return NextResponse.json({ 
      providerId, 
      models: allModels 
    });

  } catch (error) {
    console.error('Get models error:', error);
    return NextResponse.json({ error: { message: 'Failed to fetch models' } }, { status: 500 });
  }
}

/**
 * Get models for a specific provider (for model dropdown)
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const providerId = getProviderId(authHeader);
    
    let models;
    switch(providerId) {
      case 'openai':
        models = await fetchOpenAIModels();
        break;
      case 'ollama':
        models = await fetchOllamaModels();
        break;
      case 'lmstudio':
        models = await fetchLmStudioModels();
        break;
      case 'anthropic':
        models = await fetchAnthropicModels();
        break;
      default:
        return NextResponse.json({ error: { message: 'Provider not found' } }, { status: 404 });
    }
    
    // Return empty array if no models available (provider configured but no keys)
    if (!models || models.length === 0) {
      return NextResponse.json([], { status: 200 });
    }
    
    return NextResponse.json(models);

  } catch (error) {
    console.error('Get models by provider error:', error);
    return NextResponse.json({ error: { message: 'Failed to fetch models' } }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({});
}