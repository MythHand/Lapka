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

const run = (cmd, args, { signal } = {}) => new Promise((ok, bad) =>
  execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000, signal }, (e, out, err) => e ? bad(e.name === 'AbortError' ? e : new Error(String(err || e.message).slice(-600))) : ok(out)));
const stopped = () => Object.assign(new Error('stopped'), { name: 'AbortError' });

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
    let best = null, bw = -1, group = null;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const b = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0);
      const next = lines.slice(i + 1).find(l => l.trim() && !l.startsWith('#'));
      if (next && b > bw) { bw = b; best = new URL(next.trim(), base).toString(); group = /AUDIO="([^"]+)"/.exec(lines[i])?.[1] || null; }
    }
    if (!best) throw new Error('master playlist without variants');
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

/* the stream for a wanted quality, out of every stream of a dub's live sources */
export function streamForQuality(streams, quality) {
  const rank = st => { const m = /(\d{3,4})/.exec(String(st.quality || '')); return m ? Number(m[1]) : st.kind === 'hls' ? 9999 : 0; };
  const sorted = [...streams].sort((a, b) => rank(b) - rank(a));
  if (quality && quality !== 'auto') { const same = sorted.find(st => st.quality === quality); if (same) return same; }
  return sorted[0] || null;
}

export function createSaver({ delivery, cache, library, state = null }) {
  const jobs = new Map();
  const keyOf = ctx => `${ctx.series.id}/${ctx.episode.number}/${ctx.dub.key}`;

  async function save(streamId, { series, episode, dub, source, stream, onProgress = () => {}, signal = null }) {
    const entry = delivery.get(streamId);
    if (!entry) throw new Error('unknown stream');
    const place = library.placeFor(series, episode, dub, 'mp4');
    await fsp.mkdir(place.dir, { recursive: true });
    const part = place.file + '.part';

    if (stream.kind === 'mp4') {
      /* a half file left by a pause or a cut is taken up from its end, when
         the origin serves ranges; otherwise it starts over. Progress is in bytes. */
      let have = 0;
      try { have = (await fsp.stat(part)).size; } catch { /* nothing yet */ }
      let res = have ? await delivery.fetchOrigin(entry, stream.url, { range: `bytes=${have}-` }) : null;
      if (res && res.status === 416) { have = 0; res = null; }              // the half file is not what the origin has now
      if (res && res.status !== 206) { have = 0; res.body && res.body.cancel && res.body.cancel().catch(() => {}); res = null; }
      if (!res) res = await delivery.fetchOrigin(entry, stream.url);
      if (!res.ok) throw new Error(`origin answered ${res.status}`);
      const total = have + (Number(res.headers.get('content-length')) || 0);
      let done = have;
      onProgress({ phase: 'fetch', done, total, unit: 'bytes' });
      const counter = new Transform({ transform(chunk, _, cb) { done += chunk.length; onProgress({ phase: 'fetch', done, total, unit: 'bytes' }); cb(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: have ? 'a' : 'w' }), signal ? { signal } : {});
    } else {
      const { segments, keys, localPlaylist, audio } = await segmentsOf(delivery, entry, stream.url);
      let done = 0;
      const pieces = [...keys, ...segments, ...(audio ? [...audio.keys, ...audio.segments] : [])];
      const total = pieces.length;
      /* progress is in pieces; the ones already in the cache come back at once, so a save taken up runs to where it was */
      onProgress({ phase: 'fetch', done, total, unit: 'pieces' });
      for (const u of pieces) {
        if (signal && signal.aborted) throw stopped();
        await delivery.piece(entry, u);
        onProgress({ phase: 'fetch', done: ++done, total, unit: 'pieces' });
      }
      const listFile = cache.fileFor(entry.id, 'local.m3u8');
      await fsp.writeFile(listFile, localPlaylist);
      const inputs = ['-i', listFile];
      const maps = audio ? ['-map', '0:v', '-map', '1:a'] : [];
      if (audio) {
        /* the sound comes as a playlist of its own: muxed with the picture, not re-encoded, and named in the file */
        const audioFile = cache.fileFor(entry.id, 'local-audio.m3u8');
        await fsp.writeFile(audioFile, audio.localPlaylist);
        inputs.push('-i', audioFile);
        if (audio.lang) maps.push('-metadata:s:a:0', `language=${audio.lang}`);
        if (audio.name) maps.push('-metadata:s:a:0', `title=${audio.name}`);
      }
      onProgress({ phase: 'assemble', done, total, unit: 'pieces' });
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,crypto,data',
        ...inputs, ...maps, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', '-f', 'mp4', part], { signal });
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

  /* A job the UI can poll. It is also written down by identity, with
     its progress, so that a save cut short is known and taken up
     again; done, the record goes. */
  function start(streamId, ctx) {
    const key = keyOf(ctx);
    const running = [...jobs.values()].find(j => j.key === key && j.state === 'working');
    if (running) return running;
    const id = `${streamId}-${Date.now().toString(36)}`;
    const job = { id, key, streamId, seriesId: ctx.series.id, episode: ctx.episode.number, dub: ctx.dub.key, quality: ctx.stream.quality || 'auto', state: 'working', phase: 'fetch', done: 0, total: 0, file: null, error: null, started: Date.now() };
    jobs.set(id, job);
    const ac = new AbortController();
    stops.set(id, ac);
    const note = (extra = {}) => state && state.setSave(key, { seriesUrl: ctx.series.sourceUrl, seriesId: ctx.series.id, episode: ctx.episode.number, dubKey: ctx.dub.key, quality: job.quality, phase: job.phase, done: job.done, total: job.total, unit: job.unit || null, error: job.error, paused: false, ...extra });
    note();
    save(streamId, { ...ctx, signal: ac.signal, onProgress: p => { Object.assign(job, p); if (job.done % 10 === 0 || p.phase === 'assemble') note(); } })
      .then(r => { Object.assign(job, { state: 'done', file: r.file, size: r.size }); if (state) state.clearSave(key); })
      .catch(async e => {
        if (job.state === 'paused' || e.name === 'AbortError') {
          /* paused by hand: the record keeps where it got to, marked so that it
             is not taken up by itself; the half file and the cached pieces stay,
             so taking it up continues from there */
          job.state = 'paused';
          note({ paused: true });
        } else { Object.assign(job, { state: 'error', error: e.message }); note(); }
      })
      .finally(() => stops.delete(id));
    return job;
  }

  /* a save paused by hand, while it fetches or while ffmpeg assembles */
  const stops = new Map();
  let held = false;      // the loading as a whole is on hold: the resume loop stops at the next record
  function pauseAll() {
    held = true;
    const out = [];
    for (const job of jobs.values()) if (job.state === 'working') out.push(pause(job.id));
    return out;
  }
  function pause(id) {
    const job = jobs.get(id);
    if (!job || job.state !== 'working') return job || null;
    job.state = 'paused';
    const ac = stops.get(id);
    if (ac) ac.abort();
    return job;
  }

  /* Every save that was asked for and is not done, taken up again:
     the series is looked at, the episode resolved, the stream of the
     wanted quality saved. One at a time; the segments already in the
     cache come from there. */
  let resuming = null;
  function resume(lapka) {
    if (!state || resuming) return resuming || Promise.resolve([]);
    held = false;
    resuming = (async () => {
      const out = [];
      for (const [key, rec] of Object.entries(state.saves())) {
        if (held) break;            // a pause came while the loop ran: the rest stays as it is
        if (rec.paused) continue;   // paused by hand: waits for the hand
        if ([...jobs.values()].some(j => j.key === key && j.state === 'working')) continue;
        try {
          const already = (await library.list()).some(s => s.episodes.some(e => e.seriesId === rec.seriesId && e.episode === rec.episode && e.dubKey === rec.dubKey));
          if (already) { state.clearSave(key); continue; }
          if (!lapka.series(rec.seriesId)) await lapka.look(rec.seriesUrl);
          const r = await lapka.resolve({ seriesId: rec.seriesId, number: rec.episode, dubKey: rec.dubKey });
          const st = streamForQuality(r.streams || [], rec.quality);
          const ctx = st && lapka.context(st.id);
          if (!ctx) { state.setSave(key, { error: 'no stream' }); continue; }
          const job = start(st.id, ctx);
          await new Promise(res => { const t = setInterval(() => { if (job.state !== 'working') { clearInterval(t); res(); } }, 500); });
          out.push({ key, state: job.state, error: job.error });
        } catch (e) { state.setSave(key, { error: e.message }); out.push({ key, state: 'error', error: e.message }); }
      }
      return out;
    })().finally(() => { resuming = null; });
    return resuming;
  }

  return { save, start, pause, pauseAll, resume, job: id => jobs.get(id) || null, jobs, keyOf };
}
