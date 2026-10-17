/* ═══════════════════════════════════════════════════════════
   Zedfilm: a wrapper page met on a catalog site, at zedfilm.ru/<id>.

   The page holds one line of script, video_Init('<base64>'), and the
   base64 is a plain JSON naming everything: a DASH manifest, the same
   video as one progressive mp4 (several audio tracks inside it, the
   dubs the player switches between), the subtitle tracks, the poster.
   Nothing is signed, nothing is asked of a script.

   The mp4 is what is played: a browser plays its first audio track
   and does not switch. Seam: the DASH manifest names each audio track
   as a set of its own, and a DASH player in the page would give the
   dubs the mp4 holds; the stream kind for it does not exist yet.
   ═══════════════════════════════════════════════════════════ */
import { refuse } from '../../reasons.mjs';

const HOSTS = /(^|\.)zedfilm\.[a-z]+$/i;

/* what the wrapper page says about the video */
export function readEmbed(page) {
  const m = /video_Init\(\s*'([A-Za-z0-9+/=]+)'/.exec(String(page || ''));
  if (!m) return null;
  let j; try { j = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const abs = u => { if (!u) return null; try { return new URL(String(u).startsWith('//') ? 'https:' + u : u).toString(); } catch { return null; } };
  return {
    id: j.v_id ?? null, duration: Number(j.duration) || null,
    dash: abs(j.url), mp4: abs(j.url2), poster: abs(j.image),
    audio: j.audio_info && typeof j.audio_info === 'object' ? Object.values(j.audio_info).map(String) : [],
    tracks: Array.isArray(j.tracks) ? j.tracks.map(t => ({ url: abs(t.src), label: String(t.label || '').trim(), default: !!t.default })).filter(t => t.url) : [],
  };
}

export default {
  name: 'zedfilm',
  match: url => { try { return HOSTS.test(new URL(url).hostname); } catch { return false; } },

  async extract(embedUrl, { referer = null } = {}, session) {
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw refuse('embedStatus', { status: res.status });
    const e = readEmbed(res.body);
    if (!e) throw refuse('emptyEmbed');
    if (!e.mp4) throw refuse('noLinks');
    const origin = new URL(res.url || embedUrl).origin;
    const headers = { referer: origin + '/' };
    return {
      streams: [{ kind: 'mp4', url: e.mp4, quality: null, headers }],
      dubs: [],
      subs: e.tracks.map(t => ({ url: t.url, label: t.label, lang: null, format: /\.srt(\?|$)/i.test(t.url) ? 'srt' : 'vtt', headers, default: t.default })),
    };
  },
};
