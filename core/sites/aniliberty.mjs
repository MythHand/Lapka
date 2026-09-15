/* ═══════════════════════════════════════════════════════════
   AniLibria, at aniliberty.top: their own site, their own API.

   The page already carries the episodes and the streams, and the
   general reading finds them. What it cannot know the API says
   plainly: the studio (it is AniLibria's own dub), every episode's
   name and length, the three qualities of each, and from a link to
   one episode the release it belongs to.

   A release link may end in the tab that was open: /episodes,
   /franchises, /members, /torrents, /comments. They are one page.
   ═══════════════════════════════════════════════════════════ */

import { seasonFromText as seasonOf } from '../discover/series.mjs';

const HOSTS = /(^|\.)(aniliberty\.top|anilibria\.top|anilibria\.tv)$/i;
const RELEASE = /\/anime\/releases\/release\/([^/?#]+)/;
const EPISODE = /\/anime\/video\/episode\/([0-9a-f-]{36})/i;
const QUALITIES = [480, 720, 1080];
const STUDIO = 'AniLibria';

const kindOf = type => { const v = String(type?.value || '').toLowerCase(); return /ova|ona/.test(v) ? 'ova' : /movie|film/.test(v) ? 'movie' : /special/.test(v) ? 'special' : v === 'tv' ? 'tv' : v || null; };

const originOf = url => new URL(url).origin;

/* where the opening and the ending are, when the release says */
function marksOf(e) {
  const span = m => m && m.start != null && m.stop != null && m.stop > m.start ? { start: m.start, stop: m.stop } : null;
  const opening = span(e.opening), ending = span(e.ending);
  return opening || ending ? { opening, ending } : undefined;
}

async function json(session, url) {
  const res = await session.fetch(url, { headers: { accept: 'application/json' } });
  if (res.status >= 400) throw new Error(`${url} answered ${res.status}`);
  return JSON.parse(res.body);
}

export default {
  name: 'aniliberty',
  match: url => { try { return HOSTS.test(new URL(url).hostname); } catch { return false; } },

  async look(url, session) {
    const site = originOf(url);
    const api = p => `${site}/api/v1/${p}`;
    let alias = RELEASE.exec(url)?.[1] || null;
    let start = null;

    const uuid = EPISODE.exec(url)?.[1];
    if (uuid) {
      const ep = await json(session, api(`anime/releases/episodes/${uuid}`));
      alias = ep.release?.alias || alias;
      start = ep.ordinal ?? null;
    }
    if (!alias) return null;

    const rel = await json(session, api(`anime/releases/${encodeURIComponent(alias)}`));
    const seriesUrl = `${site}/anime/releases/release/${rel.alias || alias}/episodes`;

    /* the franchise this release is part of, in viewing order; only the releases the site has */
    let franchise = [];
    if (rel.id) {
      try {
        const fr = await json(session, api(`anime/franchises/release/${rel.id}`));
        const one = Array.isArray(fr) ? fr[0] : fr;
        franchise = (one?.franchise_releases || []).map((x, i) => ({
          order: x.sort_order ?? i + 1,
          title: x.release?.name?.main || '', url: `${site}/anime/releases/release/${x.release?.alias}/episodes`,
          kind: kindOf(x.release?.type), year: x.release?.year || null, relation: null,
          self: x.release?.id === rel.id,
        })).filter(f => f.url.includes('/release/undefined/') === false);
      } catch { /* a release outside any franchise */ }
    }
    const season = seasonOf(rel.name?.main) ?? (kindOf(rel.type) === 'tv' ? 1 : null);
    const abs = p => p ? (p.startsWith('http') ? p : `${site}${p}`) : null;
    const poster = rel.poster && (rel.poster.optimized?.src || rel.poster.src);

    return {
      origin: 'site:aniliberty',
      seriesUrl, start,
      series: {
        title: rel.name?.main || undefined,
        season: season ?? undefined,
        kind: kindOf(rel.type) || undefined,
        franchise: franchise.length > 1 ? franchise : undefined,
        altTitles: [rel.name?.english, ...String(rel.name?.alternative || '').split(',')].map(s => s && s.trim()).filter(Boolean),
        cover: abs(poster) || undefined,
        year: rel.year || undefined,
      },
      episodes: (rel.episodes || []).map(e => ({
        number: e.ordinal,
        title: e.name || undefined,
        sourceUrl: `${site}/anime/video/episode/${e.id}`,
        duration: e.duration || undefined,
        marks: marksOf(e),
        dubs: [{
          name: STUDIO, lang: 'ru',
          sources: [{
            player: 'aniliberty', embedUrl: `${site}/anime/video/episode/${e.id}`, extractor: 'site:aniliberty',
            streams: QUALITIES.filter(q => e[`hls_${q}`]).map(q => ({ kind: 'hls', url: e[`hls_${q}`], quality: `${q}p`, headers: { referer: `${site}/` } })),
          }],
        }],
      })).filter(e => Number.isFinite(e.number)),
    };
  },
};
