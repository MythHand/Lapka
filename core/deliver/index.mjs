/* ═══════════════════════════════════════════════════════════
   Delivery: a stream from somewhere else, played here.

   The browser cannot fetch another site's HLS: the wrong origin, the
   wrong referer, no cookies. So Lapka fetches it. A stream is
   registered under an id; the player asks for /api/stream/<id>.m3u8
   and gets the playlist with every address inside rewritten to come
   back through Lapka. Segments pass through and are written to the
   cache as they go; the second time they are served from disk.

   Nothing is proxied that was not first seen in a playlist of the
   stream it belongs to: this is a player, not an open proxy.

   MP4 goes through with its byte ranges intact and is not cached
   here: a whole file is fetched once at saving time instead.
   ═══════════════════════════════════════════════════════════ */
import { createHash } from 'node:crypto';

const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 16);
const ATTR_URI = /URI="([^"]+)"/g;

export function createDelivery({ session, cache }) {
  const streams = new Map();          // id → { id, stream, allowed:Set, meta }

  function register(stream, meta = {}) {
    const id = hash(`${meta.sourceId || ''}|${stream.url}`);
    if (!streams.has(id)) streams.set(id, { id, stream, meta, allowed: new Set([stream.url]) });
    return id;
  }
  const get = id => streams.get(id) || null;
  const nameFor = url => { const u = new URL(url); return hash(u.host + u.pathname) + (u.pathname.match(/\.[a-z0-9]+$/i)?.[0] || ''); };

  /* Every address in a playlist, absolute, rewritten to us; the
     originals are remembered as the only ones we will fetch. */
  function rewrite(entry, text, base) {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    const toUs = (raw, kind) => {
      let abs; try { abs = new URL(raw.trim(), base).toString(); } catch { return raw; }
      entry.allowed.add(abs);
      return `/api/stream/${entry.id}/${kind}?u=${encodeURIComponent(abs)}`;
    };
    for (const line of lines) {
      if (!line.trim()) { out.push(line); continue; }
      if (line.startsWith('#')) {
        out.push(/^#EXT-X-(KEY|MAP|MEDIA|I-FRAME-STREAM-INF|SESSION-KEY)/.test(line)
          ? line.replace(ATTR_URI, (_, u) => `URI="${toUs(u, /^#EXT-X-(KEY|SESSION-KEY)/.test(line) ? 'key' : /^#EXT-X-MAP/.test(line) ? 'seg' : 'pl')}"`)
          : line);
        continue;
      }
      /* a bare line is a variant playlist after STREAM-INF, else a segment */
      const prev = [...out].reverse().find(l => l.startsWith('#EXT'));
      const kind = prev && /^#EXT-X-STREAM-INF/.test(prev) ? 'pl' : 'seg';
      out.push(toUs(line, kind));
    }
    return out.join('\n');
  }

  async function fetchOrigin(entry, url, extra = {}) {
    const headers = { ...(entry.stream.headers || {}), ...extra };
    const res = await fetch(url, { headers: { 'user-agent': session.ua || 'Mozilla/5.0', ...headers }, redirect: 'follow' });
    return res;
  }

  /* The playlist: fetched every time (it may be live or signed
     anew), rewritten, and the media playlist kept for saving later. */
  async function playlist(entry, url = entry.stream.url) {
    if (!entry.allowed.has(url)) throw Object.assign(new Error('not in this stream'), { code: 403 });
    const res = await fetchOrigin(entry, url);
    if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status}`), { code: 502 });
    const text = await res.text();
    const body = rewrite(entry, text, res.url || url);
    cache.write(entry.id, nameFor(url), text).catch(() => {});
    return body;
  }

  /* A segment or a key: from the cache if it passed through before,
     otherwise from the origin and into the cache on the way. */
  async function piece(entry, url) {
    if (!entry.allowed.has(url)) throw Object.assign(new Error('not in this stream'), { code: 403 });
    const name = nameFor(url);
    if (await cache.has(entry.id, name)) { cache.touch(entry.id); return { bytes: await cache.read(entry.id, name), hit: true }; }
    const res = await fetchOrigin(entry, url);
    if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status}`), { code: 502 });
    const bytes = Buffer.from(await res.arrayBuffer());
    cache.write(entry.id, name, bytes).catch(() => {});
    return { bytes, hit: false };
  }

  /* MP4: the browser's range request goes to the origin as it is. */
  async function file(entry, range) {
    const res = await fetchOrigin(entry, entry.stream.url, range ? { range } : {});
    if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status}`), { code: 502 });
    return res;
  }

  return { register, get, playlist, piece, file, rewrite, streams, fetchOrigin, nameFor };
}

export const contentType = url => /\.m3u8(\?|$)/i.test(url) ? 'application/vnd.apple.mpegurl'
  : /\.ts(\?|$)/i.test(url) ? 'video/mp2t' : /\.(m4s|mp4)(\?|$)/i.test(url) ? 'video/mp4' : /\.key(\?|$)/i.test(url) ? 'application/octet-stream' : 'application/octet-stream';
