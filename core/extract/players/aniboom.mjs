/* ═══════════════════════════════════════════════════════════
   AniBoom: the player of animego, met as an embed at aniboom.one.

   The embed page carries everything in one attribute,
   data-parameters: a JSON with the HLS and DASH addresses (each a
   JSON string of its own), the poster, the duration. Nothing is
   asked of a script. The HLS master names its audio as a group of
   its own, which the playlist proxy carries through.
   ═══════════════════════════════════════════════════════════ */

const HOSTS = /(^|\.)aniboom\.[a-z]+$/i;
const unescape = s => String(s || '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* what the embed page says about the video */
export function readEmbed(page) {
  const m = /data-parameters="([^"]+)"/.exec(String(page || ''));
  if (!m) return null;
  let p; try { p = JSON.parse(unescape(m[1])); } catch { return null; }
  const inner = k => { if (!p[k]) return null; try { return typeof p[k] === 'string' ? JSON.parse(p[k]) : p[k]; } catch { return null; } };
  /* p.error is the address of the page shown on an error, not an error */
  return { id: p.id || null, errorPage: p.error || null, duration: Number(p.duration) || null, hls: inner('hls'), dash: inner('dash'), fallbackHls: inner('fallbackHls') };
}

export default {
  name: 'aniboom',
  match: url => { try { return HOSTS.test(new URL(url).hostname); } catch { return false; } },

  async extract(embedUrl, { referer = null } = {}, session) {
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw new Error(`embed answered ${res.status}`);
    const e = readEmbed(res.body);
    if (!e) throw new Error('no player on the embed page');
    const origin = new URL(res.url || embedUrl).origin;
    const headers = { referer: origin + '/', origin };
    const streams = [];
    const hls = e.hls?.src || e.fallbackHls?.src;
    if (hls) streams.push({ kind: 'hls', url: hls, quality: null, headers });
    if (!streams.length) throw new Error('player answered without links');
    return { streams, dubs: [], duration: e.duration };
  },
};
