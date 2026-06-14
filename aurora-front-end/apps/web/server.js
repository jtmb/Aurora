// server.js — Custom Next.js server with OnlyOffice & code-server proxies
// Next.js runs on port 3000. OnlyOffice WS proxy lives here.
// code-server gets its own server on port 3001 to avoid Next.js HMR
// WebSocket handler conflicts.

import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parse } from 'node:url';
import net from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';import crypto from 'node:crypto';import next from 'next';
import { homedir } from 'node:os';

// Load .env.local into process.env (Next.js does this for the app, but server.js runs standalone)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env.local');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// Prevent EPIPE crashes in the proxy — EPIPE means a socket was closed before
// we finished writing, which is normal during reconnections. Log once per burst.
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
  console.error('UNCAUGHT:', err);
  process.exit(1);
});

// ── JWT verification (inline, avoids bundler issues with shared packages) ──
const JWT_SECRET = process.env.JWT_SECRET || 'aurora-dev-secret-change-in-production-minimum-32-chars';
function base64UrlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}
function verifyJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    // Verify signature
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(unsigned)
      .digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (expectedSig !== parts[2]) return null;
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch { return null; }
}

/**
 * Extract userId from an incoming proxy request. Checks:
 * 1. `token` query parameter (primary — for iframe src)
 * 2. `Authorization: Bearer <token>` header (fallback — for API clients)
 * 3. `aurora_cs_token` cookie (subsequent iframe requests after initial auth)
 * Returns { userId, email } or null if no valid auth.
 */
function extractUserId(req) {
  // 1. Check query parameter token
  const url = req.url || '/';
  const queryIdx = url.indexOf('?');
  if (queryIdx >= 0) {
    const qs = url.slice(queryIdx + 1);
    const params = new URLSearchParams(qs);
    const tokenParam = params.get('token');
    if (tokenParam) {
      const payload = verifyJwt(tokenParam);
      if (payload) return { userId: payload.userId, email: payload.email || payload.sub };
    }
  }
  // 2. Check Authorization header
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const payload = verifyJwt(authHeader.substring(7));
    if (payload) return { userId: payload.userId, email: payload.email || payload.sub };
  }
  // 3. Check aurora_cs_token cookie (set on first authenticated request)
  const cookies = req.headers['cookie'] || '';
  const cookieMatch = cookies.match(/(?:^|;\s*)aurora_cs_token=([^;]+)/);
  if (cookieMatch) {
    const payload = verifyJwt(cookieMatch[1]);
    if (payload) return { userId: payload.userId, email: payload.email || payload.sub };
  }
  return null;
}

/**
 * Strip auth-sensitive params from a URL before forwarding to code-server.
 * Removes: token, userId
 * NOTE: Uses manual string manipulation instead of URLSearchParams.toString()
 * because URLSearchParams encodes / to %2F, which breaks code-server's
 * workspace folder path resolution.
 */
function stripAuthParams(url) {
  const queryIdx = url.indexOf('?');
  if (queryIdx < 0) return url;
  // Remove token=... and userId=... params using regex to preserve original encoding
  let qs = url.slice(queryIdx + 1);
  qs = qs.replace(/([?&])token=[^&]*&?/g, '$1').replace(/&token=[^&]*$/, '');
  qs = qs.replace(/([?&])userId=[^&]*&?/g, '$1').replace(/&userId=[^&]*$/, '');
  // Clean up trailing & and leading &
  qs = qs.replace(/^&/, '').replace(/&$/, '');
  return qs ? `${url.slice(0, queryIdx)}?${qs}` : url.slice(0, queryIdx);
}

/**
 * Rewrite workspace folder path to be per-user.
 * /workspaces/myProject → /workspaces/{userId}/myProject
 *
 * Only rewrites if the per-user workspace directory actually exists on disk.
 * Flat (legacy) workspaces stored at /workspaces/{uuid}/ are left unchanged so
 * the proxy doesn't break old workspaces during the migration period.
 */
function rewriteWorkspaceFolder(url, userId) {
  const folderPattern = /folder=\/workspaces\/([^/&?\s]+)/;
  const match = url.match(folderPattern);
  if (match && !match[1].startsWith(userId + '/')) {
    const workspaceName = match[1];
    // Check if this workspace exists in the per-user directory
    const wsDir = join(homedir(), '.aurora', 'workspaces');
    const perUserPath = join(wsDir, userId, workspaceName);
    if (existsSync(perUserPath)) {
      return url.replace(match[0], `folder=/workspaces/${userId}/${workspaceName}`);
    }
    // Flat workspace — leave path unchanged
  }
  return url;
}

