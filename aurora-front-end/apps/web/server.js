// server.js — Custom Next.js server with OnlyOffice WebSocket proxy
// Socket.IO connections to the Document Server bypass Next.js route handlers
// entirely, going directly through this server's TCP-level proxy. This allows
// WebSocket transport to work (Next.js route handlers can't do WebSocket upgrade).

import { createServer } from 'node:http';
import { parse } from 'node:url';
import net from 'node:net';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const DS_HOST = process.env.ONLYOFFICE_DS_RAW_HOST || 'localhost';
const DS_PORT = parseInt(process.env.ONLYOFFICE_DS_RAW_PORT || '80', 10);

app.prepare().then(() => {
  const server = createServer((req, res) => {
    // All normal HTTP requests → Next.js
    handle(req, res, parse(req.url, true));
  });

  // ── OnlyOffice Socket.IO WebSocket proxy ──
  // The DS iframe's Socket.IO client tries ws://localhost:3000/doc/.../c
  // The OnlyOffice iframe loads via /api/onlyoffice/..., so Socket.IO
  // constructs WebSocket URLs relative to that: /api/onlyoffice/9.4.0-.../doc/.../c
  // The next.config.mjs rewrite only applies to HTTP (not upgrade), so the
  // browser uses the full /api/onlyoffice/... URL. We intercept ANY
  // OnlyOffice-related upgrade and proxy directly to DS.
  server.on('upgrade', (req, socket, head) => {
    console.log('[ws-proxy] UPGRADE request:', req.url);
    if (!req.url) {
      console.log('[ws-proxy]  -> no URL, destroying');
      socket.destroy();
      return;
    }
    const isOnlyOffice =
      req.url.startsWith('/doc/') ||
      req.url.startsWith('/api/onlyoffice/') ||
      req.url.startsWith('/web-apps/') ||
      req.url.startsWith('/sdkjs-plugins/') ||
      req.url.startsWith('/cache/') ||
      req.url.startsWith('/fonts/');
    if (!isOnlyOffice) {
      console.log('[ws-proxy]  -> not OnlyOffice, destroying');
      socket.destroy();
      return;
    }
    console.log('[ws-proxy]  -> OnlyOffice WS, proxying to DS');

    // Map the path to the DS URL. For /api/onlyoffice/... paths, strip the
    // /api/onlyoffice/ prefix since DS expects paths like /doc/..., /web-apps/..., etc.
    let requestPath = req.url;
    if (requestPath.startsWith('/api/onlyoffice/')) {
      requestPath = requestPath.slice('/api/onlyoffice'.length);
    }

    const dsSocket = net.connect({ host: DS_HOST, port: DS_PORT }, () => {
      console.log('[ws-proxy]  -> DS connected, forwarding upgrade');

      // Forward the original HTTP upgrade request to DS
      const lines = [
        `${req.method} ${requestPath} HTTP/${req.httpVersion}`,
      ];
      for (const [key, val] of Object.entries(req.headers)) {
        if (Array.isArray(val)) {
          for (const v of val) lines.push(`${key}: ${v}`);
        } else if (val !== undefined) {
          const lk = key.toLowerCase();
          if (lk === 'host') {
            lines.push(`Host: ${DS_HOST}`);
          } else {
            lines.push(`${key}: ${val}`);
          }
        }
      }
      lines.push('', ''); // terminating \r\n\r\n
      dsSocket.write(lines.join('\r\n'));
      
      // Forward any WebSocket frames that arrived with the upgrade
      if (head.length > 0) {
        dsSocket.write(head);
      }

      // Buffer for response data (may come in multiple chunks)
      let responseBuffer = Buffer.alloc(0);
      let headerEnd = -1;
      let upgraded = false;

      const onData = (chunk) => {
        if (upgraded) {
          // Already upgraded — just forward data
          socket.write(chunk);
          return;
        }

        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        headerEnd = responseBuffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return; // Need more data

        const responseHead = responseBuffer.toString('utf-8', 0, headerEnd);
        const statusMatch = responseHead.match(/^HTTP\/\S+\s+(\d+)/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 502;

        if (statusCode === 101) {
          upgraded = true;

          // Extract response headers
          const headerLines = responseHead.split('\r\n').slice(1);
          const respHeaders = {};
          for (const line of headerLines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
              respHeaders[line.slice(0, colonIdx).trim()] =
                line.slice(colonIdx + 1).trim();
            }
          }

          // Write 101 to the client
          socket.write('HTTP/1.1 101 Switching Protocols\r\n');
          for (const [key, val] of Object.entries(respHeaders)) {
            socket.write(`${key}: ${val}\r\n`);
          }
          socket.write('\r\n');

          // Send any leftover data after the headers
          const afterHeaders = responseBuffer.slice(headerEnd + 4);
          if (afterHeaders.length > 0) {
            socket.write(afterHeaders);
          }

          // Bidirectional pipe: client ↔ DS
          socket.pipe(dsSocket);
          dsSocket.pipe(socket);

          socket.on('close', () => dsSocket.destroy());
          dsSocket.on('close', () => socket.destroy());
          dsSocket.removeListener('data', onData);
        } else {
          // DS didn't upgrade — respond with whatever it sent
          socket.write(responseBuffer);
          dsSocket.pipe(socket);
          dsSocket.removeListener('data', onData);
        }
      };

      dsSocket.on('data', onData);
      dsSocket.on('error', (err) => {
        console.error('[ws-proxy] DS socket error:', err.message);
        if (!upgraded) {
          socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        }
        socket.destroy();
      });
    });

    dsSocket.on('error', (err) => {
      console.error('[ws-proxy] DS connect error:', err.message);
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
    });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Aurora ready on http://${hostname}:${port} (DS WebSocket → ${DS_HOST}:${DS_PORT})`);
  });
});
