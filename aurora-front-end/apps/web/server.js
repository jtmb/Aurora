// server.js — Custom Next.js server with OnlyOffice & code-server proxies
// Next.js runs on port 3000. OnlyOffice WS proxy lives here.
// code-server gets its own server on port 3001 to avoid Next.js HMR
// WebSocket handler conflicts.

import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { parse } from 'node:url';
import net from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';

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

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const nextPort = parseInt(process.env.PORT || '3000', 10);
const csProxyPort = parseInt(process.env.CS_PROXY_PORT || '3090', 10);
const app = next({ dev, hostname, port: nextPort });
const handle = app.getRequestHandler();

const DS_HOST = process.env.ONLYOFFICE_DS_RAW_HOST || 'localhost';
const DS_PORT = parseInt(process.env.ONLYOFFICE_DS_RAW_PORT || '80', 10);

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
  res.writeHead(proxyRes.statusCode, proxyRes.headers);
  proxyRes.pipe(res);
}

function badGateway(res) {
  if (!res.headersSent) res.writeHead(502);
  res.end('Bad Gateway');
}

// ── WebSocket upgrade handler (used by code-server proxy on port 3090) ──
function handleCodeServerUpgrade(req, socket, head) {
  const path = req.url || '/';
  console.log('[cs-ws] Upgrade request for', path);

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

    // ── OnlyOffice HTTP proxy: catch DS-generated URLs that don't have /api/onlyoffice/ prefix ──
    // The OnlyOffice editor JavaScript generates absolute URLs (e.g. http://localhost/cache/...)
    // based on the DS's own hostname. When the browser and server are on the same machine,
    // localhost reaches this server. We proxy these requests to the DS container.
    const ooPathMatch = req.url && req.url.match(/^\/(cache|web-apps|sdkjs|sdkjs-plugins|fonts|doc|internal|info|meta|ai-proxy)\//);
    if (ooPathMatch) {
      console.log('[oo-proxy] HTTP', req.method, req.url);
      const ph = { ...req.headers, host: `${DS_HOST}:${DS_PORT}` };
      delete ph['accept-encoding'];  // Request uncompressed
      const pr = httpRequest(
        { hostname: DS_HOST, port: DS_PORT, path: req.url, method: req.method, headers: ph },
        (pres) => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); }
      );
      pr.on('error', () => badGateway(res));
      req.pipe(pr);
      return;
    }

    // All normal HTTP requests → Next.js
    handle(req, res, parse(req.url, true));
  });

  // ── OnlyOffice Socket.IO WebSocket proxy ──
  server.on('upgrade', (req, socket, head) => {
    console.log('[ws-proxy] UPGRADE request:', req.url);
    if (!req.url) { socket.destroy(); return; }
    if (req.url.startsWith('/_next/webpack-hmr')) return;

    const isOnlyOffice =
      req.url.startsWith('/doc/') ||
      req.url.startsWith('/api/onlyoffice/') ||
      req.url.startsWith('/web-apps/') ||
      req.url.startsWith('/sdkjs-plugins/') ||
      req.url.startsWith('/cache/') ||
      req.url.startsWith('/fonts/');
    if (!isOnlyOffice) return;

    console.log('[ws-proxy]  -> OnlyOffice WS, proxying to DS');
    let requestPath = req.url;
    if (requestPath.startsWith('/api/onlyoffice/')) {
      requestPath = requestPath.slice('/api/onlyoffice'.length);
    }

    const dsSocket = net.connect({ host: DS_HOST, port: DS_PORT }, () => {
      const lines = [`${req.method} ${requestPath} HTTP/${req.httpVersion}`];
      for (const [key, val] of Object.entries(req.headers)) {
        if (Array.isArray(val)) { for (const v of val) lines.push(`${key}: ${v}`); }
        else if (val !== undefined) {
          lines.push(key.toLowerCase() === 'host' ? `Host: ${DS_HOST}` : `${key}: ${val}`);
        }
      }
      lines.push('', '');
      dsSocket.write(lines.join('\r\n'));
      if (head.length > 0) dsSocket.write(head);

      let buf = Buffer.alloc(0);
      let upgraded = false;
      const onData = (chunk) => {
        if (upgraded) { socket.write(chunk); return; }
        buf = Buffer.concat([buf, chunk]);
        const hEnd = buf.indexOf('\r\n\r\n');
        if (hEnd < 0) return;
        const headStr = buf.toString('utf-8', 0, hEnd);
        const sm = headStr.match(/^HTTP\/\S+\s+(\d+)/);
        const sc = sm ? parseInt(sm[1], 10) : 502;
        if (sc === 101) {
          upgraded = true;
          const hLines = headStr.split('\r\n').slice(1);
          const respHeaders = {};
          for (const line of hLines) {
            const ci = line.indexOf(':');
            if (ci > 0) respHeaders[line.slice(0, ci).trim()] = line.slice(ci + 1).trim();
          }
          socket.write('HTTP/1.1 101 Switching Protocols\r\n');
          for (const [k, v] of Object.entries(respHeaders)) socket.write(`${k}: ${v}\r\n`);
          socket.write('\r\n');
          const rest = buf.slice(hEnd + 4);
          if (rest.length > 0) socket.write(rest);
          socket.pipe(dsSocket, { end: false });
          dsSocket.pipe(socket, { end: false });
          socket.on('close', () => dsSocket.destroy());
          dsSocket.on('close', () => socket.destroy());
          dsSocket.removeListener('data', onData);
        } else {
          socket.write(buf);
          dsSocket.pipe(socket, { end: false });
          dsSocket.removeListener('data', onData);
        }
      };
      dsSocket.on('data', onData);
      dsSocket.on('error', (err) => {
        console.error('[ws-proxy] DS socket error:', err.message);
        if (!upgraded) socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      });
    });
    dsSocket.on('error', (err) => {
      console.error('[ws-proxy] DS connect error:', err.message);
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
    });
  });

  server.listen(nextPort, (err) => {
    if (err) throw err;
    console.log(`> Aurora ready on http://${hostname}:${nextPort} (DS WebSocket → ${DS_HOST}:${DS_PORT})`);
  });
});
