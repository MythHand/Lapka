/* ═══════════════════════════════════════════════════════════
   The local server: loopback only, one page, a few routes.

   Host must be ours with our port, so a foreign name rebound to
   127.0.0.1 gets nothing; Sec-Fetch-Site must be same-origin or none,
   and the browser sets it itself; Origin is checked when present.
   Everything the routes hand out is about the user's own machine, so
   the checks are not optional.
   ═══════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

export function startServer({ port, host = '127.0.0.1', webDir, lapka }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const fromLoopback = req => {
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) return false;
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
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
    if (!fromLoopback(req)) return json(res, 403, { error: 'loopback only' });
    const url = new URL(req.url, `http://${host}`);
    const p = url.pathname;
    try {
      if (req.method === 'GET' && p === '/') return serveStatic(res, 'inspect.html');
      if (req.method === 'GET' && /^\/[\w.-]+\.(?:html|js|mjs|css|svg|png|woff2)$/.test(p)) return serveStatic(res, p.slice(1));
      if (req.method === 'GET' && p === '/api/ping') return json(res, 200, { ok: true, name: 'lapka' });
      if (req.method === 'GET' && p === '/api/look') {
        const target = url.searchParams.get('url');
        if (!/^https?:\/\//i.test(target || '')) return json(res, 400, { error: 'url must be http(s)' });
        const t0 = Date.now();
        const { series, reports, dubs } = await lapka.look(target);
        return json(res, 200, { series, reports, dubs, ms: Date.now() - t0 });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  return new Promise((ok, bad) => {
    server.once('error', bad);
    server.listen(port, host, () => ok({ port, base: `http://${host}:${port}`, close: () => new Promise(r => server.close(r)) }));
  });
}
