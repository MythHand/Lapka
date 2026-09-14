/* ═══════════════════════════════════════════════════════════
   The synthetic site, over real HTTP.

   Pages are rendered from cases.mjs on every request, media comes
   from the ffmpeg fixtures. Loopback only, a port of its own, nothing
   of the user's is ever read. Also runnable by hand to look at the
   pages in a browser:

     node test/site/serve.mjs            # prints the address
   ═══════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, caseById } from './cases.mjs';
import { renderHome, renderSeries, renderEpisode, renderEmbedAlpha, renderEmbedBeta } from './render.mjs';

const TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg', '.mkv': 'video/x-matroska',
};

/* Cover images are not part of the fixtures; a page still references
   one, because real pages do, and the discovery has to cope. */
const COVER = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');

export function startSite({ port = 0, media } = {}) {
  const html = (res, body, status = 200) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  const notFound = res => html(res, '<h1>404</h1>', 404);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    let m;

    if (p === '/') return html(res, renderHome());

    if ((m = /^\/s\/([a-z]+)\/$/.exec(p))) {
      const c = caseById(m[1]);
      return c ? html(res, renderSeries(c)) : notFound(res);
    }
    if ((m = /^\/s\/([a-z]+)\/ep-(\d+)$/.exec(p))) {
      const c = caseById(m[1]), ep = Number(m[2]);
      return c && ep >= 1 && ep <= c.episodes ? html(res, renderEpisode(c, ep)) : notFound(res);
    }
    if ((m = /^\/embed\/alpha\/([a-z]+)-(\d+)-([a-z0-9]+)$/.exec(p))) {
      const c = caseById(m[1]), ep = Number(m[2]);
      const body = c && c.players.includes('alpha') && ep <= c.episodes ? renderEmbedAlpha(c, ep, m[3]) : null;
      return body ? html(res, body) : notFound(res);
    }
    if ((m = /^\/embed\/beta\/([a-z]+)-(\d+)$/.exec(p))) {
      const c = caseById(m[1]), ep = Number(m[2]);
      return c && c.players.includes('beta') && ep <= c.episodes ? html(res, renderEmbedBeta(c, ep)) : notFound(res);
    }
    if (/^\/media\/cover-[a-z]+\.jpg$/.test(p)) {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': COVER.length });
      return res.end(COVER);
    }
    if ((m = /^\/media\/((?:hls\/)?[a-z0-9]+\.(?:m3u8|ts|mp4|mkv))$/.exec(p)) && media) {
      const file = path.join(media, m[1]);
      let st;
      try { st = await fsp.stat(file); } catch { return notFound(res); }
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes' });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes' });
      return fs.createReadStream(file).pipe(res);
    }
    notFound(res);
  });

  return new Promise((ok, bad) => {
    server.once('error', bad);
    server.listen(port, '127.0.0.1', () => {
      const { port: got } = server.address();
      ok({
        port: got,
        base: `http://127.0.0.1:${got}`,
        cases: CASES,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

/* Run by hand only. `node --test` treats every file under test/ as a
   test and runs it as the main module, which would start the site
   here and wait forever; the test runner marks its children, so they
   are told apart. */
if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { build } = await import('../fixtures.mjs');
  const fx = await build();
  const site = await startSite({ port: Number(process.env.PORT) || 8790, media: fx.show });
  console.log(`synthetic site: ${site.base}`);
}
