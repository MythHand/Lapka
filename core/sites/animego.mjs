/* ═══════════════════════════════════════════════════════════
   AnimeGO, at animego.me: the page itself carries no player. A
   script asks /player/<id> for a fragment (JSON around HTML) that
   lists the episodes, and /player/videos/<episode id> for another
   with the players of one episode: buttons that name the dub and the
   player in attributes and carry the embed (Kodik, AniBoom, the
   site's own CVH wrapper). Both answer only to a script's request.

   The adapter knows two things: where the fragments are, and how to
   ask for them. What the fragments say is read the general way: the
   episode's fragment is its page, its buttons are its switches.
   ═══════════════════════════════════════════════════════════ */

const HOSTS = /(^|\.)animego\.[a-z]+$/i;
const ANIME = /^\/anime\/[^/?#]*?-(\d+)\/?$/;
const FRAGMENT = /^\/player\/(?:\d+(?:\/episodes)?|videos\/\d+)$/;
const XHR = { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json, text/javascript, */*; q=0.01' };

const unescape = s => String(s || '').replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');

/* the HTML inside the site's JSON answer; null when the answer is not that */
export function unwrap(body) {
  let d; try { d = JSON.parse(String(body || '')); } catch { return null; }
  const inner = d && typeof d === 'object' ? (d.data && typeof d.data === 'object' ? d.data : d) : null;
  if (!inner) return null;
  const html = inner.content ?? inner.html ?? null;
  return typeof html === 'string' ? html : '';
}

/* the episodes a fragment lists, and the pages there are of them */
export function readEpisodes(html) {
  const episodes = [];
  for (const m of String(html || '').matchAll(/<[^>]*data-episode-number="(\d+(?:\.\d+)?)"[^>]*data-episode="(\d+)"[^>]*>/g)) episodes.push({ number: Number(m[1]), id: m[2] });
  let pages = 1;
  const p = /data-anime-player-episodes-pages-value="([^"]*)"/.exec(String(html || ''));
  if (p) { try { pages = Math.max(1, JSON.parse(unescape(p[1])).length); } catch { /* one page */ } }
  return { episodes, pages };
}

async function fragment(session, url, referer) {
  const res = await session.fetch(url, { referer, headers: XHR });
  if (res.status >= 400) throw new Error(`${url} answered ${res.status}`);
  const html = unwrap(res.body);
  if (html === null) throw new Error(`${url} answered with no fragment`);
  return html;
}

export default {
  name: 'animego',
  match: url => { try { return HOSTS.test(new URL(url).hostname); } catch { return false; } },

  /* a fragment is asked for the way the site's script asks, and unwrapped; any other page is fetched plainly */
  async fetch(url, { referer = null } = {}, session) {
    const u = new URL(url);
    if (!FRAGMENT.test(u.pathname)) return session.fetch(url, { referer });
    const res = await session.fetch(url, { referer, headers: XHR });
    if (res.status >= 400) return res;
    return { ...res, body: unwrap(res.body) ?? res.body };
  },

  async look(url, session) {
    const u = new URL(url);
    const m = ANIME.exec(u.pathname);
    if (!m) return null;
    const site = u.origin, id = m[1];
    const seriesUrl = site + u.pathname.replace(/\/+$/, '');
    const first = readEpisodes(await fragment(session, `${site}/player/${id}?_allow=true`, seriesUrl));
    const episodes = [...first.episodes];
    for (let page = 1; page < first.pages; page++) episodes.push(...readEpisodes(await fragment(session, `${site}/player/${id}/episodes?page=${page}&_allow=true`, seriesUrl)).episodes);
    if (!episodes.length) return null;
    const seen = new Set();
    return {
      origin: 'site:animego',
      seriesUrl, start: null,
      series: {},
      /* each episode's page is its fragment; what it holds is read when it is opened */
      episodes: episodes.filter(e => !seen.has(e.number) && seen.add(e.number)).sort((a, b) => a.number - b.number)
        .map(e => ({ number: e.number, sourceUrl: `${site}/player/videos/${e.id}` })),
    };
  },
};
