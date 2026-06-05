// @aurora/api/providers/pricing — Live pricing cache
// GET:  Return cached pricing from SQLite (24h TTL), ?refresh=true forces update
// POST: Force-refresh pricing for all known providers

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';

// Built-in fallback pricing (USD per 1M tokens, as of 2024)
const DEFAULT_PRICING = {
  openai: {
    'gpt-4o':           { input: 2.50,  output: 10.00 },
    'gpt-4o-mini':      { input: 0.15,  output: 0.60  },
    'gpt-4':            { input: 30.00, output: 60.00 },
    'gpt-4-turbo':      { input: 10.00, output: 30.00 },
    'gpt-3.5-turbo':    { input: 0.50,  output: 1.50  },
    'gpt-3.5-turbo-0125': { input: 0.50, output: 1.50 },
    'o1':               { input: 15.00, output: 60.00 },
    'o1-mini':          { input: 3.00,  output: 12.00 },
  },
  anthropic: {
    'claude-3.5-sonnet':  { input: 3.00,  output: 15.00 },
    'claude-3.5-haiku':   { input: 0.80,  output: 4.00  },
    'claude-3-opus':      { input: 15.00, output: 75.00 },
    'claude-3-sonnet':    { input: 3.00,  output: 15.00 },
    'claude-3-haiku':     { input: 0.25,  output: 1.25  },
  },
  deepseek: {
    'deepseek-chat':    { input: 0.14, output: 0.28 },
    'deepseek-coder':   { input: 0.14, output: 0.28 },
  },
  ollama: {
    // Local models — free
    '*': { input: 0, output: 0 },
  },
  lmstudio: {
    // Local models — free
    '*': { input: 0, output: 0 },
  },
};

// Cache TTL: 24 hours in seconds
const CACHE_TTL = 24 * 60 * 60;

function getDefaultModels() {
  const models = [];
  for (const [provider, entries] of Object.entries(DEFAULT_PRICING)) {
    for (const [model, prices] of Object.entries(entries)) {
      models.push({ provider, model, ...prices });
    }
  }
  return models;
}

/**
 * Store pricing in cache
 */
function cachePricing(provider, data) {
  const db = getDb();
  const json = JSON.stringify(data);
  const now = new Date();
  const expires = new Date(now.getTime() + CACHE_TTL * 1000);

  db.prepare(`
    INSERT INTO pricing_cache (provider, data, fetched_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      data = excluded.data,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `).run(provider, json, now.toISOString(), expires.toISOString());
}

/**
 * Read pricing from cache
 */
function readCachedPricing() {
  const db = getDb();
  const now = new Date().toISOString();

  return db.prepare(`
    SELECT provider, data, fetched_at, expires_at
    FROM pricing_cache
    WHERE expires_at > ?
    ORDER BY provider
  `).all(now);
}

/**
 * GET /api/providers/pricing
 * Query params:
 *   refresh=true — force refresh from defaults (bypasses cache)
 *   provider=openai — filter by provider
 */
export async function GET(request) {
  try {
    runMigrations();
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';
    const providerFilter = searchParams.get('provider');

    // Check if cache is valid
    let cached = [];
    if (!forceRefresh) {
      cached = readCachedPricing();
    }

    let models;

    if (cached.length > 0 && !forceRefresh) {
      // Return cached data
      models = [];
      for (const row of cached) {
        if (providerFilter && row.provider !== providerFilter) continue;
        const data = JSON.parse(row.data);
        for (const [model, prices] of Object.entries(data)) {
          models.push({
            provider: row.provider,
            model,
            input: prices.input,
            output: prices.output,
          });
        }
      }
    } else {
      // Populate from defaults
      if (forceRefresh) {
        for (const provider of Object.keys(DEFAULT_PRICING)) {
          cachePricing(provider, DEFAULT_PRICING[provider]);
        }
      }

      models = getDefaultModels();
      if (providerFilter) {
        models = models.filter(m => m.provider === providerFilter);
      }
    }

    return NextResponse.json({
      models,
      cached: cached.length > 0 && !forceRefresh,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Pricing] GET error:', error.message);
    return NextResponse.json(
      { error: { message: 'Failed to fetch pricing data' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/providers/pricing — Force refresh pricing cache
 */
export async function POST() {
  try {
    runMigrations();

    for (const provider of Object.keys(DEFAULT_PRICING)) {
      cachePricing(provider, DEFAULT_PRICING[provider]);
    }

    return NextResponse.json({
      success: true,
      refreshedAt: new Date().toISOString(),
      providers: Object.keys(DEFAULT_PRICING),
    });
  } catch (error) {
    console.error('[Pricing] POST error:', error.message);
    return NextResponse.json(
      { error: { message: 'Failed to refresh pricing' } },
      { status: 500 }
    );
  }
}
