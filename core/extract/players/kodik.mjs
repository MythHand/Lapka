/* ═══════════════════════════════════════════════════════════
   Kodik: the player behind half of the Russian anime sites.

   The embed page carries what identifies the video (vInfo.type,
   vInfo.hash, vInfo.id) and a set of signed parameters (the site,
   the player host, the referer, each with a signature). The player's
   own script posts those to an endpoint and gets the stream links
   back, each quality's address encoded: letters shifted by a fixed
   amount, then base64. Both the endpoint and the shift live in that
   script and have changed before, so they are read from it on every
   extraction rather than written here; only if the script cannot be
   read do the last known values stand in.

   The links are signed for a few hours: the streams carry an expiry
   and are asked for again when it passes.
   ═══════════════════════════════════════════════════════════ */

const HOSTS = /(^|\.)(kodik\.(info|cc|biz)|kodikplayer\.com|aniqit\.com|anivod\.com)$/i;
const FALLBACK = { endpoint: '/ftor', shift: 18 };
const TTL_MS = 3 * 60 * 60 * 1000;
const UNNAMED = 'Основной';

/* one look at the player script per host and version */
const scripts = new Map();

const pageVar = (page, name) => new RegExp('var\\s+' + name + '\\s*=\\s*"([^"]*)"').exec(page)?.[1] ?? null;

export function decodeLink(src, shift) {
  if (src.includes('//')) return src;
  const rot = src.replace(/[a-zA-Z]/g, c => {
    const top = c <= 'Z' ? 90 : 122;
    let n = c.charCodeAt(0) + shift;
    if (n > top) n -= 26;
    return String.fromCharCode(n);
  });
  return Buffer.from(rot, 'base64').toString('utf8');
}

/* the endpoint and the shift, out of the player's script */
export function readScript(js) {
  const ep = /type:"POST",url:atob\("([A-Za-z0-9+/=]+)"\)/.exec(js);
  const sh = /charCodeAt\(0\)\+(\d+)\)/.exec(js);
  return {
    endpoint: ep ? Buffer.from(ep[1], 'base64').toString('utf8') : FALLBACK.endpoint,
    shift: sh ? Number(sh[1]) : FALLBACK.shift,
  };
}

/* A serial embed lists what the player holds: every translation with
   the media id and hash of its own serial and its episode count, the
   seasons of the translation shown, the episodes of its season. */
export function readSerial(page) {
  const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? '']));
  const box = name => {
    const i = page.indexOf(`class="${name}`); if (i < 0) return [];
    const j = page.indexOf('</select>', i);
    return [...page.slice(i, j < 0 ? undefined : j).matchAll(/<option\b[^>]*>/g)].map(m => attrs(m[0]));
  };
  /* "MedusaSub.Subtitles" is the MedusaSub subtitles: named the way the catalog names them */
  const named = (title, kind) => { const base = String(title || '').replace(/[.\s]*subtitles$/i, '').trim(); return kind === 'sub' && base ? `${base} (субтитры)` : base; };
  const translations = box('serial-translations-box').filter(o => o['data-media-id'] && o['data-media-hash']).map(o => {
    const kind = /sub/i.test(o['data-translation-type'] || '') ? 'sub' : 'dub';
    return {
    id: o['data-id'] || o.value, title: named(o['data-title'], kind),
    kind,
    mediaType: o['data-media-type'] || 'serial', mediaId: o['data-media-id'], mediaHash: o['data-media-hash'],
    count: Number(o['data-episode-count']) || 0,
  }; });
  const seasons = box('serial-seasons-box').map(o => ({ number: Number(o.value), selected: 'selected' in o })).filter(s => Number.isFinite(s.number));
  const episodes = box('serial-series-box').map(o => ({ number: Number(o.value), id: o['data-id'], hash: o['data-hash'], title: o['data-title'] || '', selected: 'selected' in o })).filter(e => Number.isFinite(e.number));
  const current = { id: /var\s+translationId\s*=\s*"?(\d+)/.exec(page)?.[1] || null, title: /var\s+translationTitle\s*=\s*"([^"]*)"/.exec(page)?.[1] || '' };
  return { translations, seasons, episodes, current };
}

/* what the embed page says about the video and the site it serves */
export function readEmbed(page) {
  const vi = {};
  for (const m of page.matchAll(/vInfo\.(\w+)\s*=\s*['"]([^'"]*)['"]/g)) vi[m[1]] = m[2];
  return {
    type: vi.type || pageVar(page, 'type'),
    hash: vi.hash, id: vi.id,
    signed: {
      d: pageVar(page, 'domain'), d_sign: pageVar(page, 'd_sign'),
      pd: pageVar(page, 'pd'), pd_sign: pageVar(page, 'pd_sign'),
      ref: pageVar(page, 'ref'), ref_sign: pageVar(page, 'ref_sign'),
    },
    script: /src="([^"]*app\.player_single\.[a-f0-9]+\.js)"/.exec(page)?.[1] || null,
  };
}

