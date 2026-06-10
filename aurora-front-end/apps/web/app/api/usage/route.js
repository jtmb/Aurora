// @aurora/api/usage — Usage tracking (SQLite-backed)
// POST: Record a usage event (called from chat completions)
// GET:  Retrieve aggregated usage data

import { NextResponse } from 'next/server';
import { getDb } from '@aurora/shared/db-client';
import { runMigrations } from '@aurora/shared/db-migrate';
import { AuthHandler } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();

function getUserId(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = authHandler.verifyToken(authHeader.substring(7));
    return decoded.userId;
  } catch { return null; }
}

/**
 * POST /api/usage — Record a usage event
 * Body: { provider, model, promptTokens, completionTokens, totalTokens, chatId? }
 * Requires JWT auth.
 */
export async function POST(request) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Authentication required' } }, { status: 401 });
    }

    const body = await request.json();
    const { provider, model, promptTokens, completionTokens, totalTokens, chatId } = body;

    if (!provider || !model) {
      return NextResponse.json(
        { error: { message: 'provider and model are required' } },
        { status: 400 }
      );
    }

    // Ensure tables exist
    runMigrations();
    const db = getDb();

    db.prepare(`
      INSERT INTO usage_records (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, chat_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      provider,
      model,
      promptTokens || 0,
      completionTokens || 0,
      totalTokens || (promptTokens || 0) + (completionTokens || 0),
      chatId || null
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Usage] POST error:', error.message);
    return NextResponse.json(
      { error: { message: 'Failed to record usage' } },
      { status: 500 }
    );
  }
}

/**
 * GET /api/usage — Retrieve aggregated usage
 * Query params: startDate, endDate, provider (optional)
 * Returns token counts grouped by provider and model.
 * Cost is NOT computed server-side — client combines with pricing data.
 */
export async function GET(request) {
  try {
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Authentication required' } }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const providerFilter = searchParams.get('provider');
    const granularity = searchParams.get('granularity'); // 'daily' for time-series
    const targetUserId = searchParams.get('userId'); // admin override: view another user's usage

    runMigrations();
    const db = getDb();

    // Admin override: allow viewing any user's usage
    let effectiveUserId = userId;
    if (targetUserId) {
      const requestingUser = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
      if (requestingUser?.role === 'admin') {
        effectiveUserId = targetUserId;
      } else {
        return NextResponse.json({ error: { message: 'Admin access required to view other users' } }, { status: 403 });
      }
    }

    // Build WHERE clause
    const conditions = ['user_id = ?'];
    const params = [effectiveUserId];

    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(endDate);
    }
    if (providerFilter) {
      conditions.push('provider = ?');
      params.push(providerFilter);
    }

    const whereClause = conditions.join(' AND ');

    // Get aggregate by provider
    const byProvider = db.prepare(`
      SELECT
        provider,
        SUM(prompt_tokens) as promptTokens,
        SUM(completion_tokens) as completionTokens,
        SUM(total_tokens) as totalTokens,
        SUM(prompt_cache_hit_tokens) as promptCacheHitTokens,
        SUM(prompt_cache_miss_tokens) as promptCacheMissTokens,
        COUNT(*) as requestCount
      FROM usage_records
      WHERE ${whereClause}
      GROUP BY provider
      ORDER BY totalTokens DESC
    `).all(...params);

    // Get aggregate by provider + model
    const byModel = db.prepare(`
      SELECT
        provider,
        model,
        SUM(prompt_tokens) as promptTokens,
        SUM(completion_tokens) as completionTokens,
        SUM(total_tokens) as totalTokens,
        SUM(prompt_cache_hit_tokens) as promptCacheHitTokens,
        SUM(prompt_cache_miss_tokens) as promptCacheMissTokens,
        COUNT(*) as requestCount
      FROM usage_records
      WHERE ${whereClause}
      GROUP BY provider, model
      ORDER BY provider, totalTokens DESC
    `).all(...params);

    // Get daily time-series if granularity=daily
    let daily = [];
    if (granularity === 'daily') {
      daily = db.prepare(`
        SELECT
          DATE(created_at) as date,
          provider,
          SUM(prompt_tokens) as promptTokens,
          SUM(completion_tokens) as completionTokens,
          SUM(total_tokens) as totalTokens,
          SUM(prompt_cache_hit_tokens) as promptCacheHitTokens,
          SUM(prompt_cache_miss_tokens) as promptCacheMissTokens,
          COUNT(*) as requestCount
        FROM usage_records
        WHERE ${whereClause}
        GROUP BY DATE(created_at), provider
        ORDER BY DATE(created_at) ASC, provider
      `).all(...params);
    }

    // Build response
    const result = {
      byProvider: {},
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalRequests: 0,
    };

    for (const row of byProvider) {
      result.byProvider[row.provider] = {
        totalTokens: row.totalTokens,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        promptCacheHitTokens: row.promptCacheHitTokens || 0,
        promptCacheMissTokens: row.promptCacheMissTokens || 0,
        requestCount: row.requestCount,
        byModel: {},
      };
      result.totalTokens += row.totalTokens;
      result.totalPromptTokens += row.promptTokens;
      result.totalCompletionTokens += row.completionTokens;
      result.totalRequests += row.requestCount;
    }

    for (const row of byModel) {
      if (result.byProvider[row.provider]) {
        result.byProvider[row.provider].byModel[row.model] = {
          totalTokens: row.totalTokens,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          promptCacheHitTokens: row.promptCacheHitTokens || 0,
          promptCacheMissTokens: row.promptCacheMissTokens || 0,
          requestCount: row.requestCount,
        };
      }
    }

    return NextResponse.json({ ...result, daily });
  } catch (error) {
    console.error('[Usage] GET error:', error.message);
    return NextResponse.json(
      { error: { message: 'Failed to retrieve usage data' } },
      { status: 500 }
    );
  }
}
