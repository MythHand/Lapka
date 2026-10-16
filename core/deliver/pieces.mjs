/* ═══════════════════════════════════════════════════════════
   The pieces of an HLS stream: what a playlist names, in order.

   Saving and warming the cache both walk a stream piece by piece;
   both read the playlist the same way, so the reading lives here.
   A master playlist is followed to one variant, the one of the
   height asked for; its sound, when it is a rendition of its own,
   is listed too.
   ═══════════════════════════════════════════════════════════ */
import { originReason } from '../reasons.mjs';

/* The variant of a master playlist to take: the one of the height asked
   for (the nearest, the taller on a tie, when that exact height is not
   there), else the widest. */
export function pickVariant(lines, base, level = null) {
  const vars = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const next = lines.slice(i + 1).find(l => l.trim() && !l.startsWith('#'));
    if (!next) continue;
    vars.push({ url: new URL(next.trim(), base).toString(), bw: Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0),
      height: Number(/RESOLUTION=\d+x(\d+)/.exec(lines[i])?.[1] || 0), group: /AUDIO="([^"]+)"/.exec(lines[i])?.[1] || null });
  }
  if (!vars.length) return null;
  const want = Number(level) || 0;
  if (want && vars.some(v => v.height)) return vars.filter(v => v.height).sort((a, b) => Math.abs(a.height - want) - Math.abs(b.height - want) || b.height - a.height)[0];
  return vars.sort((a, b) => b.bw - a.bw)[0];
}

/* Segment addresses of a media playlist, absolute, in order, plus the
   same playlist rewritten to the names the cache uses; a master
   playlist is followed to the variant picked first. */
export async function segmentsOf(delivery, entry, url, depth = 0, level = null) {
  const res = await delivery.fetchOrigin(entry, url);
  if (!res.ok) throw Object.assign(new Error(`origin answered ${res.status} for the playlist`), { reason: originReason(res.status) });
  const text = await res.text();
  const base = res.url || url;
  await delivery.keep(entry, text, base);   // held against the playlist kept: another cut of the stream drops what is on the disk of it
  delivery.learn(entry, text, base);        // every piece named by its place, every variant tagged, as the player's path names them
  const lines = text.split(/\r?\n/);
  if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
    if (depth > 2) throw Object.assign(new Error('playlist points at playlists all the way down'), { reason: { key: 'playlist' } });
    const pick = pickVariant(lines, base, level);
    if (!pick) throw Object.assign(new Error('master playlist without variants'), { reason: { key: 'playlist' } });
    const best = pick.url, group = pick.group;
    entry.allowed.add(best);
    const video = await segmentsOf(delivery, entry, best, depth + 1);
    /* the sound is a rendition of its own: the one this stream names,
       else the default, else the first of the variant's group */
    if (group) {
      const media = lines.filter(l => l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l) && (new RegExp(`GROUP-ID="${group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)).test(l));
      const want = entry.stream.audio ? entry.stream.audio.index : media.findIndex(l => /DEFAULT=YES/.test(l));
      const line = media[want >= 0 && want < media.length ? want : 0];
      const uri = line && /URI="([^"]+)"/.exec(line)?.[1];
      if (uri) {
        const abs = new URL(uri, base).toString();
        entry.allowed.add(abs);
        video.audio = await segmentsOf(delivery, entry, abs, depth + 1);
        /* the file will say which sound it holds */
        video.audio.lang = /LANGUAGE="([^"]+)"/.exec(line)?.[1] || null;
        video.audio.name = (entry.stream.audio && entry.stream.audio.name) || /NAME="([^"]+)"/.exec(line)?.[1] || null;
      }
    }
    return video;
  }
  const segments = [], keys = [], out = [], durations = [];
  let next = 0;   // the EXTINF before a segment names its length
  for (const line of lines) {
    const inf = /^#EXTINF:\s*([\d.]+)/.exec(line); if (inf) next = Number(inf[1]) || 0;
    if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
      const u = /URI="([^"]+)"/.exec(line)?.[1];
      if (u) {
        const abs = new URL(u, base).toString();
        entry.allowed.add(abs); keys.push(abs);
        out.push(line.replace(/URI="[^"]+"/, `URI="${delivery.nameFor(entry, abs)}"`));
        continue;
      }
    }
    if (line.trim() && !line.startsWith('#')) {
      const abs = new URL(line.trim(), base).toString();
      entry.allowed.add(abs); segments.push(abs); durations.push(next); next = 0;
      out.push(delivery.nameFor(entry, abs));
      continue;
    }
    out.push(line);
  }
  return { segments, keys, durations, localPlaylist: out.join('\n') };
}

/* every piece of a stream, keys first, then the picture, then the sound */
export const piecesOf = ({ segments, keys, audio }) => [...keys, ...segments, ...(audio ? [...audio.keys, ...audio.segments] : [])];
/* the same pieces with the seconds of video each one holds (a key holds none) */
export const timedPiecesOf = ({ segments, keys, durations = [], audio }) => [
  ...keys.map(url => ({ url, seconds: 0 })),
  ...segments.map((url, i) => ({ url, seconds: durations[i] || 0 })),
  ...(audio ? [...audio.keys.map(url => ({ url, seconds: 0 })), ...audio.segments.map((url, i) => ({ url, seconds: (audio.durations || [])[i] || 0 }))] : []),
];
