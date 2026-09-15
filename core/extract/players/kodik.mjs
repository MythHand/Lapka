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
