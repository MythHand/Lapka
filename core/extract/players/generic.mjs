/* ═══════════════════════════════════════════════════════════
   The generic extractor: an embed page that gives its stream away.

   Most embeds are one HTML page with the stream in plain sight: a
   <video src>, a <source>, a `file: "…m3u8"` in a script, a list of
   objects in a script each with a name and a file. This reads all of
   that. It knows nothing about any particular player, so it comes
   last, and when it finds nothing the player is left for a named
   extractor to be written.
   ═══════════════════════════════════════════════════════════ */
import { parseHTML } from 'linkedom';
import { streamKind } from '../../discover/players.mjs';

const STREAM_RE = /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?|(?<![\w/])\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?/g;
const NAME_KEYS = ['name', 'title', 'label', 'translation', 'voice', 'studio'];
const FILE_KEYS = ['file', 'src', 'url', 'hls', 'm3u8', 'mp4', 'link'];

const abs = (v, base) => { try { return new URL(v, base).toString(); } catch { return null; } };
const quality = u => { const m = /(\d{3,4})p?(?=[^\d]|$)/.exec(new URL(u).pathname.split('/').pop() || ''); return m && Number(m[1]) >= 240 && Number(m[1]) <= 4320 ? `${m[1]}p` : null; };

/* Object literals in a script, whether JSON or JavaScript: keys
   without quotes, single quotes, trailing commas are all made into
   JSON before parsing. One flat object at a time; nested ones are
   found by the outer scan as their own flat objects. */
function objectsIn(text) {
  const out = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const raw = m[0]
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_, s) => JSON.stringify(s))
      .replace(/,\s*}/g, '}');
    try { const o = JSON.parse(raw); if (o && typeof o === 'object') out.push(o); } catch { /* not an object we can read */ }
  }
  return out;
}

function fileOf(o, base) {
  for (const k of FILE_KEYS) if (typeof o[k] === 'string' && streamKind(o[k])) return abs(o[k], base);
  return null;
}
function nameOf(o) {
  for (const k of NAME_KEYS) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
  return null;
}

export default {
  name: 'generic',
  match: () => true,

  async extract(embedUrl, { referer = null } = {}, session) {
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw new Error(`embed answered ${res.status}`);
    const base = res.url || embedUrl;
    const { document: doc } = parseHTML(res.body);
    const headers = { referer: base };
    const seen = new Set();
    const streams = [];
    const push = (u) => {
      u = abs(u, base);
      if (!u || seen.has(u) || !streamKind(u)) return;
      seen.add(u); streams.push({ kind: streamKind(u), url: u, quality: quality(u), headers });
    };

    for (const v of doc.querySelectorAll('video')) {
      push(v.getAttribute('src') || v.getAttribute('data-src'));
      for (const s of v.querySelectorAll('source')) push(s.getAttribute('src'));
    }

    const dubs = [];
    const scripts = [...doc.querySelectorAll('script:not([src])')].map(s => s.textContent);
    for (const text of scripts) {
      for (const o of objectsIn(text)) {
        const file = fileOf(o, base), name = nameOf(o);
        if (file && name) dubs.push({ name, streams: [{ kind: streamKind(file), url: file, quality: quality(file), headers }] });
      }
      for (const m of text.matchAll(STREAM_RE)) push(m[0]);
    }

    /* the same studio listed for two qualities is one dub, two streams */
    const merged = new Map();
    for (const d of dubs) {
      const key = d.name.toLowerCase();
      if (!merged.has(key)) merged.set(key, { name: d.name, streams: [] });
      for (const s of d.streams) if (!merged.get(key).streams.some(x => x.url === s.url)) merged.get(key).streams.push(s);
    }

    return { streams, dubs: [...merged.values()] };
  },
};
