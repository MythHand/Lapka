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

/* A playlist in the player's script: seasons of episodes, each with
   its HLS, its audio renditions named (one per dub), its subtitles.
   The shape VenomPlayer and its kin use:
     seasons: [{ season, episodes: [{ episode, hls, dash, audio: { names, order }, cc: [{ name, url }], title, duration }] }]
   Read by matching brackets, not by running anything. */
export function readPlaylist(text) {
  const t = String(text || '');
  const at = t.search(/\bseasons\s*:\s*\[/);
  if (at < 0) return null;
  const start = t.indexOf('[', at);
  let depth = 0, inStr = null;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return normalizePlaylist(JSON.parse(t.slice(start, i + 1)), t); } catch { return null; } } }
  }
  return null;
}
function normalizePlaylist(seasons, text) {
  if (!Array.isArray(seasons)) return null;
  const cur = /current\s*:\s*\{\s*season\s*:\s*"?(\d+)"?\s*,\s*episode\s*:\s*"?([\d.]+)"?/.exec(text);
  const out = seasons.map(se => ({
    season: Number(se.season) || 1,
    episodes: (se.episodes || []).map(e => ({
      number: Number(e.episode ?? e.number), title: String(e.title || ''), duration: Number(e.duration) || null,
      hls: e.hls || e.file || e.url || null, dash: e.dash || null,
      audio: e.audio && Array.isArray(e.audio.names) ? { names: e.audio.names.map(String), order: Array.isArray(e.audio.order) ? e.audio.order.map(Number) : null } : null,
      subs: (e.cc || e.subtitles || e.tracks || []).map(c => ({ url: c.url || c.file, label: String(c.name || c.label || ''), lang: langOfLabel(c.name || c.label), format: /\.srt(\?|$)/i.test(String(c.url || c.file || '')) ? 'srt' : 'vtt' })).filter(c => c.url),
    })).filter(e => Number.isFinite(e.number) && e.hls),
  })).filter(se => se.episodes.length);
  return out.length ? { seasons: out, current: cur ? { season: Number(cur[1]), episode: Number(cur[2]) } : null } : null;
}
/* the stream's expiry, when the address says it (t=<unix seconds>) */
const expiryOf = url => { const m = /[?&]t=(\d{9,10})(?:&|$)/.exec(url); return m ? Number(m[1]) * 1000 : null; };
/* the dubs of an episode of the playlist: one per audio rendition, or one unnamed */
function dubsOfEpisode(e, headers) {
  const stream = (audio = null) => ({ kind: 'hls', url: e.hls, quality: null, headers, expiresAt: expiryOf(e.hls), audio });
  const names = e.audio ? e.audio.names : [];
  if (!names.length) return [{ name: null, streams: [stream()] }];
  const order = e.audio.order && e.audio.order.length === names.length ? e.audio.order : names.map((_, i) => i);
  return names.map((name, i) => ({ name, streams: [stream({ index: order.indexOf(i) >= 0 ? order.indexOf(i) : i, name })] }));
}
const withParams = (url, season, episode) => { const u = new URL(url); u.searchParams.set('season', String(season)); u.searchParams.set('episode', String(episode)); return u.toString(); };

export default {
  name: 'generic',
  match: () => true,

  /* An embed whose script holds the playlist of the whole series:
     the season the embed shows (its season parameter, else the
     current one, else the first), every episode of it with its dubs
     as audio renditions of one HLS, its subtitles, its expiry. Each
     source is the same embed opened at that episode. */
  async unfold(embedUrl, { referer = null } = {}, session) {
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw new Error(`embed answered ${res.status}`);
    const base = res.url || embedUrl;
    const { document: doc } = parseHTML(res.body);
    let pl = null;
    for (const s of doc.querySelectorAll('script:not([src])')) { pl = readPlaylist(s.textContent); if (pl) break; }
    if (!pl) return null;
    const want = Number(new URL(base).searchParams.get('season')) || pl.current?.season || pl.seasons[0].season;
    const season = pl.seasons.find(se => se.season === want) || pl.seasons[0];
    const headers = { referer: new URL(base).origin + '/' };
    const episodes = season.episodes.map(e => ({
      number: e.number, title: e.title || undefined, duration: e.duration || undefined,
      dubs: dubsOfEpisode(e, headers).map(d => ({ name: d.name || undefined, kind: 'dub', sources: [{ embedUrl: withParams(base, season.season, e.number), streams: d.streams, subs: e.subs }] })),
    }));
    if (episodes.length < 2 && !episodes[0]?.dubs.length) return null;
    return { episodes, season: season.season, seasons: pl.seasons.map(se => se.season) };
  },

  async extract(embedUrl, { referer = null } = {}, session) {
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw new Error(`embed answered ${res.status}`);
    const base = res.url || embedUrl;
    const headers = { referer: base };
    /* the player's script holds the playlist: the episode this embed
       is opened at, its dubs as audio renditions, its subtitles */
    if (/\bseasons\s*:\s*\[/.test(String(res.body || ''))) {
      const { document: d } = parseHTML(res.body);
      let pl = null;
      for (const s of d.querySelectorAll('script:not([src])')) { pl = readPlaylist(s.textContent); if (pl) break; }
      if (pl) {
        const u = new URL(base);
        const wantS = Number(u.searchParams.get('season')) || pl.current?.season || pl.seasons[0].season;
        const wantE = Number(u.searchParams.get('episode')) || pl.current?.episode || null;
        const season = pl.seasons.find(se => se.season === wantS) || pl.seasons[0];
        const e = (wantE !== null && season.episodes.find(x => x.number === wantE)) || season.episodes[0];
        if (e) {
          const h = { referer: u.origin + '/' };
          const dubs = dubsOfEpisode(e, h);
          if (dubs.length === 1 && !dubs[0].name) return { streams: dubs[0].streams, dubs: [], subs: e.subs.map(sb => ({ ...sb, headers: h })) };
          return { streams: [], dubs: dubs.map(x => ({ name: x.name, streams: x.streams })), subs: e.subs.map(sb => ({ ...sb, headers: h })) };
        }
      }
    }
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
