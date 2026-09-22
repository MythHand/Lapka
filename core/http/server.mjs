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
import { canPick, canOpen, pickFolder, openFolder } from '../store/folder.mjs';
import { homeInside } from '../store/config.mjs';

const VENDOR = { 'hls.min.js': createRequire(import.meta.url).resolve('hls.js/dist/hls.min.js') };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

/* A local file with byte ranges, the way a browser asks for video. */
function serveRange(req, res, file, size, type) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
  return fs.createReadStream(file).pipe(res);
}

export function startServer({ port, host = '127.0.0.1', webDir, ctx }) {
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
    /* taken per request: the folder, and everything in it, can be switched while running */
    const { lapka, delivery = null, store = null, state = null, library = null, saver = null } = ctx;
    const url = new URL(req.url, `http://${host}`);
    const p = url.pathname;
    let m;
    if (!fromLoopback(req, { navigation: !p.startsWith('/api/') })) return json(res, 403, { error: 'loopback only' });
    try {
      if (req.method === 'GET' && p === '/') return serveStatic(res, 'index.html');
      if (req.method === 'GET' && /^\/(?:assets\/[\w./-]+|[\w.-]+)\.(?:html|js|mjs|css|svg|png|woff2|ttf|txt)$/.test(p) && !p.includes('..')) return serveStatic(res, p.slice(1));
      if (req.method === 'GET' && p === '/api/ping') return json(res, 200, { ok: true, name: 'lapka', home: store?.home || null });
      if (req.method === 'GET' && p === '/api/home' && library) {
        const series = await library.list();
        return json(res, 200, { home: store.home, series: series.length, files: series.reduce((n, s) => n + s.episodes.length, 0), filesBytes: series.reduce((n, s) => n + s.episodes.reduce((m, e) => m + (e.size || 0), 0), 0), bytes: await store.weigh(), notes: state ? state.notes() : 0, notesBytes: await store.weigh(store.own), cache: await store.cache.stat(), canPick: canPick(), canOpen: canOpen() });
      }
      if (req.method === 'GET' && VENDOR[p.slice('/vendor/'.length)] && p.startsWith('/vendor/')) {
        const file = VENDOR[p.slice('/vendor/'.length)];
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=86400' });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method === 'GET' && p === '/api/cache' && store) return json(res, 200, await store.cache.stat());
      if (req.method === 'GET' && (m = /^\/api\/series\/([a-f0-9]{12})$/.exec(p))) {
        const s = lapka.series(m[1]);
        return s ? json(res, 200, { series: s }) : json(res, 404, { error: 'unknown series' });
      }
      if (req.method === 'GET' && p === '/api/dubs') {
        const q = url.searchParams;
        try {
          const ep = q.get('open') === '1' ? await lapka.openAllSources(q.get('series'), Number(q.get('episode'))) : await lapka.openEpisode(q.get('series'), Number(q.get('episode')));
          await lapka.levelsOf(ep);   // the variants inside adaptive streams, for the qualities shown
          return json(res, 200, { episode: ep.number, dubs: lapka.dubsOf(ep) });
        } catch (e) { return json(res, e.code || 500, { error: e.message }); }
      }
      if (req.method === 'GET' && p === '/api/resolve') {
        const q = url.searchParams;
        try {
          return json(res, 200, await lapka.resolve({ seriesId: q.get('series'), number: Number(q.get('episode')), dubKey: q.get('dub') || null, avoid: q.get('avoid') || null }));
        } catch (e) { return json(res, e.code || 500, { error: e.message }); }
      }

      /* anything that changes the machine wants a header a cross-site form cannot set */
      const mutating = req.method === 'POST';
      if (mutating && req.headers['x-lapka'] !== '1') return json(res, 403, { error: 'x-lapka header required' });

      if (store && mutating && p === '/api/home/open') {
        try { await openFolder(store.home); return json(res, 200, { ok: true }); }
        catch (e) { return json(res, 500, { error: e.message }); }
      }
      if (ctx.quit && mutating && p === '/api/quit') { ctx.quit(); return json(res, 200, { ok: true }); }
      if (ctx.switchHome && mutating && p === '/api/home/pick') {
        try {
          const picked = await pickFolder({ prompt: 'Папка Lapka', start: store.home });
          if (!picked) return json(res, 200, { cancelled: true });
          const chosen = await homeInside(picked);   // the page shows the folder that will be used
          /* not switched yet: the page asks whether to take the files along */
          const has = (await library.list()).length > 0;
          return json(res, 200, { ok: true, chosen, hasContent: has, from: store.home });
        } catch (e) { return json(res, e.code || 500, { error: e.message }); }
      }
      if (ctx.switchHome && mutating && p === '/api/home') {
        try {
          const move = url.searchParams.get('move') === '1';
          const r = await ctx.switchHome(url.searchParams.get('path') || '', { move });
          return json(res, 200, { ok: true, home: r.path, created: !r.existed, moved: r.moved || 0 });
        } catch (e) { return json(res, e.code || 500, { error: e.message }); }
      }
      if (store && mutating && p === '/api/cache/limit') {
        await store.cache.setLimit(Number(url.searchParams.get('gb')));
        return json(res, 200, await store.cache.stat());
      }
      if (store && mutating && p === '/api/cache') {
        const freed = await store.cache.clear(url.searchParams.get('keep') || null);
        return json(res, 200, { ...(await store.cache.stat()), freed });
      }
      if (saver && mutating && p === '/api/save') {
        const ctx = lapka.context(url.searchParams.get('stream') || '');
        if (!ctx) return json(res, 404, { error: 'unknown stream; look at its page first' });
        return json(res, 202, saver.start(ctx.stream.id, ctx, { first: url.searchParams.get('first') === '1' }));
      }
      if (saver && mutating && p === '/api/saves/pause') return json(res, 200, { paused: saver.pauseAll().map(j => j.id) });
      if (saver && mutating && p === '/api/save/cancel') {
        const job = await saver.cancel(url.searchParams.get('id') || '');
        return job ? json(res, 200, job) : json(res, 404, { error: 'unknown job' });
      }
      if (saver && library && mutating && p === '/api/saves/cancel') {
        const seriesId = url.searchParams.get('series') || '', episodes = (url.searchParams.get('episodes') || '').split(',').filter(Boolean);
        const known = lapka.series(seriesId);
        const dir = known ? library.seriesDir(known) : ((await library.list()).find(x => x.id === seriesId) || {}).dir || null;
        return json(res, 200, { cancelled: await saver.cancelFor({ seriesId, episodes, dir }) });
      }
      /* the saved files, all of them: the saves under way go first, then the series folders */
      if (library && mutating && p === '/api/library/clear') {
        if (saver) await saver.cancelAll();
        return json(res, 200, await library.clear());
      }
      /* the notes: positions, watched marks, dub choices, what was learned about sites */
      if (state && mutating && p === '/api/state/forget') {
        state.forget();
        await store.forgetKnowledge();
        return json(res, 200, { ok: true });
      }
      if (library && mutating && p === '/api/library/delete') {
        const seriesId = url.searchParams.get('series') || '', episodes = (url.searchParams.get('episodes') || '').split(',').filter(Boolean);
        return json(res, 200, await library.remove(seriesId, episodes));
      }
      if (saver && mutating && p === '/api/save/promote') {
        const job = saver.promote(url.searchParams.get('id') || '');
        return job ? json(res, 200, job) : json(res, 404, { error: 'unknown job' });
      }
      if (saver && mutating && p === '/api/save/pause') {
        const job = saver.pause(url.searchParams.get('id') || '');
        return job ? json(res, 200, job) : json(res, 404, { error: 'unknown job' });
      }
      if (saver && req.method === 'GET' && p === '/api/saves') {
        const active = [...saver.jobs.values()].filter(j => j.state === 'working' || j.state === 'queued').map(j => ({ id: j.id, state: j.state, key: j.key, seriesId: j.seriesId, episode: j.episode, dub: j.dub, quality: j.quality, phase: j.phase, done: j.done, total: j.total, unit: j.unit || null }));
        return json(res, 200, { pending: state ? state.saves() : {}, active });
      }
      if (saver && mutating && p === '/api/saves/resume') {
        ctx.resumeSaves && ctx.resumeSaves().catch(() => {});
        return json(res, 202, { ok: true });
      }
      if (state && mutating && p === '/api/saves/forget') { state.clearSave(url.searchParams.get('key') || ''); return json(res, 200, { ok: true }); }
      if (state && mutating && p === '/api/state/setting') {
        const k = url.searchParams.get('k'); if (!/^[a-zA-Z]{1,40}$/.test(k || '')) return json(res, 400, { error: 'bad key' });
        state.setSetting(k, url.searchParams.has('v') ? url.searchParams.get('v') : undefined);
        return json(res, 200, { ok: true });
      }
      if (saver && req.method === 'GET' && (m = /^\/api\/save\/([\w-]+)$/.exec(p))) {
        const job = saver.job(m[1]);
        return job ? json(res, 200, job) : json(res, 404, { error: 'unknown job' });
      }
      if (library && req.method === 'GET' && p === '/api/library') return json(res, 200, { home: library.home, series: await library.list() });
      if (library && req.method === 'GET' && p === '/api/library/file') {
        const file = path.resolve(url.searchParams.get('path') || '');
        if (!library.inside(file) || !/\.mp4$/i.test(file)) return json(res, 403, { error: 'not in the library' });
        let st; try { st = await fsp.stat(file); } catch { return json(res, 404, { error: 'not found' }); }
        return serveRange(req, res, file, st.size, 'video/mp4');
      }
      if (state && req.method === 'GET' && p === '/api/state') return json(res, 200, state.get());
      if (state && mutating && p === '/api/state/position') {
        const q = url.searchParams;
        state.setPosition(q.get('series'), Number(q.get('episode')), q.get('dub'), q.has('t') ? Number(q.get('t')) : null, Number(q.get('d')) || 0);
        return json(res, 200, { ok: true });
      }
      if (state && mutating && p === '/api/state/watched') {
        const q = url.searchParams;
        state.setWatched(q.get('series'), Number(q.get('episode')), q.get('on') !== '0');
        return json(res, 200, { ok: true });
      }
      if (state && mutating && p === '/api/state/dub') {
        state.setDub(url.searchParams.get('series'), url.searchParams.get('dub') || null);
        return json(res, 200, { ok: true });
      }

      if (delivery && (m = /^\/api\/stream\/([a-f0-9]{16})(?:\.(m3u8|mp4|vtt)|\/(pl|seg|key))$/.exec(p))) {
        const entry = delivery.get(m[1]);
        if (!entry) return json(res, 404, { error: 'unknown stream' });
        try {
          if (m[2] === 'vtt') {
            const body = await delivery.text(entry);
            res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
            return res.end(body);
          }
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
      /* the same look, told as it goes: a stream of events, a step each, then the answer */
      if (req.method === 'GET' && p === '/api/look/live') {
        const target = url.searchParams.get('url');
        if (!/^https?:\/\//i.test(target || '')) return json(res, 400, { error: 'url must be http(s)' });
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'connection': 'keep-alive' });
        const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
        const t0 = Date.now();
        try { const looked = await lapka.look(target, { onStep: s => send('step', s) }); send('done', { ...looked, ms: Date.now() - t0 }); }
        catch (e) { send('fail', { error: e.message }); }
        return res.end();
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
