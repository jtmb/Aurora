// @aurora/api/providers/test - Test individual provider API keys
// POST { provider: 'openai'|'anthropic'|'deepseek'|'ollama'|'lmstudio', key: string }

import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { provider, key, baseUrl, host, port } = await request.json();
    if (!provider) return NextResponse.json({ error: 'Provider is required' }, { status: 400 });

    let ok = false;
    let message = '';
    const timeout = 8000;

    switch (provider) {
      case 'openai':
        ok = await testOpenAI(key, timeout);
        message = ok ? 'Connected — API key is valid' : 'Invalid API key or network error';
        break;
      case 'anthropic':
        ok = await testAnthropic(key, timeout);
        message = ok ? 'Connected — API key is valid' : 'Invalid API key or network error';
        break;
      case 'deepseek':
        ok = await testDeepSeek(key, timeout);
        message = ok ? 'Connected — API key is valid' : 'Invalid API key or network error';
        break;
      case 'ollama':
        ok = await testOllama(baseUrl || 'http://localhost:11434', timeout);
        message = ok ? 'Connected — Ollama is reachable' : 'Could not reach Ollama at ' + (baseUrl || 'http://localhost:11434');
        break;
      case 'lmstudio':
        ok = await testLmStudio(host, port, timeout);
        message = ok ? 'Connected — LM Studio is reachable' : 'Could not reach LM Studio';
        break;
      default:
        return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    }

    return NextResponse.json({ ok, message });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err.message || 'Test failed' }, { status: 500 });
  }
}

async function testOpenAI(key, timeout) {
  if (!key) return false;
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(timeout)
    });
    return res.ok;
  } catch { return false; }
}

async function testAnthropic(key, timeout) {
  if (!key) return false;
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(timeout)
    });
    return res.ok;
  } catch { return false; }
}

async function testDeepSeek(key, timeout) {
  if (!key) return false;
  try {
    const res = await fetch('https://api.deepseek.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(timeout)
    });
    return res.ok;
  } catch { return false; }
}

async function testOllama(baseUrl, timeout) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeout) });
    return res.ok;
  } catch { return false; }
}

async function testLmStudio(host, port, timeout) {
  try {
    const url = `http://${host || 'localhost'}:${port || '1234'}/v1/models`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.ok;
  } catch { return false; }
}