// Track last authenticated user to avoid redundant auth updates
let csLastAuthUser = null;

/**
 * Notify the code-server orchestrator to update Cline's secrets.json
 * with the current user's API key. This ensures Cline sends the user's
 * identity in API calls to the Aurora gateway.
 */
async function updateClineAuth(userId, jwtToken) {
  const orchHost = process.env.CODE_SERVER_HOST || 'localhost';
  const orchPort = process.env.CODE_SERVER_API_PORT || '3001';
  try {
    const { request } = await import('node:http');
    const postData = JSON.stringify({ userId, apiKey: jwtToken });
    const options = {
      hostname: orchHost,
      port: parseInt(orchPort, 10),
      path: '/api/auth/update',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 3000,
    };
    await new Promise((resolve, reject) => {
      const req = request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => resolve());
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    console.log('[cs-proxy] Updated Cline auth for user:', userId);
  } catch (err) {
    // Non-critical — Cline will use build-time configured key
    console.warn('[cs-proxy] Failed to update Cline auth:', err.message);
  }
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const nextPort = parseInt(process.env.PORT || '3000', 10);
const csProxyPort = parseInt(process.env.CS_PROXY_PORT || '3090', 10);
const app = next({ dev, hostname, port: nextPort });
const handle = app.getRequestHandler();

// ── code-server proxy target ──
const CS_HOST = process.env.CODE_SERVER_HOST || 'localhost';
const CS_PORT = parseInt(process.env.CODE_SERVER_PORT || '8080', 10);

// Captured stable hash for webview service-worker path rewriting
let csStableHash = '';
function captureStableHash(path) {
  const m = path.match(/^\/(stable-[a-f0-9]+)\//);
  if (m) csStableHash = m[1];
}

// ── Helpers shared between proxy servers ──

function proxyHtml(proxyRes, res, reqPath) {
  const cleanHeaders = {};
  for (const [k, v] of Object.entries(proxyRes.headers)) {
    const kl = k.toLowerCase();
    if (kl === 'content-length' || kl === 'transfer-encoding' || kl === 'content-encoding' || kl === 'content-security-policy') continue;
    cleanHeaders[k] = v;
  }
  let body = '';
  proxyRes.setEncoding('utf-8');
  proxyRes.on('data', (chunk) => { body += chunk; });
  proxyRes.on('end', () => {
    // Only inject <base href="/"> into the root page, NOT into webview
    // pre pages — they need relative service-worker.js to resolve correctly
    const isRoot = !reqPath || reqPath === '/' || reqPath.startsWith('/?');
    if (isRoot) {
      body = body.replace('<head>', '<head><base href="/">');
      body = body.replace(/&quot;serverBasePath&quot;:&quot;\.&quot;/g, '&quot;serverBasePath&quot;:&quot;/&quot;');
      body = body.replace(/&quot;rootEndpoint&quot;:&quot;\.&quot;/g, '&quot;rootEndpoint&quot;:&quot;/&quot;');
      body = body.replace(/&quot;scope&quot;:&quot;\.\/&quot;/g, '&quot;scope&quot;:&quot;/&quot;');
      // Inject Aurora gateway config so Copilot Chat and other extensions
      // can discover the Aurora API gateway for model routing.
      // This runs early so Copilot Chat picks it up before initializing.
      const auroraGatewayUrl = process.env.AURORA_GATEWAY_URL || 'http://localhost:3000/api/v1';
      const auroraConfigScript = `<script>window.__AURORA_CONFIG__={gatewayUrl:"${auroraGatewayUrl}",chatCompletionsEndpoint:"${auroraGatewayUrl}/chat/completions"};</script>`;
      // Inject after <head> opening tag, before any VS Code scripts
      body = body.replace('<head>', '<head>' + auroraConfigScript);
    }
    res.writeHead(proxyRes.statusCode, cleanHeaders);
    res.end(body);
  });
}

function proxyPassthrough(proxyRes, res) {
  const headers = { ...proxyRes.headers };
  headers['permissions-policy'] = 'clipboard-read=(self), clipboard-write=(self)';
  delete headers['content-security-policy'];
  res.writeHead(proxyRes.statusCode, headers);
  proxyRes.pipe(res);
}

function badGateway(res) {
  if (!res.headersSent) res.writeHead(502);
  res.end('Bad Gateway');
}

// Direct passthrough to code-server (no user-specific rewriting)
// Simple Browser proxy — handles /proxy/<port>[/<hostname>[/<path>]]
// code-server's Simple Browser extension uses this endpoint for server-side
// proxying of arbitrary URLs. Since code-server runs inside Docker, we handle
// this on the host side so it can reach both host-localhost and external hosts.
//
// URL formats from code-server's Simple Browser:
//   /proxy/<port>/                     → 127.0.0.1:<port>/
//   /proxy/<port>/<hostname>/<path>    → <hostname>:<port>/<path>
function handleSimpleBrowserProxy(req, res, url) {
  // Match: /proxy/<port>[/<hostname>[/<remaining-path>]]
  const proxyMatch = url.match(/^\/proxy\/(\d+)(?:\/([^/]+)(\/.*)?)?\/?$/);
  if (!proxyMatch) {
    badGateway(res);
    return;
  }
  const targetPort = parseInt(proxyMatch[1], 10);
  const targetHost = proxyMatch[2] || '127.0.0.1';   // omit hostname = localhost shortcut
  const targetPath = proxyMatch[3] || '/';
  const isHttps = targetPort === 443;

  console.log(`[simple-browser] Proxy -> ${isHttps ? 'https' : 'http'}://${targetHost}:${targetPort}${targetPath}`);

  // Build Host header without port for standard ports
  let hostHeader = targetHost;
  if (targetPort !== 80 && targetPort !== 443) hostHeader += `:${targetPort}`;

  const proxyHeaders = { ...req.headers, host: hostHeader };
  delete proxyHeaders['accept-encoding']; // avoid chunked/gzip issues

  const requestFn = isHttps ? httpsRequest : httpRequest;
  const proxyReq = requestFn(
    { hostname: targetHost, port: targetPort, path: targetPath, method: req.method, headers: proxyHeaders, rejectUnauthorized: false },
    (proxyRes) => {
      // Strip CSP and framing headers so the response can render in the iframe
      const headers = { ...proxyRes.headers };
      delete headers['content-security-policy'];
      delete headers['x-frame-options'];
      delete headers['content-security-policy-report-only'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    console.error(`[simple-browser] Error connecting to ${targetHost}:${targetPort}:`, err.message);
    badGateway(res);
  });
  req.pipe(proxyReq);
}

// ── WebSocket upgrade handler (used by code-server proxy on port 3090) ──
function handleCodeServerUpgrade(req, socket, head) {
  const url = req.url || '/';

  // Auth check for WebSocket connections
  const auth = extractUserId(req);
  if (!auth) {
    // Write HTTP 401 response and destroy
    const safeWrite = (sock, data) => {
      if (!sock.destroyed && !sock.writableEnded) {
        try { sock.write(data); } catch (_) {}
      }
    };
    safeWrite(socket, 'HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const { userId } = auth;

  // Rewrite workspace folder for this user
  const rewrittenPath = rewriteWorkspaceFolder(url, userId);
  const cleanPath = stripAuthParams(rewrittenPath);
  const path = cleanPath;

  // Prevent EPIPE crashes — Node will throw if we write to a destroyed socket
  const safeWrite = (sock, data) => {
    if (!sock.destroyed && !sock.writableEnded) {
      try { sock.write(data); } catch (_) { /* socket closed, ignore */ }
    }
  };

  const csSocket = net.connect({ host: CS_HOST, port: CS_PORT }, () => {
    // Forward the ORIGINAL browser upgrade request — don't build hardcoded headers
    const lines = [`GET ${path} HTTP/1.1`];
    const toForward = ['host', 'connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol', 'cookie', 'user-agent'];
    const overrideHeaders = {
      host: `Host: ${CS_HOST}:${CS_PORT}`,
      origin: `Origin: http://${CS_HOST}:${CS_PORT}`,
      referer: `Referer: http://${CS_HOST}:${CS_PORT}/`,
    };
    for (const key of toForward) {
      if (overrideHeaders[key]) {
        lines.push(overrideHeaders[key]);
      } else {
        const val = req.headers[key];
        if (val !== undefined) lines.push(`${key}: ${val}`);
      }
    }
    lines.push('', '');
    csSocket.write(lines.join('\r\n'));
    if (head && head.length > 0) csSocket.write(head);

    let buf = Buffer.alloc(0);
    let upgraded = false;
    let consumed = false;

    const onData = (chunk) => {
      if (upgraded) { safeWrite(socket, chunk); return; }
      buf = Buffer.concat([buf, chunk]);
      const hEnd = buf.indexOf('\r\n\r\n');
      if (hEnd < 0) return;

      const headStr = buf.toString('utf-8', 0, hEnd);
      const sm = headStr.match(/^HTTP\/\S+\s+(\d+)/);
      const sc = sm ? parseInt(sm[1], 10) : 502;
      console.log('[cs-ws] code-server responded', sc, 'for', path);

      if (sc === 101) {
        upgraded = true;
        const hLines = headStr.split('\r\n').slice(1);
        socket.write('HTTP/1.1 101 Switching Protocols\r\n');
        for (const h of hLines) socket.write(h + '\r\n');
        socket.write('\r\n');
        const rest = buf.slice(hEnd + 4);
        if (rest.length > 0) socket.write(rest);
        socket.pipe(csSocket, { end: false });
        csSocket.pipe(socket, { end: false });
        // Handle errors gracefully on both sockets to prevent EPIPE crashes
        socket.on('error', (err) => { if (err.code !== 'EPIPE') console.error('[cs-ws] Browser socket error:', err.message); });
        csSocket.on('error', (err) => { if (err.code !== 'EPIPE') console.error('[cs-ws] CS socket error:', err.message); });
        socket.on('close', () => { if (!csSocket.destroyed) csSocket.destroy(); });
        csSocket.on('close', () => { if (!socket.destroyed) socket.destroy(); });
        csSocket.removeListener('data', onData);
        console.log('[cs-ws] Upgrade succeeded for', path);
      } else {
        consumed = true;
        socket.write(buf);
        csSocket.pipe(socket, { end: false });
        csSocket.removeListener('data', onData);
      }
    };
    csSocket.on('data', onData);
    csSocket.on('error', (err) => {
      console.error('[cs-ws] Socket error:', err.message);
      if (!upgraded && !consumed) safeWrite(socket, 'HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
    });
  });
  csSocket.on('error', (err) => {
    console.error('[cs-ws] Connect error:', err.message);
    safeWrite(socket, 'HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
}

// ── Start code-server proxy server on port 3090 ──
const csServer = createServer((req, res) => {
  let url = req.url || '/';
  const urlPath = url.split('?')[0];

  // ── Auth check ──
  const auth = extractUserId(req);
  if (!auth) {
    // Redirect to login page for browser requests, return 401 for API
    if (urlPath === '/' || urlPath.startsWith('/?')) {
      res.writeHead(302, { Location: '/login?redirect=/code-server' });
      res.end();
      return;
    }
    // Simple Browser proxy requests come from within the already-authenticated
    // code-server iframe and don't carry auth tokens — allow them through.
    // Handle the proxy ourselves since code-server runs in Docker and can't
    // reach host localhost ports.
    if (urlPath.startsWith('/proxy/')) {
      handleSimpleBrowserProxy(req, res, url);
      return;
    }
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized — please log in at /login');
    return;
  }
  const { userId, email } = auth;

  // Parse query string once for both auth cookie and Cline auth update
  const queryIdxCookie = url.indexOf('?');
  const urlParams = queryIdxCookie >= 0 ? new URLSearchParams(url.slice(queryIdxCookie + 1)) : null;
  const urlToken = urlParams ? urlParams.get('token') : null;

  // Notify orchestrator to update Cline secrets for this user
  // This ensures the API key Cline uses is scoped to the current user.
  // Debounced: only fires when the userId has changed since last request.
  if (csLastAuthUser !== userId) {
    csLastAuthUser = userId;
    // Expose the active code-server user to API routes via globalThis.
    // Cline sends aurora-no-key (no JWT), so v1 routes can't identify the
    // user from the Authorization header. This bridge lets them apply
    // per-user model access restrictions even for unauthenticated calls.
    globalThis.__aurora_cs_user_id = userId;
    // Try multiple token sources: Authorization header, URL param, or cookie
    const cookieHeader = req.headers['cookie'] || '';
    const cookieMatch = cookieHeader.match(/aurora_cs_token=([^;]+)/);
    const cookieToken = cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
    const token = req.headers['authorization']?.startsWith('Bearer ')
      ? req.headers['authorization'].substring(7)
      : urlToken || cookieToken || '';
    if (token) {
      updateClineAuth(userId, token).catch(() => {});
    } else {
      // No token available yet — still update Cline config with just userId.
      // The orchestrator will skip secrets.json when apiKey is empty.
      updateClineAuth(userId, '').catch(() => {});
    }
  }

  // Set a session cookie so subsequent iframe requests (which lack token param)
  // still authenticate. Cookies are domain-scoped (not port-scoped), so this
  // works across port 3000 and 3090 on the same host.
  if (urlToken) {
    const tokenForCookie = req.headers['authorization']?.startsWith('Bearer ')
      ? req.headers['authorization'].substring(7)
      : urlToken;
    const cookieValue = `aurora_cs_token=${tokenForCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${24 * 60 * 60}`;
    res.setHeader('Set-Cookie', cookieValue);
  }

  // ── Rewrite workspace folder for this user ──
  url = rewriteWorkspaceFolder(url, userId);
  // Strip auth params before forwarding to code-server
  url = stripAuthParams(url);

  // Capture stable hash from any request for later webview SW rewriting
  if (csStableHash === '' && urlPath.startsWith('/stable-')) {
    captureStableHash(urlPath);
  }

  // Webview service-worker rewriting: the webview pre page constructs
  // /service-worker.js using serverBasePath, but the real file is under
  // the webview endpoint. Rewrite with the captured stable hash.
  if (urlPath === '/service-worker.js' && csStableHash) {
    const qs = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    url = `/${csStableHash}/static/out/vs/workbench/contrib/webview/browser/pre/service-worker.js${qs}`;
    console.log('[cs-proxy] HTTP', req.method, url, '(rewritten from /service-worker.js)');
  } else {
    console.log('[cs-proxy] HTTP', req.method, url);
  }

  const proxyHeaders = { ...req.headers, host: `${CS_HOST}:${CS_PORT}` };
  proxyHeaders['accept-encoding'] = 'identity';
  proxyHeaders['x-internal-user-id'] = userId;

  const proxyReq = httpRequest(
    { hostname: CS_HOST, port: CS_PORT, path: url, method: req.method, headers: proxyHeaders },
    (proxyRes) => {
      const ct = proxyRes.headers['content-type'] || '';
      if (ct.includes('text/html')) proxyHtml(proxyRes, res, url);
      else proxyPassthrough(proxyRes, res);
    }
  );
  proxyReq.on('error', () => badGateway(res));
  req.pipe(proxyReq);
});

csServer.on('upgrade', (req, socket, head) => {
  handleCodeServerUpgrade(req, socket, head);
});

csServer.listen(csProxyPort, () => {
  console.log(`> Code-server proxy on http://localhost:${csProxyPort} → ${CS_HOST}:${CS_PORT}`);
});

// ── Next.js server on port 3000 ──
app.prepare().then(() => {
  const server = createServer((req, res) => {
    // ── Simple Browser proxy: handle /proxy/<port>/<path> ourselves ──
    // code-server's Simple Browser extension uses this to let users browse
    // arbitrary URLs. Since code-server is in Docker, proxying from the host
    // side lets it reach host-localhost ports correctly.
    if (req.url && req.url.startsWith('/proxy/')) {
      handleSimpleBrowserProxy(req, res, req.url);
      return;
    }

    // ── code-server resource proxy (catch-all for dynamic JS-loaded resources) ──
    // These may bypass the /code-server/ path prefix when loaded via code-server's
    // service worker / web worker contexts
    if (req.url && /^\/(stable-|_static\/|manifest\.json|callback|service-worker\.js)/.test(req.url)) {
      let csUrl = req.url;
      const csUrlPath = csUrl.split('?')[0];

      // Capture stable hash
      if (csStableHash === '' && csUrlPath.startsWith('/stable-')) {
        captureStableHash(csUrlPath);
      }

      // Rewrite /service-worker.js for webviews
      if (csUrlPath === '/service-worker.js' && csStableHash) {
        const qs = csUrl.includes('?') ? csUrl.slice(csUrl.indexOf('?')) : '';
        csUrl = `/${csStableHash}/static/out/vs/workbench/contrib/webview/browser/pre/service-worker.js${qs}`;
      }

      console.log('[cs-catch] HTTP', req.method, csUrl);
      const ph = { ...req.headers, host: `${CS_HOST}:${CS_PORT}` };
      ph['accept-encoding'] = 'identity';
      const pr = httpRequest(
        { hostname: CS_HOST, port: CS_PORT, path: csUrl, method: req.method, headers: ph },
        (pres) => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); }
      );
      pr.on('error', () => badGateway(res));
      req.pipe(pr);
      return;
    }

    // All normal HTTP requests → Next.js
    handle(req, res, parse(req.url, true));
  });

  server.listen(nextPort, (err) => {
    if (err) throw err;
    console.log(`> Aurora ready on http://${hostname}:${nextPort}`);
  });
});