export default {
  name: 'kodik',
  match: url => { try { return HOSTS.test(new URL(url).hostname); } catch { return false; } },

  /* A serial embed holds the whole series: every translation, every
     episode. Unfolded, it is a contribution of episodes and dubs, each
     source the same serial embed opened at that episode
     (…/serial/<id>/<hash>/720p?episode=N), asked for its streams only
     when it is played. The other translations' episodes are counted,
     not listed: the embed lists only the episodes of the translation
     it shows. A single-video embed unfolds to nothing.
     Seam: an embed with several seasons is read as the season it
     shows; the other seasons of a Kodik serial are not followed. */
  async unfold(embedUrl, { referer = null } = {}, session) {
    let u; try { u = new URL(embedUrl); } catch { return null; }
    if (!/^\/(serial|season)\//.test(u.pathname) || /only_episode=true/.test(u.search)) return null;
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw new Error(`embed answered ${res.status}`);
    const ser = readSerial(res.body);
    const origin = new URL(res.url || embedUrl).origin;
    const season = ser.seasons.length > 1 ? ser.seasons.find(s => s.selected)?.number ?? null : null;
    const at = (t, n) => `${origin}/${t.mediaType}/${t.mediaId}/${t.mediaHash}/720p?${season !== null ? `season=${season}&` : ''}episode=${n}`;
    /* the translation shown, when the embed names no others */
    const own = /^\/(serial|season)\/(\d+)\/([a-f0-9]+)\//.exec(u.pathname);
    const translations = ser.translations.length ? ser.translations
      : own && ser.episodes.length ? [{ id: ser.current.id, title: ser.current.title, kind: 'dub', mediaType: own[1], mediaId: own[2], mediaHash: own[3], count: ser.episodes.length }] : [];
    const numbers = t => (t.id === ser.current.id && ser.episodes.length ? ser.episodes.map(e => e.number) : Array.from({ length: t.count }, (_, i) => i + 1));
    const episodes = new Map();
    for (const t of translations) for (const n of numbers(t)) {
      if (!episodes.has(n)) episodes.set(n, { number: n, dubs: [] });
      episodes.get(n).dubs.push({ name: t.title || UNNAMED, kind: t.kind, sources: [{ embedUrl: at(t, n) }] });
    }
    if (episodes.size < 2 && translations.length < 2) return null;
    return { episodes: [...episodes.values()].sort((a, b) => a.number - b.number) };
  },

  async extract(embedUrl, { referer = null } = {}, session) {
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw new Error(`embed answered ${res.status}`);
    const base = new URL(res.url || embedUrl);
    const embed = readEmbed(res.body);
    if (!embed.hash || !embed.id) throw new Error('no video on the embed page');
    const cookie = (res.cookies || []).map(c => c.split(';')[0]).join('; ');

    let how = FALLBACK;
    if (embed.script) {
      const key = base.origin + embed.script;
      if (!scripts.has(key)) {
        try { const js = await session.fetch(new URL(embed.script, base).toString()); if (js.status < 400) scripts.set(key, readScript(js.body)); }
        catch { /* the fallback stands in */ }
      }
      how = scripts.get(key) || FALLBACK;
    }

    const form = new URLSearchParams({
      ...Object.fromEntries(Object.entries(embed.signed).filter(([, v]) => v !== null)),
      bad_user: 'false', cdn_is_working: 'true',
      type: embed.type, hash: embed.hash, id: embed.id, info: '{}',
    });
    const answer = await session.fetch(base.origin + how.endpoint, {
      method: 'POST', body: form.toString(), referer: base.toString(),
      headers: { origin: base.origin, 'x-requested-with': 'XMLHttpRequest', accept: 'application/json, text/javascript, */*; q=0.01', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(cookie ? { cookie } : {}) },
    });
    if (answer.status >= 400) throw new Error(`player answered ${answer.status}`);
    let data; try { data = JSON.parse(answer.body); } catch { throw new Error('player answered without links'); }

    const expiresAt = Date.now() + TTL_MS;
    const streams = [];
    for (const [q, list] of Object.entries(data.links || {})) {
      for (const l of list || []) {
        const raw = decodeLink(String(l.src || ''), how.shift);
        const url = raw.startsWith('//') ? 'https:' + raw : raw;
        if (!/^https?:\/\//.test(url)) continue;
        streams.push({ kind: /m3u8/i.test(url) || /mpegurl/i.test(l.type || '') ? 'hls' : 'mp4', url, quality: /^\d+$/.test(q) ? `${q}p` : null, headers: { referer: base.origin + '/' }, expiresAt });
      }
    }
    if (!streams.length) throw new Error('player answered without links');
    return { streams, dubs: [] };
  },
};
