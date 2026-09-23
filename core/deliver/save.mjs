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

/* The variant of a master playlist to save: the one of the height asked
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
async function segmentsOf(delivery, entry, url, depth = 0, level = null) {
  const res = await delivery.fetchOrigin(entry, url);
  if (!res.ok) throw new Error(`origin answered ${res.status} for the playlist`);
  const text = await res.text();
  const base = res.url || url;
  const lines = text.split(/\r?\n/);
  if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
    if (depth > 2) throw new Error('playlist points at playlists all the way down');
    const pick = pickVariant(lines, base, level);
    if (!pick) throw new Error('master playlist without variants');
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

  async function save(streamId, { series, episode, dub, source, stream, level = null, onProgress = () => {}, signal = null }) {
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
      const opts = signal ? { signal } : {};
      let res = have ? await delivery.fetchOrigin(entry, stream.url, { range: `bytes=${have}-` }, opts) : null;
      if (res && res.status === 416) { have = 0; res = null; }              // the half file is not what the origin has now
      if (res && res.status !== 206) { have = 0; res.body && res.body.cancel && res.body.cancel().catch(() => {}); res = null; }
      if (!res) res = await delivery.fetchOrigin(entry, stream.url, {}, opts);
      if (!res.ok) throw new Error(`origin answered ${res.status}`);
      const total = have + (Number(res.headers.get('content-length')) || 0);
      let done = have;
      onProgress({ phase: 'fetch', done, total, unit: 'bytes' });
      const counter = new Transform({ transform(chunk, _, cb) { done += chunk.length; onProgress({ phase: 'fetch', done, total, unit: 'bytes' }); cb(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: have ? 'a' : 'w' }), signal ? { signal } : {});
    } else {
      const { segments, keys, localPlaylist, audio } = await segmentsOf(delivery, entry, stream.url, 0, level);
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

  /* ── the jobs: one at a time ──────────────────────────────────
     Every save asked for becomes a job the UI can poll, and stands in
     line: one job works, the rest wait as 'queued', whoever asked, this
     page, the resume loop after a start, another tab. A job is also
     written down by identity with its progress, so that a save cut
     short is known and taken up again; done, the record goes. */
  const line = [];                 // ids of the jobs waiting, in order
  const ctxOf = new Map();         // what each job saves, kept out of the job (the job is sent as JSON)
  const stops = new Map();         // the abort of each job working
  let held = false;                // the loading as a whole is on hold: the resume loop stops at the next record
  const noteFor = (job, ctx, extra = {}) => state && state.setSave(job.key, { seriesUrl: ctx.series.sourceUrl, seriesId: ctx.series.id, episode: ctx.episode.number, dubKey: ctx.dub.key, quality: job.quality, phase: job.phase, done: job.done, total: job.total, unit: job.unit || null, error: job.error, paused: false, ...extra });

  /* level: the height to take out of an adaptive stream; the job is then
     named by it, so a pause and a resume keep to the same quality */
  function start(streamId, ctx, { first = false, level = null } = {}) {
    const key = keyOf(ctx);
    const same = [...jobs.values()].find(j => j.key === key && (j.state === 'working' || j.state === 'queued'));
    if (same) { if (first) promote(same.id); return same; }
    const id = `${streamId}-${Date.now().toString(36)}`;
    level = Number(level) || null;
    const job = { id, key, streamId, seriesId: ctx.series.id, episode: ctx.episode.number, dub: ctx.dub.key, quality: level ? `${level}p` : ctx.stream.quality || 'auto', level, state: 'queued', phase: 'fetch', done: 0, total: 0, unit: null, file: null, error: null, started: Date.now() };
    jobs.set(id, job);
    ctxOf.set(id, { ...ctx, level });
    noteFor(job, ctx);
    if (first) return promote(id, job);
    line.push(id);
    pump();
    return job;
  }

  /* A job put first: it heads the line, and the one working, if any, steps
     back to the second place, cut off where it is, keeping its progress and
     the pieces it has; the line moves on with the promoted one. */
  function promote(id, job = jobs.get(id)) {
    if (!job || (job.state !== 'queued' && job.state !== 'working')) return job || null;
    if (job.state === 'working') return job;
    const i = line.indexOf(id); if (i >= 0) line.splice(i, 1);
    line.unshift(id);
    const working = [...jobs.values()].find(j => j.state === 'working');
    if (working) {
      working.state = 'queued';               // steps back; the catch below sees the state and keeps it
      line.splice(1, 0, working.id);
      const ac = stops.get(working.id); if (ac) ac.abort();
    } else pump();
    return job;
  }

  /* the next job in line goes to work when none is working */
  function pump() {
    if ([...jobs.values()].some(j => j.state === 'working')) return;
    while (line.length) {
      const job = jobs.get(line.shift());
      if (job && job.state === 'queued') return work(job);
    }
  }

  function work(job) {
    const ctx = ctxOf.get(job.id);
    job.state = 'working';
    const ac = new AbortController();
    stops.set(job.id, ac);
    const note = (extra) => noteFor(job, ctx, extra);
    note();
    /* progress after a pause is not written down: the record must keep saying paused */
    const onProgress = p => { if (job.state !== 'working') return; Object.assign(job, p); if (job.done % 10 === 0 || p.phase === 'assemble') note(); };
    save(job.streamId, { ...ctx, signal: ac.signal, onProgress })
      .then(async r => {
        if (job.state === 'cancelled') {       // cancelled at the last moment: the file made is not wanted
          await fsp.rm(r.file, { force: true }).catch(() => {}); await fsp.rm(r.sidecar, { force: true }).catch(() => {});
          return dropTraces(job, ctx);
        }
        Object.assign(job, { state: 'done', file: r.file, size: r.size }); if (state) state.clearSave(job.key);
      })
      .catch(async e => {
        if (job.state === 'queued') { note(); return; }   // stepped back for another: waits in line with its progress
        if (job.state === 'cancelled') { await dropTraces(job, ctx); return; }
        if (job.state === 'paused' || e.name === 'AbortError') {
          /* paused by hand: the record keeps where it got to, marked so that it
             is not taken up by itself; the half file and the cached pieces stay,
             so taking it up continues from there */
          job.state = 'paused';
          note({ paused: true });
        } else { Object.assign(job, { state: 'error', error: e.message }); note(); }
      })
      .finally(() => { stops.delete(job.id); if (job.state !== 'queued') ctxOf.delete(job.id); pump(); });
  }

  /* a save paused by hand: one waiting leaves the line, one working is cut off */
  function pause(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.state === 'queued') {
      job.state = 'paused';
      const ctx = ctxOf.get(id); if (ctx) noteFor(job, ctx, { paused: true });
      ctxOf.delete(id);
      pump();
    } else if (job.state === 'working') {
      job.state = 'paused';
      const ac = stops.get(id);
      if (ac) ac.abort();
    }
    return job;
  }
  /* the half file, the cached pieces and the record of a save: gone */
  async function dropTraces(job, ctx) {
    if (ctx) await fsp.rm(library.placeFor(ctx.series, ctx.episode, ctx.dub, 'mp4').file + '.part', { force: true }).catch(() => {});
    await cache.drop(job.streamId).catch(() => {});
    if (state) state.clearSave(job.key);
  }

  /* a save cancelled by hand: leaves the line or is cut off, and nothing of it stays */
  async function cancel(id) {
    const job = jobs.get(id);
    if (!job) return null;
    const ctx = ctxOf.get(id);
    if (job.state === 'queued') {
      const i = line.indexOf(id); if (i >= 0) line.splice(i, 1);
      job.state = 'cancelled';
      ctxOf.delete(id);
      await dropTraces(job, ctx);
      pump();
    } else if (job.state === 'working') {
      job.state = 'cancelled';
      if (state) state.clearSave(job.key);              // the record goes now, before the resume tick can see it
      const ac = stops.get(id); if (ac) ac.abort();     // the catch drops the rest of the traces
    } else if (job.state === 'paused' || job.state === 'error') {
      job.state = 'cancelled';
      await dropTraces(job, ctx);
    }
    return job;
  }

  /* every save of the given episodes of a series, cancelled: jobs in any
     state, records left by earlier runs, half files in the series folder */
  async function cancelFor({ seriesId, episodes, dir = null }) {
    const eps = new Set(episodes.map(Number));
    let n = 0;
    for (const job of [...jobs.values()]) if (job.seriesId === seriesId && eps.has(Number(job.episode)) && ['queued', 'working', 'paused', 'error'].includes(job.state)) { await cancel(job.id); n++; }
    if (state) for (const [key, rec] of Object.entries(state.saves())) if (rec.seriesId === seriesId && eps.has(Number(rec.episode))) { state.clearSave(key); n++; }
    if (dir) for (const f of await fsp.readdir(dir).catch(() => [])) {
      const m = /^(\d+)\b.*\.part$/.exec(f);
      if (m && eps.has(Number(m[1]))) await fsp.rm(path.join(dir, f), { force: true }).catch(() => {});
    }
    return n;
  }

  /* every save there is, cancelled: the jobs in any state and every record left by earlier runs */
  async function cancelAll() {
    let n = 0;
    for (const job of [...jobs.values()]) if (['queued', 'working', 'paused', 'error'].includes(job.state)) { await cancel(job.id); n++; }
    if (state) for (const key of Object.keys(state.saves())) { state.clearSave(key); n++; }
    return n;
  }

  function pauseAll() {
    held = true;
    const out = [];
    for (const job of jobs.values()) if (job.state === 'working' || job.state === 'queued') out.push(pause(job.id));
    return out;
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
        if ([...jobs.values()].some(j => j.key === key && (j.state === 'working' || j.state === 'queued'))) continue;
        try {
          const already = (await library.list()).some(s => s.episodes.some(e => e.seriesId === rec.seriesId && e.episode === rec.episode && e.dubKey === rec.dubKey));
          if (already) { state.clearSave(key); continue; }
          if (!lapka.series(rec.seriesId)) await lapka.look(rec.seriesUrl);
          const r = await lapka.resolve({ seriesId: rec.seriesId, number: rec.episode, dubKey: rec.dubKey });
          const st = streamForQuality(r.streams || [], rec.quality);
          const ctx = st && lapka.context(st.id);
          if (!ctx) { state.setSave(key, { error: 'no stream' }); continue; }
          /* a quality named on an adaptive stream is one of its levels */
          const level = st && !st.quality && /^\d{3,4}p$/.test(String(rec.quality || '')) ? parseInt(rec.quality, 10) : null;
          const job = start(st.id, ctx, { level });
          await new Promise(res => { const t = setInterval(() => { if (job.state !== 'working' && job.state !== 'queued') { clearInterval(t); res(); } }, 500); });
          out.push({ key, state: job.state, error: job.error });
        } catch (e) { state.setSave(key, { error: e.message }); out.push({ key, state: 'error', error: e.message }); }
      }
      return out;
    })().finally(() => { resuming = null; });
    return resuming;
  }

  return { save, start, promote, pause, pauseAll, cancel, cancelFor, cancelAll, resume, job: id => jobs.get(id) || null, jobs, keyOf };
}
