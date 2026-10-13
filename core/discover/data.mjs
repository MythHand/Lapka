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
import { numberFromText } from './numbers.mjs';

const NUMBER_KEYS = ['ordinal', 'number', 'episode', 'episode_number', 'num', 'ep', 'serie', 'seriya'];
const TITLE_KEYS = ['title', 'name', 'episode_title', 'label'];
const STREAM_KEYS = ['hls', 'url', 'file', 'src', 'link', 'stream', 'video', 'mp4'];
const DURATION_KEYS = ['duration', 'length_seconds', 'runtime'];

const kindOf = u => /\.m3u8(\?|$)/i.test(u) ? 'hls' : /\.mp4(\?|$)/i.test(u) ? 'mp4' : null;
/* an address, absolute or relative to the page, or null */
const addressOf = (v, base) => { if (typeof v !== 'string' || !/^(?:https?:)?\/|^\.?\//.test(v.trim())) return null; try { return new URL(v.trim(), base).toString(); } catch { return null; } };
/* the moment a signed address stops working, when it says so (expires=, t=, e= in unix seconds) */
const expiryOf = u => { const m = /[?&](?:expires?|exp|t|e)=(\d{9,10})(?:&|$)/.exec(u); return m ? Number(m[1]) * 1000 : null; };
const qualityTag = q => { const h = /^(\d{3,4})\s*p?$/i.exec(String(q).trim()); return h ? `${h[1]}p` : null; };
const stream = (u, quality) => { const kind = kindOf(u); return kind ? { kind, url: u, quality, expiresAt: expiryOf(u) } : null; };

/* The streams an object names: one address; a map of quality → address;
   or the players' way of listing qualities in one string, "[480p]a,[720p]b",
   each with a second address after "or" to fall back on. */
function streamsOf(o, base) {
  const out = [];
  const push = st => { if (st && !out.some(x => x.url === st.url)) out.push(st); };
  for (const k of STREAM_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && /\[\s*\d{3,4}\s*p?\s*\]/i.test(v)) {
      for (const m of v.matchAll(/\[\s*(\d{3,4})\s*p?\s*\]\s*([^,\[]+)/gi)) { const first = m[2].split(/\s+or\s+/i)[0].trim(); const u = addressOf(first, base); if (u) push(stream(u, `${m[1]}p`)); }
    } else if (typeof v === 'string') { const u = addressOf(v.split(/\s+or\s+/i)[0], base); if (u) push(stream(u, null)); }
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [q, raw] of Object.entries(v)) { const u = addressOf(raw, base); if (u) push(stream(u, qualityTag(q))); }
    }
  }
  return out;
}
/* the number: a key that names it, else the number in the title ("Эпизод 3", "3 серия") */
const numberOf = o => {
  for (const k of NUMBER_KEYS) { const n = Number(o[k]); if (o[k] !== undefined && o[k] !== null && o[k] !== '' && Number.isFinite(n)) return n; }
  for (const k of TITLE_KEYS) { if (typeof o[k] === 'string') { const n = numberFromText(o[k]); if (n !== null) return n; } }
  return null;
};
const titleOf = o => { for (const k of TITLE_KEYS) { const v = o[k]; if (typeof v === 'string' && v.trim() && !/^\d+$/.test(v.trim()) && !/^\s*(?:эпизод|серия|episode|episodio|capitulo|capítulo)?\s*№?\s*\d+\s*(?:серия|эпизод|episode)?\s*$/i.test(v)) return v.trim(); } return ''; };
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
export function episodesInData(texts, base = 'https://x/') {
  let best = [];
  for (const text of texts) {
    if (!/[{,]\s*"?(?:hls|url|file|src|link|stream|video|mp4)"?\s*:/.test(text)) continue;
    for (const a of arraysIn(text)) {
      const items = a.map(o => ({ number: numberOf(o), streams: streamsOf(o, base), o })).filter(x => x.number !== null && x.streams.length);
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
