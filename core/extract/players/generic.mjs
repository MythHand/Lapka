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
import { streamKind, qualityOf as quality } from '../../discover/players.mjs';

const STREAM_RE = /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?|(?<![\w/])\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?/g;
const NAME_KEYS = ['name', 'title', 'label', 'translation', 'voice', 'studio'];
const FILE_KEYS = ['file', 'src', 'url', 'hls', 'm3u8', 'mp4', 'link'];

const abs = (v, base) => { try { return new URL(v, base).toString(); } catch { return null; } };

/* Object literals in a script, whether JSON or JavaScript: keys
   without quotes, single quotes, trailing commas are all made into
   JSON before parsing. One flat object at a time; nested ones are
   found by the outer scan as their own flat objects. */
import { objectsIn, unpacked } from '../../discover/objects.mjs';

/* the language a label names, for the common ones; else nothing */
const LANGS = [['en', /^(english|eng|англ)/i], ['ru', /^(russian|rus|русск)/i], ['ja', /^(japanese|jpn|япон)/i], ['es', /^(spanish|spa|espa)/i], ['pt', /^(portug)/i], ['fr', /^(french|fra|franç)/i], ['de', /^(german|deu|deutsch)/i], ['it', /^(italian|ita)/i], ['ar', /^(arabic|ara)/i], ['uk', /^(ukrain|укра)/i], ['tr', /^(turkish|tur)/i], ['zh', /^(chinese|zho|中文)/i], ['ko', /^(korean|kor)/i]];
const langOfLabel = label => (LANGS.find(([, re]) => re.test(String(label || '').trim())) || [null])[0];

/* The kind of a file the object names: by its extension, else by
   what the object says of it ("type": "mp4", "application/x-mpegURL"),
   else by the mime in its query (googlevideo: mime=video%2Fmp4). */
function kindOf(o, url) {
  const byUrl = streamKind(url);
  if (byUrl) return byUrl;
  const said = String(o.type || o.mime || o.mimeType || o.kind || '').toLowerCase();
  if (/mpegurl|hls|m3u8/.test(said)) return 'hls';
  if (/mp4/.test(said)) return 'mp4';
  const mime = /[?&]mime=([^&]+)/.exec(url);
  if (mime) { const m = decodeURIComponent(mime[1]).toLowerCase(); if (/mp4/.test(m)) return 'mp4'; if (/mpegurl/.test(m)) return 'hls'; }
  return null;
}
function fileOf(o, base) {
  for (const k of FILE_KEYS) if (typeof o[k] === 'string') { const u = abs(o[k], base); if (u && /^https?:/.test(u) && kindOf(o, u)) return u; }
  return null;
}
/* the quality the object names, else the one the address carries;
   googlevideo names it by itag */
const ITAG = { 18: '360p', 22: '720p', 37: '1080p', 59: '480p', 43: '360p', 45: '720p', 46: '1080p' };
function qualityOfObject(o, url) {
  for (const k of ['label', 'quality', 'res', 'resolution', 'height']) {
    const v = o[k]; const m = /(\d{3,4})/.exec(String(v ?? ''));
    if (m) return `${m[1]}p`;
  }
  const itag = /[?&]itag=(\d+)/.exec(url);
  if (itag && ITAG[itag[1]]) return ITAG[itag[1]];
  return quality(url);
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
    const headers = { referer: base };
    /* the "page" is the playlist itself: the address is the stream */
    if (/^\s*#EXTM3U/.test(String(res.body || '').slice(0, 200))) return { streams: [{ kind: 'hls', url: base, quality: null, headers: { referer: new URL(base).origin + '/' } }], dubs: [] };
    const { document: doc } = parseHTML(res.body);
    const seen = new Set();
    const streams = [];
    const push = (u, kind = null, q = null) => {
      u = abs(u, base);
      if (!u || seen.has(u)) return;
      kind = kind || streamKind(u);
      if (!kind) return;
      seen.add(u); streams.push({ kind, url: u, quality: q || quality(u), headers });
    };

    for (const v of doc.querySelectorAll('video')) {
      push(v.getAttribute('src') || v.getAttribute('data-src'));
      for (const s of v.querySelectorAll('source')) push(s.getAttribute('src'));
    }

    /* subtitle tracks: <track> elements, and the player's own list
       of tracks (jwplayer: {file, label, kind: "captions"}); a track
       of thumbnails is not one */
    const subs = [];
    const seenSub = new Set();
    const addSub = (u, label = '', lang = null, def = false) => {
      u = abs(u, base);
      if (!u || seenSub.has(u)) return;
      seenSub.add(u); subs.push({ url: u, label: String(label || '').trim(), lang: lang || langOfLabel(label), format: /\.srt(\?|$)/i.test(u) ? 'srt' : 'vtt', headers, default: !!def });
    };
    for (const tr of doc.querySelectorAll('track[src]')) if (!tr.getAttribute('kind') || /subtitles|captions/i.test(tr.getAttribute('kind'))) addSub(tr.getAttribute('src'), tr.getAttribute('label') || '', tr.getAttribute('srclang') || null, tr.hasAttribute('default'));

    const dubs = [];
    /* packed scripts are read unpacked: the hosters' players keep their addresses in them */
    const scripts = [...doc.querySelectorAll('script:not([src])')].map(s => s.textContent).flatMap(t => [t, ...unpacked(t)]);
    for (const text of scripts) {
      for (const o of objectsIn(text)) {
        const track = typeof o.file === 'string' || typeof o.src === 'string' ? (o.file || o.src) : null;
        if (track && (/captions|subtitles/i.test(String(o.kind || '')) || /\.(vtt|srt)(\?|$)/i.test(track)) && !/thumbnails|chapters/i.test(String(o.kind || ''))) { addSub(track, o.label || o.name || '', o.srclang || o.lang || o.language || null, o.default); continue; }
        const file = fileOf(o, base), name = nameOf(o);
        if (!file) continue;
        /* a name that is a quality ("360p") names no dub: the object is a source of the one video */
        if (name && !/^\d{3,4}p?$/i.test(name)) dubs.push({ name, streams: [{ kind: kindOf(o, file), url: file, quality: qualityOfObject(o, file), headers }] });
        else push(file, kindOf(o, file), qualityOfObject(o, file));
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

    return { subs, streams, dubs: [...merged.values()] };
  },
};
