/* ═══════════════════════════════════════════════════════════
   The synthetic anime site: one case per way a real site is built.

   Lapka is developed against these pages, not against anyone's site.
   Each case models one arrangement we have seen in the wild: how the
   episodes are listed, where the dub switch lives, how many players
   there are and how they are embedded. The rule for growth is one
   case per arrangement: a new case appears only when a real page is
   built in a way none of these cover.

   `players` are the embedded players the site uses. Each has a shape
   of its own, rendered by render.mjs:

     alpha   an embed page with a <video src> and the dub baked into
             the URL; one embed per dub
     beta    an embed page with the stream in a script and its own dub
             <select>; one embed per episode, all dubs inside
     inline  no embed at all: a <video> with an HLS <source> right on
             the episode page
   ═══════════════════════════════════════════════════════════ */

export const CASES = [
  {
    id: 'links',
    title: 'Сериал Ссылки',
    device: 'episodes as links to episode pages; dub tabs on the episode page; one iframe whose src follows the tab',
    episodes: 3,
    players: ['alpha'],
    dubs: { alpha: ['AniLibria', 'AniDub'] },
    layout: { episodes: 'links', dubs: 'page-tabs', player: 'iframe' },
  },
  {
    id: 'select',
    title: 'Сериал Селект',
    device: 'episodes in a <select>; two players behind a switcher; player 1 has its dub tabs on the page, player 2 keeps its dubs inside the embed; AniLibria is in both',
    episodes: 4,
    players: ['alpha', 'beta'],
    dubs: { alpha: ['AniLibria', 'Dream Cast'], beta: ['AniLibria', 'AniDub', 'JAM'] },
    layout: { episodes: 'select', dubs: 'per-player', player: 'iframe-switch' },
  },
  {
    id: 'seasons',
    title: 'Сериал Сезоны',
    device: 'a series in two seasons: the page of each season links to the other by name ("1 сезон", "2 сезон"); episodes as links; one player with dub tabs',
    episodes: 2,
    players: ['alpha'],
    dubs: { alpha: ['AniLibria'] },
    layout: { episodes: 'links', dubs: 'page-tabs', player: 'iframe', seasons: 2 },
  },
  {
    id: 'video',
    title: 'Сериал Видео',
    device: 'episodes as links; no dubs; a <video> tag with an HLS source on the episode page',
    episodes: 2,
    players: ['inline'],
    dubs: { inline: [] },
    layout: { episodes: 'links', dubs: 'none', player: 'video' },
  },
];

export const caseById = id => CASES.find(c => c.id === id) || null;

/* Dub names as they appear in URLs. */
export const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/* Where a player's embed for a given episode and dub lives. */
export function embedUrl(player, c, ep, dub) {
  if (player === 'alpha') return `/embed/alpha/${c.id}-${ep}-${slug(dub)}`;
  if (player === 'beta') return `/embed/beta/${c.id}-${ep}`;
  return null;
}
