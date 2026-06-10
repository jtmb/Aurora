// @aurora/api/onlyoffice/[...path] — Proxy all OnlyOffice iframe requests
// to the Document Server so the browser only talks to localhost:3000.

import { NextResponse } from 'next/server';

const DS_URL = process.env.ONLYOFFICE_DS_URL || 'http://localhost';

const PROXIED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

// Strip headers that should NOT be forwarded to the Document Server.
// We override Host and X-Forwarded-* so the DS generates URLs pointing
// back to localhost:3000 (our proxy) instead of localhost:80 (the DS itself).
const STRIP_REQUEST_HEADERS = new Set([
  'origin',
  'referer',
  'cookie',
  'accept-encoding',    // Request uncompressed so proxy doesn't corrupt encoding
  'x-real-ip',
]);

// Strip response headers that might confuse the browser about origin
const STRIP_RESPONSE_HEADERS = new Set([
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'content-encoding',     // Node fetch auto-decompresses; browser would double-decode
  'content-length',       // Decompressed body size differs from DS's compressed size
  'transfer-encoding',    // Node fetch handles this transparently
  'set-cookie',
  'x-powered-by',
  'server',
]);

export async function GET(request, { params }) {
  return proxyRequest(request, params);
}

export async function POST(request, { params }) {
  return proxyRequest(request, params);
}

export async function PUT(request, { params }) {
  return proxyRequest(request, params);
}

export async function DELETE(request, { params }) {
  return proxyRequest(request, params);
}

export async function PATCH(request, { params }) {
  return proxyRequest(request, params);
}

export async function OPTIONS(request, { params }) {
  return proxyRequest(request, params);
}

async function proxyRequest(request, params) {
  try {
    const segments = (await params).path || [];
    const path = segments.join('/');

    // Build the full Document Server URL
    const queryString = request.nextUrl.search || '';
    const targetUrl = `${DS_URL}/${path}${queryString}`;

    // Pass the original Host header so the DS generates URLs relative to our proxy,
    // not localhost:8082. This ensures cache URLs and other DS-generated links go
    // through /api/onlyoffice/... rather than directly to the DS container.
    // Note: 'host' is NOT in STRIP_REQUEST_HEADERS, so the browser's Host (localhost:3000)
    // flows through to the DS. The DS's nginx uses default_server on port 80, so any
    // Host header is accepted.

    // Build forwarded headers (keeping the original Host)
    const headers = {};
    for (const [key, value] of request.headers.entries()) {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
        headers[key] = value;
      }
    }
    // Force the DS to generate cache/snippet URLs relative to our proxy (localhost:3000).
    // We also send X-Forwarded-Host so DS nginx picks it up for $the_host.
    // Redirect handling: we use `redirect: 'manual'` and rewrite 302 locations below
    // because DS redirects include the port from Host/XFH, which would cause fetch
    // to follow them back to Next.js instead of DS.
    headers['host'] = 'localhost:3000';
    headers['x-forwarded-host'] = 'localhost:3000';
    headers['x-forwarded-proto'] = 'http';

    // Read body for non-GET/HEAD methods.
    // Socket.IO long-polling POSTs send text/plain bodies like "40" or "40:0"
    // that must be forwarded intact. We read the body directly instead of using
    // request.clone() to avoid silent failures when the body has been consumed.
    let body = null;
    if (!['GET', 'HEAD'].includes(request.method)) {
      try {
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          body = JSON.stringify(await request.json());
        } else if (contentType.includes('text/')) {
          body = await request.text();
        } else {
          body = Buffer.from(await request.arrayBuffer());
        }
      } catch {
        // Body already consumed or not available — send without body
        body = null;
      }
    }

    const fetchOptions = {
      method: request.method,
      headers,
      redirect: 'manual',  // Handle redirects ourselves — DS generates URLs with our
                            // Host:localhost:3000 which would loop back to Next.js
    };

    if (body !== null) {
      fetchOptions.body = body;
      // Don't set Content-Length manually — fetch does it
    }

    let response = await fetch(targetUrl, fetchOptions);

    // ── Handle DS redirects (302 for non-versioned → versioned paths) ──
    // DS returns Location like http://localhost:3000/9.4.0-xxx/...
    // The port in the URL comes from our Host header. We rewrite to go directly
    // to DS (localhost:80) so the redirect doesn't loop back to Next.js.
    // NOTE: Only follow actual redirect codes (301,302,303,307,308). 304 Not
    // Modified is NOT a redirect — it's a cache revalidation response.
    const MAX_REDIRECTS = 5;
    for (let i = 0; i < MAX_REDIRECTS && [301, 302, 303, 307, 308].includes(response.status); i++) {
      const location = response.headers.get('location');
      if (!location) break;

      // Extract the path from the absolute DS URL (strip host:port)
      let dsPath;
      try {
        const locUrl = new URL(location);
        dsPath = locUrl.pathname + locUrl.search;
      } catch {
        dsPath = location; // assume it's already a relative path
      }

      const redirectUrl = `${DS_URL}${dsPath}`;
      response = await fetch(redirectUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });
    }

    // 304 Not Modified — pass through cache headers, no body.
    // We must handle 304 BEFORE reading response.arrayBuffer() because 304
    // responses have no body and the Response constructor rejects body+304.
    if (response.status === 304) {
      const respHeaders = new Headers();
      for (const [key, value] of response.headers.entries()) {
        if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
          respHeaders.set(key, value);
        }
      }
      respHeaders.set('Access-Control-Allow-Origin', '*');
      // Use undefined (not null) body — some Node.js versions distinguish
      return new NextResponse(undefined, { status: 304, headers: respHeaders });
    }

    // Read response body (fetch auto-decompresses gzip)
    const responseBody = await response.arrayBuffer();

    // Build response headers
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }
    // Allow our origin to read the response
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new NextResponse(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[onlyoffice/proxy] Error proxying request:', error.message);
    return NextResponse.json(
      { error: { message: 'Document server unavailable' } },
      { status: 502 }
    );
  }
}
