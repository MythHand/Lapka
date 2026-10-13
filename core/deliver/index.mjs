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
import { originReason } from '../reasons.mjs';
import { streamTag } from '../catalog/model.mjs';

const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 16);
const ATTR_URI = /URI="([^"]+)"/g;

export function createDelivery({ session, cache }) {
  const streams = new Map();          // id → { id, stream, allowed:Set, meta, names:Map, tags:Map }
  /* the cache is asked for each time: the Lapka folder can change while running */
  const cacheOf = () => (typeof cache === 'function' ? cache() : cache);

  /* the id is made of what stays when a player signs its address anew; the cache folder named by it stays with it */
  function register(stream, meta = {}) {
    const id = meta.seriesId
      ? hash(`${meta.seriesId}|${meta.episode}|${meta.dub}|${meta.sourceId || ''}|${streamTag(stream)}|${meta.nth || 0}`)
      : hash(`${meta.sourceId || ''}|${stream.url}`);
    const known = streams.get(id);
    if (!known) streams.set(id, { id, stream, meta, allowed: new Set([stream.url]), names: new Map(), tags: new Map() });
    else if (known.stream.url !== stream.url) { known.stream = stream; known.allowed.add(stream.url); }   // signed anew: the same episode at a fresh address
    return id;
  }
  const get = id => streams.get(id) || null;

  /* The name a piece is kept under in the cache: its place in its
     playlist, so that the same piece at a fresh address is found; an
     address never seen in a playlist is named by its path. */
  const ext = url => { try { return new URL(url).pathname.match(/\.[a-z0-9]+$/i)?.[0] || ''; } catch { return ''; } };
  const nameFor = (entry, url) => entry.names.get(url) || (() => { const u = new URL(url); return hash(u.host + u.pathname) + ext(url); })();
  const playlistTag = (entry, url) => entry.tags.get(url) || 'main';
  /* a playlist read: each address in it is named by its place, each variant and rendition tagged, before anything is asked for */
  function learn(entry, text, base) {
    const tag = playlistTag(entry, base);
    const lines = String(text).split(/\r?\n/);
    const abs = raw => { try { return new URL(raw.trim(), base).toString(); } catch { return null; } };
    let seg = 0, key = 0, map = 0, media = 0, variant = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (line.startsWith('#')) {
        const uri = /URI="([^"]+)"/.exec(line)?.[1];
        if (!uri) continue;
        const a = abs(uri); if (!a) continue;
        if (/^#EXT-X-(KEY|SESSION-KEY)/.test(line)) entry.names.set(a, `${tag}-k${key++}${ext(a) || '.key'}`);
        else if (/^#EXT-X-MAP/.test(line)) entry.names.set(a, `${tag}-map${map++}${ext(a)}`);
        else if (/^#EXT-X-MEDIA/.test(line)) entry.tags.set(a, `${/TYPE=AUDIO/.test(line) ? 'a' : 'r'}${media++}`);
        continue;
      }
      const a = abs(line); if (!a) continue;
      const prev = lines.slice(0, i).reverse().find(l => l.startsWith('#EXT'));
      if (prev && /^#EXT-X-STREAM-INF/.test(prev)) { const h = /RESOLUTION=\d+x(\d+)/.exec(prev)?.[1]; entry.tags.set(a, `v${h || variant}`); variant++; }
      else entry.names.set(a, `${tag}-${seg++}${ext(a)}`);
    }
    return tag;
  }

  /* Every address in a playlist, absolute, rewritten to us; the
     originals are remembered as the only ones we will fetch. */
  function rewrite(entry, text, base) {
    learn(entry, text, base);
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

  /* An origin that takes the connection and then says nothing would hold
     the request for ever; it is given a quarter of a minute to begin its
     answer. Only the beginning: a long body on a slow line is let through. */
  const FIRST_BYTE_MS = 15000;
  async function fetchOrigin(entry, url, extra = {}, { signal = undefined } = {}) {
    const headers = { ...(entry.stream.headers || {}), ...extra };
    const ac = new AbortController();
    const clock = setTimeout(() => ac.abort(Object.assign(new Error('the origin did not begin to answer'), { name: 'TimeoutError' })), FIRST_BYTE_MS);
    try {
      return await fetch(url, { headers: { 'user-agent': session.ua || 'Mozilla/5.0', ...headers }, redirect: 'follow', signal: signal ? AbortSignal.any([signal, ac.signal]) : ac.signal });
    } finally { clearTimeout(clock); }   // the answer has begun: its body may take as long as it takes
  }

  /* A subtitle track: fetched from the origin and given as WebVTT,
     which is what a browser's <track> reads; SRT is turned into it
     (the timestamps' commas become dots, the header goes on top). */
  async function text(entry) {
    const res = await fetchOrigin(entry, entry.stream.url);
    if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status}`), { code: 502, reason: originReason(res.status) });
    const raw = (await res.text()).replace(/^\uFEFF/, '');
    if (/^WEBVTT/.test(raw.trim())) return raw;
    const cues = raw.replace(/\r\n?/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + cues.trim() + '\n';
  }

  /* The playlist: fetched every time (it may be live or signed
     anew), rewritten, and the media playlist kept for saving later. */
  async function playlist(entry, url = entry.stream.url) {
    if (!entry.allowed.has(url)) throw Object.assign(new Error('not in this stream'), { code: 403, reason: { key: 'noStream' } });
    const res = await fetchOrigin(entry, url);
    if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status}`), { code: 502, reason: originReason(res.status) });
    const text = await res.text();
    const base = res.url || url;
    const body = rewrite(entry, text, base);
    cacheOf().write(entry.id, `${playlistTag(entry, base)}.m3u8`, text).catch(() => {});
    return body;
  }

  /* A segment or a key: from the cache if it passed through before,
     otherwise from the origin and into the cache on the way. A piece
     asked for twice at once (the player and the warming of the episode
     both want it) is fetched once and given to both. */
  const inFlight = new Map();         // id/name → the fetch under way
  async function piece(entry, url) {
    if (!entry.allowed.has(url)) throw Object.assign(new Error('not in this stream'), { code: 403, reason: { key: 'noStream' } });
    const name = nameFor(entry, url);
    const cache = cacheOf();
    if (await cache.has(entry.id, name)) { cache.touch(entry.id); return { bytes: await cache.read(entry.id, name), hit: true }; }
    const key = `${entry.id}/${name}`;
    if (inFlight.has(key)) return { bytes: await inFlight.get(key), hit: true };
    const fetching = (async () => {
      const res = await fetchOrigin(entry, url);
      if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status}`), { code: 502, reason: originReason(res.status) });
      const bytes = Buffer.from(await res.arrayBuffer());
      cache.write(entry.id, name, bytes).catch(() => {});
      return bytes;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, fetching);
    return { bytes: await fetching, hit: false };
  }

  /* MP4: the browser's range request goes to the origin as it is. */
  async function file(entry, range) {
    const res = await fetchOrigin(entry, entry.stream.url, range ? { range } : {});
    if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status}`), { code: 502, reason: originReason(res.status) });
    return res;
  }

  return { register, get, playlist, text, piece, file, rewrite, learn, streams, fetchOrigin, nameFor };
}

export const contentType = url => /\.m3u8(\?|$)/i.test(url) ? 'application/vnd.apple.mpegurl'
  : /\.ts(\?|$)/i.test(url) ? 'video/mp2t' : /\.(m4s|mp4)(\?|$)/i.test(url) ? 'video/mp4' : /\.key(\?|$)/i.test(url) ? 'application/octet-stream' : 'application/octet-stream';
