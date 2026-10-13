/* ═══════════════════════════════════════════════════════════
   Episodes in the page's data.

   A page drawn by a script often carries its episodes not as links
   but as data: an array of objects, each with a number and the
   address of its video, sometimes a title, a duration, the opening
   and the ending marked. The shape is nobody's in particular; the
   keys are the usual words. Read from any text a script holds, the
   framework's payload included.
   ═══════════════════════════════════════════════════════════ */
import { arraysIn } from './objects.mjs';

const NUMBER_KEYS = ['ordinal', 'number', 'episode', 'episode_number', 'num', 'ep', 'serie', 'seriya'];
const TITLE_KEYS = ['title', 'name', 'episode_title', 'label'];
const STREAM_KEYS = ['hls', 'url', 'file', 'src', 'link', 'stream', 'video', 'mp4'];
const DURATION_KEYS = ['duration', 'length_seconds', 'runtime'];

const kindOf = u => /\.m3u8(\?|$)/i.test(u) ? 'hls' : /\.mp4(\?|$)/i.test(u) ? 'mp4' : null;
const isUrl = v => typeof v === 'string' && /^(https?:)?\/\/\S+/i.test(v);
const abs = v => (v.startsWith('//') ? 'https:' + v : v);

/* the streams an object names: one address, or a map of quality → address */
function streamsOf(o) {
  const out = [];
  for (const k of STREAM_KEYS) {
    const v = o[k];
    if (isUrl(v)) { const kind = kindOf(v); if (kind) out.push({ kind, url: abs(v), quality: null }); }
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [q, u] of Object.entries(v)) {
        if (!isUrl(u)) continue;
        const kind = kindOf(u); if (!kind) continue;
        const h = /^(\d{3,4})p?$/i.exec(String(q).trim());
        out.push({ kind, url: abs(u), quality: h ? `${h[1]}p` : null });
      }
    }
  }
  return out;
}
const numberOf = o => { for (const k of NUMBER_KEYS) { const n = Number(o[k]); if (o[k] !== undefined && o[k] !== null && o[k] !== '' && Number.isFinite(n)) return n; } return null; };
const titleOf = o => { for (const k of TITLE_KEYS) { const v = o[k]; if (typeof v === 'string' && v.trim() && !/^\d+$/.test(v.trim())) return v.trim(); } return ''; };
const durationOf = o => { for (const k of DURATION_KEYS) { const n = Number(o[k]); if (Number.isFinite(n) && n > 0) return n; } return null; };
/* "opening": {start, stop|end} or {time, length}: a span in seconds */
const span = m => {
  if (!m || typeof m !== 'object') return null;
  const start = Number(m.start ?? m.from ?? m.time), stop = Number(m.stop ?? m.end ?? m.to ?? (m.length != null ? Number(m.time) + Number(m.length) : NaN));
  return Number.isFinite(start) && Number.isFinite(stop) && stop > start ? { start, stop } : null;
};
const marksOf = o => { const opening = span(o.opening || o.op || o.intro), ending = span(o.ending || o.ed || o.outro); return opening || ending ? { opening, ending } : null; };

/* The episodes named in the texts: the largest array whose objects
   are episodes (a number and a stream each, nearly all of them), each
   number once, in order. */
export function episodesInData(texts) {
  let best = [];
  for (const text of texts) {
    if (!/[{,]\s*"?(?:hls|url|file|src|link|stream|video|mp4)"?\s*:/.test(text)) continue;
    for (const a of arraysIn(text)) {
      const items = a.map(o => ({ number: numberOf(o), streams: streamsOf(o), o })).filter(x => x.number !== null && x.streams.length);
      if (!items.length || items.length < a.length * 0.8) continue;
      const seen = new Set();
      const eps = [];
      for (const x of items) {
        if (seen.has(x.number)) continue;
        seen.add(x.number);
        eps.push({ number: x.number, title: titleOf(x.o), duration: durationOf(x.o), marks: marksOf(x.o), streams: x.streams });
      }
      if (eps.length > best.length) best = eps;
    }
  }
  return best.sort((a, b) => a.number - b.number);
}
