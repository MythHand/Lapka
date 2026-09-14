/* ═══════════════════════════════════════════════════════════
   The catalog: everything Lapka knows about a series, in one shape.

     Series
       Episode          by number
         Dub            by studio key ("audio track" to the user)
           Source       one embedded player that offers this dub
             Stream     an actual URL, short-lived

   Identity never comes from a file path. A series is its source page,
   an episode is its number, a dub is its studio, a source is the
   player plus the embed it lives at. Anything keyed by these survives
   a restart, a cache purge and a move to another disk.

   Streams are the one exception: they expire in hours and are bound to
   the user's IP, so they are never persisted (see snapshot.mjs).
   ═══════════════════════════════════════════════════════════ */
import { createHash } from 'node:crypto';
import { normalizeName, studioFor } from './studios.mjs';

export const hash = (s, n = 12) => createHash('sha1').update(String(s)).digest('hex').slice(0, n);

/* The same page reached with a tracking tag, a fragment or a trailing
   slash is the same series. Query strings stay: on many sites the
   query is the only thing that says which series it is. */
export function canonicalUrl(url) {
  const u = new URL(url);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|fbclid|yclid|gclid|_ga)/i.test(k)) u.searchParams.delete(k);
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.toString();
}

export const seriesId = url => hash(canonicalUrl(url));

/* The key a dub merges on. A known studio wins under its table key,
   an unknown one under its normalised spelling. */
export function dubKey(name) {
  const s = studioFor(name);
  return s ? s.key : normalizeName(name);
}

export const sourceId = (player, embedUrl) => hash(`${player}|${embedUrl}`);

/* What a page with a stream and no dub switch offers: a dub nobody
   named. The user sees this until a profile or an adapter does better. */
export const UNNAMED_DUB = 'Основной';

const now = () => Date.now();

export function createSeries({ sourceUrl, title = '', altTitles = [], cover = null, year = null } = {}) {
  if (!sourceUrl) throw new Error('a series needs a sourceUrl');
  /* the id is the canonical address; the address kept is the one that
     actually answered, because a site may want its trailing slash */
  return {
    id: seriesId(sourceUrl),
    sourceUrl: String(sourceUrl).replace(/#.*$/, ''),
    title, altTitles: [...altTitles], cover, year,
    episodes: [],
    provenance: [],
    updatedAt: now(),
  };
}

export function createEpisode({ number, title = '', sourceUrl = null, duration = null }) {
  if (!Number.isFinite(number)) throw new Error('an episode needs a number');
  return { number, title, sourceUrl, duration, dubs: [], opened: false };
}

export function createDub({ name, studio = null, lang = null, kind = 'dub' }) {
  if (!name) throw new Error('a dub needs a name');
  const known = studioFor(name);
  return {
    key: dubKey(name),
    name: known ? known.name : String(name).trim(),
    studio: studio || (known ? known.name : null),
    lang, kind,
    sources: [],
  };
}

export function createSource({ player, embedUrl, extractor = null, origin = null }) {
  if (!player || !embedUrl) throw new Error('a source needs a player and an embedUrl');
  return {
    id: sourceId(player, embedUrl),
    player, embedUrl, extractor, origin,
    health: { ok: null, checkedAt: null, error: null },
    streams: [],
  };
}

export function createStream({ kind, url, quality = null, headers = {}, expiresAt = null }) {
  if (!kind || !url) throw new Error('a stream needs a kind and a url');
  return { kind, url, quality, headers: { ...headers }, expiresAt };
}

/* Lookups by identity, the only way anything is found in a catalog. */
export const findEpisode = (series, number) => series.episodes.find(e => e.number === number) || null;
export const findDub = (episode, name) => { const k = dubKey(name); return episode.dubs.find(d => d.key === k) || null; };
export const findSource = (dub, player, embedUrl) => { const id = sourceId(player, embedUrl); return dub.sources.find(s => s.id === id) || null; };

/* Every dub the series has anywhere, for the audio menu: a dub that
   exists in episode 3 but not in episode 1 still belongs in the list. */
export function allDubs(series) {
  const seen = new Map();
  for (const e of series.episodes) for (const d of e.dubs) if (!seen.has(d.key)) seen.set(d.key, d);
  return [...seen.values()];
}
