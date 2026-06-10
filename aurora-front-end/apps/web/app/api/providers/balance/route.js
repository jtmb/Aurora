// @aurora/api/providers/balance — Provider account balance
// GET: Fetch balance from provider APIs (DeepSeek, etc.)
// API keys accepted via request headers or user-scoped keys table

import { NextResponse } from 'next/server';
import { AuthHandler } from '@aurora/auth-service/handlers';
import { ApiKeyManager } from '@aurora/auth-service/handlers';

const authHandler = new AuthHandler();
const apiKeyManager = new ApiKeyManager();

const getUserId = (request) => {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = authHandler.verifyToken(authHeader.substring(7));
    return decoded.userId;
  } catch { return null; }
};

/**
 * Extract DeepSeek API key from headers or user-scoped keys
 */
const getDeepSeekKey = async (request) => {
  // Header takes priority
  const headerKey = request.headers.get('x-deepseek-key') || process.env.DEEPSEEK_API_KEY || '';
  if (headerKey) return headerKey;

  // Fall back to user-scoped keys
  const userId = getUserId(request);
  if (userId) {
    try {
      const keys = await apiKeyManager.listKeys(userId);
      const dsk = keys.find(k => k.provider?.toLowerCase() === 'deepseek');
      if (dsk?.rawKey) return dsk.rawKey;
    } catch {}
  }
  return '';
};

/**
 * Fetch DeepSeek account balance
 * Endpoint: https://api.deepseek.com/user/balance
 */
const fetchDeepSeekBalance = async (apiKey) => {
  if (!apiKey) {
    return { available: false, reason: 'no_key' };
  }

  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { available: false, reason: 'fetch_error', status: res.status, detail: errText.slice(0, 200) };
    }

    const data = await res.json();
    // DeepSeek returns: { is_available, balance_infos: [{ currency, total_balance, total_available, granted_balance, topped_up_balance }] }
    const balanceInfo = data.balance_infos?.[0] || {};
    return {
      available: data.is_available ?? true,
      currency: balanceInfo.currency || 'USD',
      totalBalance: parseFloat(balanceInfo.total_balance || 0),
      totalAvailable: parseFloat(balanceInfo.total_available || 0),
      grantedBalance: parseFloat(balanceInfo.granted_balance || 0),
      toppedUpBalance: parseFloat(balanceInfo.topped_up_balance || 0),
    };
  } catch (err) {
    return { available: false, reason: 'fetch_error', detail: err.message };
  }
};

/**
 * GET /api/providers/balance
 * Query params:
 *   provider=deepseek — filter to specific provider (default: all)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerFilter = searchParams.get('provider') || '';

    const result = { providers: {} };

    // DeepSeek balance
    if (!providerFilter || providerFilter === 'deepseek') {
      const dsk = await getDeepSeekKey(request);
      result.providers.deepseek = await fetchDeepSeekBalance(dsk);
    }

    // Only return providers that have keys configured or were explicitly requested
    const hasDeepseekKey = !!(request.headers.get('x-deepseek-key') || process.env.DEEPSEEK_API_KEY || await getDeepSeekKey(request));
    if (!providerFilter) {
      // Clean up: remove providers that returned no_key if they weren't explicitly filtered
      for (const [key, val] of Object.entries(result.providers)) {
        if (val.reason === 'no_key' && !hasDeepseekKey) {
          delete result.providers[key];
        }
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Balance] GET error:', error.message);
    return NextResponse.json(
      { error: { message: 'Failed to fetch balance data' } },
      { status: 500 }
    );
  }
}
