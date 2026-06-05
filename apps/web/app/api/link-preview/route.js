/**
 * Link Preview API — fetches OpenGraph / Twitter Card metadata for rich link embeds
 * GET /api/link-preview?url=https://example.com
 *
 * Returns title, description, image, favicon, and domain for any URL.
 * Used by the frontend to render rich preview cards below assistant messages.
 */

const FETCH_TIMEOUT = 6000;
const MAX_HTML_SIZE = 512 * 1024; // 512KB max HTML to parse

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Aurora-Gateway/1.0 (Link Preview; +https://github.com/aurora-gateway)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function extractMeta(html, name, property) {
  // Try name attribute
  let match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'));
  if (match) return match[1];

  // Try property attribute (OpenGraph)
  if (property) {
    match = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'));
    if (match) return match[1];
  }

  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url || !url.trim()) {
    return Response.json({ error: 'Missing "url" query parameter' }, { status: 400 });
  }

  let targetUrl;
  try {
    targetUrl = new URL(url.trim());
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const domain = targetUrl.hostname.replace(/^www\./, '');

  try {
    const res = await fetchWithTimeout(targetUrl.toString(), FETCH_TIMEOUT);

    if (!res.ok) {
      return Response.json({
        url: targetUrl.toString(),
        domain,
        title: domain,
        description: null,
        image: null,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
      });
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return Response.json({
        url: targetUrl.toString(),
        domain,
        title: domain,
        description: null,
        image: null,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
      });
    }

    const html = await res.text();
    const truncated = html.slice(0, MAX_HTML_SIZE);

    // Extract metadata
    const ogTitle = extractMeta(truncated, 'og:title', 'og:title');
    const twitterTitle = extractMeta(truncated, 'twitter:title', null);
    const htmlTitle = (truncated.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];
    const title = ogTitle || twitterTitle || htmlTitle?.trim() || domain;

    const ogDesc = extractMeta(truncated, 'og:description', 'og:description');
    const twitterDesc = extractMeta(truncated, 'twitter:description', null);
    const metaDesc = extractMeta(truncated, 'description', null);
    const description = ogDesc || twitterDesc || metaDesc || null;

    const ogImage = extractMeta(truncated, 'og:image', 'og:image');
    const twitterImage = extractMeta(truncated, 'twitter:image', null);
    const image = ogImage || twitterImage || null;

    return Response.json({
      url: targetUrl.toString(),
      domain,
      title: title.slice(0, 200),
      description: description?.slice(0, 300) || null,
      image,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    });
  } catch (err) {
    console.error(`[LinkPreview] Failed for ${url}:`, err.message);
    return Response.json({
      url: targetUrl.toString(),
      domain,
      title: domain,
      description: null,
      image: null,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    });
  }
}
