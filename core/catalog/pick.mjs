/* ═══════════════════════════════════════════════════════════
   Choosing for the user.

   The user picks a dub once. From then on Lapka picks everything else:
   which dub to use in the next episode (the same one, or the nearest
   thing to it), and which of the dub's sources to play (a live one,
   the preferred player if there is one, the best quality on offer).
   None of this is visible: the user sees an audio menu and a video.
   ═══════════════════════════════════════════════════════════ */
import { dubKey } from './model.mjs';

/* A source that failed is not dead forever: players come back, links
   get re-issued. After this long a failure counts as unknown again. */
export const RETRY_MS = 10 * 60 * 1000;

function healthRank(source, now) {
  const h = source.health;
  if (h.ok === true) return 2;
  if (h.ok === false && now - (h.checkedAt || 0) < RETRY_MS) return 0;
  return 1;
}

/* Quality strings come in every shape: "1080p", "720", "hd", "auto".
   Only the number is trusted; anything else sorts last. */
export function qualityRank(stream) {
  const m = /(\d{3,4})/.exec(String(stream?.quality || ''));
  return m ? Number(m[1]) : 0;
}

export function bestStream(source) {
  return [...(source.streams || [])].sort((a, b) => qualityRank(b) - qualityRank(a))[0] || null;
}

/* Sources in the order they should be tried. Position in the list is
   the final tie-breaker, so the order a page listed its players in
   still counts for something. */
export function rankSources(dub, { preferPlayer = null, now = Date.now() } = {}) {
  return dub.sources
    .map((s, i) => ({ s, i, health: healthRank(s, now), pref: s.player === preferPlayer ? 1 : 0, q: qualityRank(bestStream(s) || {}) }))
    .sort((a, b) => b.health - a.health || b.pref - a.pref || b.q - a.q || a.i - b.i)
    .map(r => r.s);
}

export const pickSource = (dub, opts) => rankSources(dub, opts)[0] || null;

export function markHealth(source, ok, error = null) {
  source.health = { ok: !!ok, checkedAt: Date.now(), error: ok ? null : (error && String(error)) || null };
  return source;
}

/* Carry the dub choice from one episode to the next. Exact studio
   first; then a dub of the same kind in the same language; then
   whatever the episode has. `pref` is the dub the user last chose. */
export function pickDub(episode, pref = null) {
  const dubs = episode.dubs;
  if (!dubs.length) return null;
  if (pref) {
    const key = dubKey(pref.name || pref);
    const same = dubs.find(d => d.key === key);
    if (same) return same;
    const near = dubs.find(d => d.kind === pref.kind && d.lang === pref.lang && d.lang);
    if (near) return near;
  }
  return dubs[0];
}
