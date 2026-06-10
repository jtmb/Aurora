// @aurora/api/personality/generate - AI-generate a system prompt from a description
// POST { description: string }
// Headers: x-openai-key, x-anthropic-key, x-deepseek-key, x-ollama-base, x-lmstudio-url

import { NextResponse } from 'next/server';

const META_PROMPT = `You are a system-prompt architect. Given a user's description of how they want their AI assistant to behave, generate a concise, effective system prompt (2-6 sentences) that captures the persona.

Rules:
- Start directly with the system prompt — no preamble, no "Here is...", no markdown fences
- Use second-person ("You are...") point of view
- Be specific and actionable, not vague
- Include tone, expertise domain, and behavioral constraints when relevant
- Keep it under 500 characters

After the prompt, on a new line, output just "NAME: " followed by a short 2-4 word name for this personality.

User's description:`;

export async function POST(request) {
  try {
    const { description } = await request.json();
    if (!description || !description.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    // Extract keys from headers
    const keys = {
      openai: request.headers.get('x-openai-key') || process.env.OPENAI_API_KEY || '',
      anthropic: request.headers.get('x-anthropic-key') || process.env.ANTHROPIC_API_KEY || '',
      deepseek: request.headers.get('x-deepseek-key') || process.env.DEEPSEEK_API_KEY || '',
      ollamaBase: request.headers.get('x-ollama-base') || process.env.OLLAMA_API_BASE || '',
      lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
    };

    // Try providers in priority order
    const text = await tryGenerate(keys, description.trim());

    if (!text) {
      return NextResponse.json({ error: 'No provider available. Configure an API key in Settings.' }, { status: 400 });
    }

    // Parse name from response
    let prompt = text;
    let name = '';
    const nameMatch = text.match(/NAME:\s*(.+?)(?:\n|$)/i);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
      prompt = text.replace(/NAME:\s*.+?(?:\n|$)/i, '').trim();
    }

    return NextResponse.json({ prompt, name: name || undefined });
  } catch (err) {
    console.error('[Personality Generate] Error:', err.message);
    return NextResponse.json({ error: err.message || 'Generation failed' }, { status: 500 });
  }
}

async function tryGenerate(keys, description) {
  const timeout = 15000;
  const messages = [{ role: 'user', content: `${META_PROMPT} ${description}` }];

  // 1) OpenAI
  if (keys.openai) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys.openai}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7, max_tokens: 300 }),
        signal: AbortSignal.timeout(timeout)
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch { /* try next */ }
  }

  // 2) Anthropic
  if (keys.anthropic) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 300, messages }),
        signal: AbortSignal.timeout(timeout)
      });
      if (res.ok) {
        const data = await res.json();
        return data.content?.[0]?.text?.trim() || null;
      }
    } catch { /* try next */ }
  }

  // 3) DeepSeek
  if (keys.deepseek) {
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys.deepseek}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 300 }),
        signal: AbortSignal.timeout(timeout)
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch { /* try next */ }
  }

  // 4) Ollama (local — no auth needed)
  if (keys.ollamaBase) {
    try {
      const res = await fetch(`${keys.ollamaBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature: 0.7, max_tokens: 300 }),
        signal: AbortSignal.timeout(timeout)
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch { /* try next */ }
  }

  // 5) LM Studio (local)
  if (keys.lmStudioUrl) {
    try {
      const res = await fetch(`${keys.lmStudioUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature: 0.7, max_tokens: 300 }),
        signal: AbortSignal.timeout(timeout)
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch { /* try next */ }
  }

  return null;
}
