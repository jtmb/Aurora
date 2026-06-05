/**
 * DuckDuckGo Web Search API
 * GET /api/web-search?q=query
 *
 * Uses DuckDuckGo Instant Answer API (free, no API key required).
 * Returns a structured JSON response with abstract text and search results.
 */

// DuckDuckGo Instant Answer API base URL
const DDG_API = 'https://api.duckduckgo.com/';

// Timeout for the DuckDuckGo request (ms)
const SEARCH_TIMEOUT = 5000;

async function fetchWithTimeout(url, timeoutMs, extraOpts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, ...extraOpts });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || !query.trim()) {
    return Response.json(
      { error: 'Missing search query parameter "q"' },
      { status: 400 }
    );
  }

  const trimmedQuery = query.trim().slice(0, 500);

  try {
    const encodedQuery = encodeURIComponent(trimmedQuery);
    const apiUrl = `${DDG_API}?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

    const res = await fetchWithTimeout(apiUrl, SEARCH_TIMEOUT, {
      headers: {
        'User-Agent': 'Aurora-Gateway/1.0 (Web Search; +https://github.com/aurora-gateway)',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      console.error(`[WebSearch] DuckDuckGo returned ${res.status}`);
      return Response.json(
        { error: 'Search provider unavailable', query: trimmedQuery, results: [] },
        { status: 502 }
      );
    }

    const data = await res.json();

    // Extract abstract info
    const abstract = {
      text: data.AbstractText || '',
      url: data.AbstractURL || '',
      source: data.AbstractSource || 'DuckDuckGo',
    };

    // Extract related topics as structured results
    const results = [];
    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text?.split(' - ')[0] || topic.Text,
            snippet: topic.Text || '',
            url: topic.FirstURL,
          });
        }
      }
    }

    // If no related topics but we have an abstract, use it as a single result
    if (results.length === 0 && abstract.text) {
      results.push({
        title: abstract.text.slice(0, 100),
        snippet: abstract.text,
        url: abstract.url,
      });
    }

    // If still no results, try DDG Lite HTML scrape as fallback
    if (results.length === 0) {
      console.log(`[WebSearch] DDG API returned empty — trying HTML fallback for "${trimmedQuery}"`);
      const fallbackResults = await scrapeDdgHtml(trimmedQuery);
      if (fallbackResults.length > 0) {
        results.push(...fallbackResults);
      }
    }

    return Response.json({
      query: trimmedQuery,
      abstract,
      results: results.slice(0, 10),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[WebSearch] Timeout:', trimmedQuery);
      return Response.json(
        { error: 'Search timed out', query: trimmedQuery, results: [] },
        { status: 504 }
      );
    }
    console.error('[WebSearch] Error:', err.message);
    return Response.json(
      { error: 'Search failed', query: trimmedQuery, results: [] },
      { status: 500 }
    );
  }
}

/**
 * Fallback: Scrape DuckDuckGo HTML search when Instant Answer API returns nothing.
 * Uses the non-JS HTML version (html.duckduckgo.com) which is more scraper-friendly.
 */
async function scrapeDdgHtml(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
  
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timer);
    
    if (!res.ok) {
      console.error(`[WebSearch] DDG HTML returned ${res.status}`);
      return [];
    }
    
    const html = await res.text();
    
    // DDG HTML results have this structure:
    // <a rel="nofollow" class="result__a" href="URL">Title</a>
    // <a class="result__snippet" href="URL">Snippet</a>
    const results = [];
    
    // Match result links with title
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    // Match snippets
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.+?)<\/a>/gi;
    
    let linkMatch;
    const links = [];
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      let href = linkMatch[1];
      // DDG wraps URLs through its redirect — extract real URL from uddg param
      const uddgMatch = href.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try { href = decodeURIComponent(uddgMatch[1]); } catch { href = uddgMatch[1]; }
      }
      links.push({
        title: linkMatch[2].replace(/<\/?[^>]+>/g, '').trim(),
        url: href
      });
    }
    
    let snippetMatch;
    const snippets = [];
    while ((snippetMatch = snippetRegex.exec(html)) !== null) {
      snippets.push(snippetMatch[1].replace(/<\/?[^>]+>/g, '').trim());
    }
    
    // Pair links with snippets by position
    for (let i = 0; i < Math.min(links.length, 10); i++) {
      results.push({
        title: links[i].title,
        snippet: snippets[i] || links[i].title,
        url: links[i].url
      });
    }
    
    return results;
  } catch (err) {
    console.error('[WebSearch] DDG HTML fallback error:', err.message);
    return [];
  }
}
