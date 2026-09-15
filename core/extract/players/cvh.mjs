/* ═══════════════════════════════════════════════════════════
   CVH: the cdnvideohub player, as a site embeds it.

   The embed is a small page of the site's own that drops a
   <video-player> element in, with the title's id, the publisher, the
   aggregator, the episode and the wanted voice as attributes. The
   player asks its API for the playlist of the title (every episode
   of every voice, each with a video id) and then for the video: an
   HLS address and mp4 ones by quality, signed for the hour and for
   the address that asked, which is this machine.

   The publisher and the aggregator are read from the embed's script
   when it can be read; the last known values stand in otherwise.
   ═══════════════════════════════════════════════════════════ */

const API = 'https://plapi.cdnvideohub.com/api/v1';
const FALLBACK = { publisher: 745, aggregator: 'mali' };
const TTL_MS = 60 * 60 * 1000;
/* the mp4 names the API uses, and what they are */
const MP4 = { mpegTinyUrl: '144p', mpegLowestUrl: '240p', mpegLowUrl: '360p', mpegMediumUrl: '480p', mpegHighUrl: '720p', mpegFullHdUrl: '1080p', mpegQhdUrl: '1440p', mpeg2kUrl: '2048p', mpeg4kUrl: '2160p' };

const scripts = new Map();

/* what the embed page asks the player for */
export function readEmbed(url) {
  const u = new URL(url);
  const q = u.searchParams;
  return {
    titleId: q.get('anime_id') || q.get('title_id') || q.get('id'),
    episode: q.get('episode') ? Number(q.get('episode')) : null,
    season: q.get('season') ? Number(q.get('season')) : null,
    voice: q.get('dubbing_code') || q.get('voice') || null,
  };
}

/* the publisher and the aggregator, out of the embed's script */
export function readModule(js) {
  const pub = /"data-publisher-id"\s*:\s*(\d+)/.exec(js);
  const aggr = /"data-aggregator"\s*:\s*"([^"]+)"/.exec(js);
  return { publisher: pub ? Number(pub[1]) : FALLBACK.publisher, aggregator: aggr ? aggr[1] : FALLBACK.aggregator };
}

async function json(session, url, referer) {
  const res = await session.fetch(url, { referer, headers: { accept: 'application/json' } });
  if (res.status >= 400) throw new Error(`player answered ${res.status}`);
  if (res.status === 204 || !res.body) return null;
  return JSON.parse(res.body);
}

export default {
  name: 'cvh',
  match: url => { try { const u = new URL(url); return /cdnvideohub\.com$/i.test(u.hostname) || /iframeCVH\.html/i.test(u.pathname); } catch { return false; } },

  async extract(embedUrl, { referer = null } = {}, session) {
    const want = readEmbed(embedUrl);
    if (!want.titleId) throw new Error('no title on the embed');
    const base = new URL(embedUrl);

    /* the publisher and the aggregator from the embed's own script, once per site */
    let ids = FALLBACK;
    try {
      const page = await session.fetch(embedUrl, { referer });
      const src = /<script[^>]+src="([^"]*players-cvh[^"]*\.js)"/i.exec(page.body)?.[1];
      if (src) {
        const key = new URL(src, base).toString();
        if (!scripts.has(key)) { const js = await session.fetch(key, { referer: embedUrl }); if (js.status < 400) scripts.set(key, readModule(js.body)); }
        ids = scripts.get(key) || FALLBACK;
      }
    } catch { /* the fallback stands in */ }

    const q = new URLSearchParams({ pub: String(ids.publisher), id: String(want.titleId), aggr: ids.aggregator });
    const list = await json(session, `${API}/player/sv/playlist?${q}`, base.origin + '/');
    const items = (list && list.items) || [];
    if (!items.length) throw new Error('player answered without videos');

    /* the wanted episode and voice; failing the voice, the episode alone */
    const sameEp = items.filter(i => want.episode === null || Number(i.episode) === want.episode).filter(i => want.season === null || i.season == null || Number(i.season) === want.season);
    const same = v => String(v || '').replace(/[^a-zа-я0-9]/gi, '').toLowerCase();
    const item = sameEp.find(i => want.voice && same(i.voiceStudio) === same(want.voice)) || sameEp[0];
    if (!item || !item.vkId) throw new Error('no such episode in the player');

    const video = await json(session, `${API}/player/sv/video/${encodeURIComponent(item.vkId)}`, base.origin + '/');
    const s = (video && video.sources) || {};
    const expiresAt = Date.now() + TTL_MS;
    const headers = { referer: 'https://player.cdnvideohub.com/' };
    const streams = [];
    if (s.hlsUrl) streams.push({ kind: 'hls', url: s.hlsUrl, quality: null, headers, expiresAt });
    for (const [k, quality] of Object.entries(MP4)) if (s[k]) streams.push({ kind: 'mp4', url: s[k], quality, headers, expiresAt });
    if (!streams.length) throw new Error('player answered without links');
    return { streams, dubs: [], duration: video.duration || null };
  },
};
