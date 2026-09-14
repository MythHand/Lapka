/* ═══════════════════════════════════════════════════════════
   The local server: loopback only, one page, a few routes.

   Host must be ours with our port, so a foreign name rebound to
   127.0.0.1 gets nothing; Sec-Fetch-Site must be same-origin or none,
   and the browser sets it itself; Origin is checked when present.
   Everything the routes hand out is about the user's own machine, so
   the checks are not optional.

   One allowance: a top-level navigation to a page is let through
   whatever site started it. A foreign page can open our page but
   cannot read it, and a browser extension or a link from elsewhere
   would otherwise be refused. The API keeps the strict rule, so the
   only thing a foreign page can make Lapka do is show itself.
   ═══════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { contentType } from '../deliver/index.mjs';

const VENDOR = { 'hls.min.js': createRequire(import.meta.url).resolve('hls.js/dist/hls.min.js') };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

export function startServer({ port, host = '127.0.0.1', webDir, lapka, delivery = null, store = null }) {
  const hosts = new Set();
  const fromLoopback = (req, { navigation = false } = {}) => {
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) return false;
    const site = req.headers['sec-fetch-site'];
    const isNav = req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (site && site !== 'same-origin' && site !== 'none' && !(navigation && isNav)) return false;
    if (req.headers.origin) {
      let u; try { u = new URL(req.headers.origin); } catch { return false; }
      if (!hosts.has(u.host.toLowerCase())) return false;
    }
    return true;
  };

  const serveStatic = async (res, rel) => {
    const file = path.join(webDir, rel);
    if (!file.startsWith(webDir + path.sep) && file !== webDir) return json(res, 404, { error: 'not found' });
    let st; try { st = await fsp.stat(file); } catch { return json(res, 404, { error: 'not found' }); }
    if (!st.isFile()) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}`);
    const p = url.pathname;
    if (!fromLoopback(req, { navigation: !p.startsWith('/api/') })) return json(res, 403, { error: 'loopback only' });
    try {
      if (req.method === 'GET' && p === '/') return serveStatic(res, 'inspect.html');
      if (req.method === 'GET' && /^\/[\w.-]+\.(?:html|js|mjs|css|svg|png|woff2)$/.test(p)) return serveStatic(res, p.slice(1));
      if (req.method === 'GET' && p === '/api/ping') return json(res, 200, { ok: true, name: 'lapka', home: store?.home || null });
      if (req.method === 'GET' && VENDOR[p.slice('/vendor/'.length)] && p.startsWith('/vendor/')) {
        const file = VENDOR[p.slice('/vendor/'.length)];
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=86400' });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method === 'GET' && p === '/api/cache' && store) return json(res, 200, await store.cache.stat());

      let m;
      if (delivery && (m = /^\/api\/stream\/([a-f0-9]{16})(?:\.(m3u8|mp4)|\/(pl|seg|key))$/.exec(p))) {
        const entry = delivery.get(m[1]);
        if (!entry) return json(res, 404, { error: 'unknown stream' });
        try {
          if (m[2] === 'm3u8' || m[3] === 'pl') {
            const body = await delivery.playlist(entry, m[3] ? url.searchParams.get('u') : undefined);
            res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
            return res.end(body);
          }
          if (m[3] === 'seg' || m[3] === 'key') {
            const u = url.searchParams.get('u') || '';
            const { bytes, hit } = await delivery.piece(entry, u);
            res.writeHead(200, { 'content-type': contentType(u), 'content-length': bytes.length, 'cache-control': 'no-store', 'x-lapka-cache': hit ? 'hit' : 'miss' });
            return res.end(bytes);
          }
          /* mp4: the range goes through, the answer comes back as it is */
          const origin = await delivery.file(entry, req.headers.range);
          const h = { 'content-type': origin.headers.get('content-type') || 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
          for (const k of ['content-length', 'content-range']) if (origin.headers.get(k)) h[k] = origin.headers.get(k);
          res.writeHead(origin.status, h);
          if (req.method === 'HEAD' || !origin.body) return res.end();
          return Readable.fromWeb(origin.body).pipe(res);
        } catch (e) {
          return json(res, e.code || 500, { error: e.message });
        }
      }
      if (req.method === 'GET' && p === '/api/look') {
        const target = url.searchParams.get('url');
        if (!/^https?:\/\//i.test(target || '')) return json(res, 400, { error: 'url must be http(s)' });
        const t0 = Date.now();
        const looked = await lapka.look(target);
        return json(res, 200, { ...looked, ms: Date.now() - t0 });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  return new Promise((ok, bad) => {
    server.once('error', bad);
    server.listen(port, host, () => {
      const bound = server.address().port;
      for (const h of ['127.0.0.1', 'localhost', '[::1]']) hosts.add(`${h}:${bound}`);
      ok({ port: bound, base: `http://${host}:${bound}`, close: () => new Promise(r => server.close(r)) });
    });
  });
}
