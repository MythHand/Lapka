/* ═══════════════════════════════════════════════════════════
   YummyAnime, at old.yummyani.me: a catalog whose player is drawn
   by a script, so the page itself holds no episodes and no players.

   Its API says everything: /api/anime/<slug> names the series, and
   /api/anime/<id>/videos lists every video: an episode number, a dub
   ("Озвучка AniDUB", "Субтитры SovetRomantica"), a player (Alloha,
   Kodik, their own CVH), the embed address, and where the opening
   and the ending are. The streams themselves are the extractors'
   business: each embed is a source of its dub.
   ═══════════════════════════════════════════════════════════ */

import { seasonFromText } from '../discover/series.mjs';

const HOSTS = /(^|\.)(yummyani\.me|yummy-anime\.ru|yani\.tv)$/i;
const ITEM = /\/catalog\/item\/([^/?#]+)/;

async function json(session, url, referer) {
  const res = await session.fetch(url, { referer, headers: { accept: 'application/json' } });
  if (res.status >= 400) throw new Error(`${url} answered ${res.status}`);
  const data = JSON.parse(res.body);
  return data.response !== undefined ? data.response : data;
}

const abs = (u, base) => { try { return u ? new URL(u, base).toString() : null; } catch { return null; } };

/* "Озвучка AniDUB" is the AniDUB dub, "Субтитры Crunchyroll" the Crunchyroll subtitles */
export function dubOf(label) {
  const s = String(label || '').trim();
  const m = /^(Озвучка|Субтитры|Dub|Subtitles?)\s+(.+)$/i.exec(s);
  if (!m) return { name: s || 'Основной', kind: 'dub' };
  const kind = /^(Субтитры|Sub)/i.test(m[1]) ? 'sub' : 'dub';
  return { name: kind === 'sub' && !/субтитры|sub/i.test(m[2]) ? `${m[2]} (субтитры)` : m[2], kind };
}

/* ТВ, OVA, п/ф (a film), spin-off: what the site calls a kind */
export function kindOf(type) {
  const a = String(type?.alias || type?.shortname || type?.name || '').toLowerCase();
  if (/ova|ona/.test(a)) return 'ova';
  if (/movie|фильм|п\/ф/.test(a)) return 'movie';
  if (/special|спешл/.test(a)) return 'special';
  if (/tv|тв|сериал/.test(a)) return 'tv';
  return a || null;
}

/* the player behind an embed, by its host */
export function playerOf(iframeUrl) {
  const u = abs(iframeUrl, 'https://old.yummyani.me/');
  if (!u) return 'unknown';
  const host = new URL(u).hostname;
  if (/kodik/i.test(host)) return 'kodik';
  if (/alloha/i.test(host)) return 'alloha';
  if (/iframeCVH/i.test(u)) return 'cvh';
  return host.replace(/^www\./, '');
}

export default {
  name: 'yummyani',
  match: url => { try { return HOSTS.test(new URL(url).hostname); } catch { return false; } },

  async look(url, session) {
    const slug = ITEM.exec(url)?.[1];
    if (!slug) return null;
    const site = new URL(url).origin;
    const anime = await json(session, `${site}/api/anime/${encodeURIComponent(slug)}`, url);
    if (!anime || !anime.anime_id) return null;
    const videos = await json(session, `${site}/api/anime/${anime.anime_id}/videos`, url);

    const episodes = new Map();
    for (const v of videos || []) {
      const number = Number(v.number);
      if (!Number.isFinite(number) || !v.iframe_url) continue;
      if (!episodes.has(number)) episodes.set(number, { number, sourceUrl: url, dubs: [] });
      const ep = episodes.get(number);
      if (v.duration && !ep.duration) ep.duration = v.duration;
      if (v.skips && !ep.marks) {
        const span = m => m && m.time != null && m.length ? { start: m.time, stop: m.time + m.length } : null;
        const opening = span(v.skips.opening), ending = span(v.skips.ending);
        if (opening || ending) ep.marks = { opening, ending };
      }
      const { name, kind } = dubOf(v.data?.dubbing);
      let dub = ep.dubs.find(d => d.name === name);
      if (!dub) { dub = { name, kind, sources: [] }; ep.dubs.push(dub); }
      dub.sources.push({ player: playerOf(v.iframe_url), embedUrl: abs(v.iframe_url, site) });
    }

    const seriesUrl = `${site}/catalog/item/${anime.anime_url || slug}`;
    /* the viewing order: seasons, films, OVAs and spin-offs, this one among them */
    const spin = text => /spin|ответвлен/i.test(String(text || ''));
    const franchise = (anime.viewing_order || []).map((v, i) => ({
      order: (v.data?.index ?? i) + 1,
      title: v.title || '', url: `${site}/catalog/item/${v.anime_url}`,
      kind: spin(v.data?.text) ? 'spinoff' : kindOf(v.type), year: v.year || null, relation: v.data?.text || null,
      self: v.anime_id === anime.anime_id,
    }));
    /* the site's "season" is the season of the year it aired; the number of the season is in the title */
    const own = franchise.find(f => f.self);
    const kind = own?.kind || kindOf(anime.type);
    const season = kind === 'tv' ? (seasonFromText(anime.title) ?? 1) : undefined;
    return {
      origin: 'site:yummyani',
      seriesUrl, start: null,
      series: {
        title: anime.title || undefined,
        season,
        kind,
        franchise: franchise.length > 1 ? franchise : undefined,
        altTitles: (anime.other_titles || []).map(t => (typeof t === 'string' ? t : t?.title)).filter(Boolean),
        cover: abs(anime.poster?.fullsize || anime.poster?.big, site) || undefined,
        year: anime.year || undefined,
      },
      episodes: [...episodes.values()].sort((a, b) => a.number - b.number),
    };
  },
};
