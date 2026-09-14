/* ═══════════════════════════════════════════════════════════
   Saving: the stream as one file in the library.

   For HLS, every segment the playlist names is made sure to be in the
   cache (the ones already watched are there; the rest pass through
   now), then ffmpeg reads a local copy of the playlist that points at
   the cached files and writes one MP4 without touching the picture or
   the sound. No second download, no re-encoding. For MP4 the file is
   fetched once, whole.

   After the file is in place the stream's cache folder is dropped:
   the same bytes are now the file.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const run = (cmd, args) => new Promise((ok, bad) =>
  execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000 }, (e, out, err) => e ? bad(new Error(String(err || e.message).slice(-600))) : ok(out)));

export async function haveFfmpeg() { try { await run('ffmpeg', ['-version']); return true; } catch { return false; } }

/* Segment addresses of a media playlist, absolute, in order, plus the
   same playlist rewritten to the names the cache uses; a master
   playlist is followed to its best variant first. */
async function segmentsOf(delivery, entry, url, depth = 0) {
  const res = await delivery.fetchOrigin(entry, url);
  if (!res.ok) throw new Error(`origin answered ${res.status} for the playlist`);
  const text = await res.text();
  const base = res.url || url;
  const lines = text.split(/\r?\n/);
  if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
    if (depth > 2) throw new Error('playlist points at playlists all the way down');
    let best = null, bw = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const b = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0);
      const next = lines.slice(i + 1).find(l => l.trim() && !l.startsWith('#'));
      if (next && b > bw) { bw = b; best = new URL(next.trim(), base).toString(); }
    }
    if (!best) throw new Error('master playlist without variants');
    entry.allowed.add(best);
    return segmentsOf(delivery, entry, best, depth + 1);
  }
  const segments = [], keys = [], out = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
      const u = /URI="([^"]+)"/.exec(line)?.[1];
      if (u) {
        const abs = new URL(u, base).toString();
        entry.allowed.add(abs); keys.push(abs);
        out.push(line.replace(/URI="[^"]+"/, `URI="${delivery.nameFor(abs)}"`));
        continue;
      }
    }
    if (line.trim() && !line.startsWith('#')) {
      const abs = new URL(line.trim(), base).toString();
      entry.allowed.add(abs); segments.push(abs);
      out.push(delivery.nameFor(abs));
      continue;
    }
    out.push(line);
  }
  return { segments, keys, localPlaylist: out.join('\n') };
}

export function createSaver({ delivery, cache, library }) {
  const jobs = new Map();

  async function save(streamId, { series, episode, dub, source, stream, onProgress = () => {} }) {
    const entry = delivery.get(streamId);
    if (!entry) throw new Error('unknown stream');
    const place = library.placeFor(series, episode, dub, 'mp4');
    await fsp.mkdir(place.dir, { recursive: true });
    const part = place.file + '.part';

    if (stream.kind === 'mp4') {
      const res = await delivery.fetchOrigin(entry, stream.url);
      if (!res.ok) throw new Error(`origin answered ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      let done = 0;
      const counter = new Transform({ transform(chunk, _, cb) { done += chunk.length; onProgress({ phase: 'fetch', done, total }); cb(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part));
    } else {
      const { segments, keys, localPlaylist } = await segmentsOf(delivery, entry, stream.url);
      let done = 0;
      const total = keys.length + segments.length;
      for (const u of [...keys, ...segments]) {
        await delivery.piece(entry, u);
        onProgress({ phase: 'fetch', done: ++done, total });
      }
      const listFile = cache.fileFor(entry.id, 'local.m3u8');
      await fsp.writeFile(listFile, localPlaylist);
      onProgress({ phase: 'assemble', done, total });
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,crypto,data',
        '-i', listFile, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', '-f', 'mp4', part]);
    }

    await fsp.rename(part, place.file);
    const st = await fsp.stat(place.file);
    await library.keepSeries(series);
    await library.writeSidecar(place.sidecar, {
      file: path.basename(place.file), size: st.size, savedAt: Date.now(),
      seriesId: series.id, seriesTitle: series.title, sourceUrl: series.sourceUrl,
      episode: episode.number, episodeTitle: episode.title || '',
      dub: dub.name, dubKey: dub.key,
      player: source.player, extractor: source.extractor, embedUrl: source.embedUrl,
      streamKind: stream.kind, streamUrl: stream.url,
    });
    await cache.drop(entry.id);
    return { file: place.file, sidecar: place.sidecar, size: st.size };
  }

  /* a job the UI can poll */
  function start(streamId, ctx) {
    const id = `${streamId}-${Date.now().toString(36)}`;
    const job = { id, streamId, state: 'working', phase: 'fetch', done: 0, total: 0, file: null, error: null, started: Date.now() };
    jobs.set(id, job);
    save(streamId, { ...ctx, onProgress: p => Object.assign(job, p) })
      .then(r => Object.assign(job, { state: 'done', file: r.file, size: r.size }))
      .catch(e => Object.assign(job, { state: 'error', error: e.message }));
    return job;
  }

  return { save, start, job: id => jobs.get(id) || null, jobs };
}
