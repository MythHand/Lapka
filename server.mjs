#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   PIP Player, the local ffmpeg server

   The idea: a file the browser cannot play on its own is prepared
   ONCE, whole, into a plain MP4, and put in the cache. After that the
   browser treats it like any other file and seeks by byte ranges. No
   per-second -ss: that is exactly what used to break sync, because
   the video is copied while the audio is encoded again, so on every
   seek the two streams were joined from scratch.

   Listens on 127.0.0.1 only.
   ═══════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8777);
const CACHE = process.env.PIP_CACHE || path.join(os.tmpdir(), 'pip-player-cache');
fs.mkdirSync(CACHE, { recursive: true });

/* The cache limit. It is set from the player and kept in a file inside
   the cache folder, so it survives a restart; PIP_CACHE_GB only gives
   the starting value until the limit is changed there.

   There is a floor of 4 GB, room for the episode playing and the next
   one prepared at the size of an ordinary 1080p episode, and no fixed
   ceiling. The ceiling is the
   disk: the cache can grow to what it already takes plus what is still
   free, and a limit set in the player is cut down to that. */
const GB = 1024 ** 3;
const LIMIT_MIN = 4;
const LIMIT_FILE = path.join(CACHE, 'limit.json');
const clampGb = n => Math.max(LIMIT_MIN, Math.round(Number(n) || 0));
let cacheLimitGb = clampGb(process.env.PIP_CACHE_GB || 24);
try { cacheLimitGb = clampGb(JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf8')).gb); } catch { /* not set yet */ }
const cacheLimit = () => cacheLimitGb * GB;

/* Directories the server never steps outside of. On macOS and Linux
   that is the home folder and the mount points; on Windows the home
   folder and the drive roots, because there a second drive is a letter
   rather than a directory inside /Volumes, and without this a series
   on D: would be unreachable. */
function winDrives() {
  const out = [];
  for (let c = 67; c <= 90; c++) {            // C: … Z:
    const d = String.fromCharCode(c) + ':\\';
    try { if (fs.statSync(d).isDirectory()) out.push(d); } catch { }
  }
  return out;
}
const ROOTS = (process.platform === 'win32'
    ? [os.homedir(), ...winDrives()]
    : [os.homedir(), '/Volumes', '/media', '/mnt', '/run/media'])
  .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
/* the directory passed as an argument, usually the folder with the series */
let EXTRA_ROOT = null;
if (process.argv[2]) {
  const r = path.resolve(process.argv[2]);
  if (fs.existsSync(r)) { ROOTS.unshift(r); EXTRA_ROOT = r; }
}

const MEDIA_EXT = /\.(mp4|m4v|webm|ogv|ogm|mov|mkv|avi|ts|m2ts|mts|mpg|mpeg|3gp|flv|wmv|divx|mp3|m4a|m4b|aac|flac|wav|opus|oga)$/i;
const NATIVE_CONTAINER = /\.(mp4|m4v|mov|webm|ogv|mp3|m4a|aac|wav|flac|opus|oga)$/i;
const NATIVE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const NATIVE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le']);
/* text subtitles are converted to WebVTT; image based ones (PGS,
   VOBSUB) hold pictures rather than characters, so they can only be
   burned into the frame, which means re-encoding the whole video */
const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'stl']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.flac': 'audio/flac', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.jpg': 'image/jpeg',
};

/* ── helpers ───────────────────────────────────────────────── */
const inRoots = p => ROOTS.some(r => p === r || p.startsWith(r + path.sep));
const safePath = raw => { if (!raw) return null; const p = path.resolve(raw); return inRoots(p) ? p : null; };
/* The routes that open a file take only media files. Inside the home
   folder there is more than video, and /api/raw handed out any file at
   all to whoever passed the checks below. They let no other site
   through, but a player has no business serving keys or documents. */
const mediaPath = raw => { const p = safePath(raw); return p && MEDIA_EXT.test(p) ? p : null; };

/* ── who is knocking ─────────────────────────────────────────
   Listening on 127.0.0.1 is not enough. While the server runs, any
   page open in the same browser can reach it: the address is loopback,
   but the request comes from someone else's site. Separately there is
   DNS rebinding, where a foreign name resolves to 127.0.0.1, and then
   the loopback address guarantees nothing at all.

   Hence two checks. Host must be loopback with our port: under
   rebinding it carries the attacker's domain. Sec-Fetch-Site must be
   same-origin or none, and the browser sets it itself, so a page
   cannot forge it. Origin is checked when present.

   What is reachable without these checks: /api/ls returns the contents
   of any directory inside the home folder, /api/raw returns any media
   file in it. */
const HOSTS = new Set([
  '127.0.0.1:' + PORT, 'localhost:' + PORT, '[::1]:' + PORT,
]);
if (PORT === 80) for (const h of ['127.0.0.1', 'localhost', '[::1]']) HOSTS.add(h);

function fromLoopback(req) {
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) {
    let u; try { u = new URL(origin); } catch { return false; }
    if (!HOSTS.has(u.host.toLowerCase())) return false;
  }
  return true;
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

const run = (cmd, args) => new Promise((ok, bad) =>
  execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024 },
    (e, out, err) => e ? bad(new Error(err || e.message)) : ok(out)));

let ffmpegOk = null;
async function checkFfmpeg() {
  if (ffmpegOk !== null) return ffmpegOk;
  try { await run('ffprobe', ['-version']); ffmpegOk = true; } catch { ffmpegOk = false; }
  return ffmpegOk;
}

/* A hardware encoder is needed only when the video cannot be copied,
   which in practice means HEVC. Re-encoding on the CPU pins every core
   for minutes; videotoolbox moves it to the media engine.
   PIP_ENCODER=software turns it off. */
/* The order to try per system. Only encoders that start from a plain
   -c:v with no device setup: vaapi needs -vaapi_device and a format
   conversion, so it cannot be switched on blindly. If the chosen one
   fails anyway, startJob repeats the pass on the CPU. */
const HW_BY_OS = {
  darwin: ['h264_videotoolbox'],
  win32:  ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  linux:  ['h264_nvenc', 'h264_qsv'],
};
let hwEnc;
async function checkHw() {
  if (hwEnc !== undefined) return hwEnc;
  hwEnc = null;
  if (process.env.PIP_ENCODER === 'software') return hwEnc;
  const want = HW_BY_OS[process.platform] || [];
  if (!want.length) return hwEnc;
  try {
    const out = await run('ffmpeg', ['-hide_banner', '-encoders']);
    for (const enc of want) {
      if (new RegExp('\\b' + enc + '\\b').test(out)) { hwEnc = enc; break; }
    }
  } catch { /* stay on the CPU */ }
  return hwEnc;
}

/* videotoolbox does not understand crf, it wants a bitrate. Derived
   from frame height with room to spare: H.264 is less efficient than
   the HEVC we are usually converting from. */
function videoArgs(info, plan, useHw) {
  if (!info.video) return [];
  if (plan.copyVideo) return ['-c:v', 'copy'];
  if (!useHw) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'];
  const h = info.video.height || 1080;
  const kbps = h <= 720 ? 4000 : h <= 1080 ? 8000 : h <= 1440 ? 14000 : 24000;
  const rate = ['-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.5) + 'k',
                '-bufsize', kbps * 2 + 'k', '-pix_fmt', 'yuv420p'];
  /* -allow_sw exists only on videotoolbox, elsewhere it breaks startup */
  if (useHw === 'h264_videotoolbox') {
    return ['-c:v', useHw, '-allow_sw', '1', '-profile:v', 'high', ...rate];
  }
  return ['-c:v', useHw, '-profile:v', 'high', ...rate];
}

/* ── ffprobe ─────────────────────────────────────────────── */
const probeCache = new Map();
async function probe(file) {
  const st = await fsp.stat(file);
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  if (probeCache.has(key)) return probeCache.get(key);

  const raw = JSON.parse(await run('ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file]));

  const video = (raw.streams || []).filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = (raw.streams || []).filter(s => s.codec_type === 'audio');
  const subs = (raw.streams || []).filter(s => s.codec_type === 'subtitle');

  const info = {
    path: file, name: path.basename(file), size: st.size,
    duration: Number(raw.format?.duration) || 0,
    video: video[0] ? { index: video[0].index, codec: video[0].codec_name,
                        width: video[0].width, height: video[0].height } : null,
    audio: audio.map((s, i) => ({
      index: s.index, order: i, codec: s.codec_name,
      channels: s.channels || 0, layout: s.channel_layout || '',
      lang: (s.tags?.language || '').toLowerCase(), title: s.tags?.title || '',
      bitrate: Number(s.bit_rate) || Number(s.tags?.BPS) || Number(s.tags?.['BPS-eng']) || 0,
      sampleRate: Number(s.sample_rate) || 0,
      default: !!s.disposition?.default, forced: !!s.disposition?.forced,
      comment: !!s.disposition?.comment, native: NATIVE_AUDIO.has(s.codec_name),
    })),
    subs: subs.map((s, i) => ({
      index: s.index, order: i, codec: s.codec_name,
      lang: (s.tags?.language || '').toLowerCase(), title: s.tags?.title || '',
      default: !!s.disposition?.default, forced: !!s.disposition?.forced,
      text: TEXT_SUBS.has(s.codec_name),
    })),
  };
  info.defaultAudio = (info.audio.find(a => a.default) || info.audio[0] || null)?.index ?? null;
  info.defaultSub = (info.subs.find(x => x.text && x.default) || null)?.index ?? null;
  probeCache.set(key, info);
  return info;
}

/* the browser can handle it, so there is nothing to prepare */
function planFor(info, audioIndex) {
  const track = info.audio.find(a => a.index === audioIndex) || null;
  const nativeBox = NATIVE_CONTAINER.test(info.name);
  const nativeVideo = !info.video || NATIVE_VIDEO.has(info.video.codec);
  const nativeAudio = !track || track.native;
  const onlyDefault = !track || track.index === info.defaultAudio || info.audio.length <= 1;
  return {
    direct: nativeBox && nativeVideo && nativeAudio && onlyDefault,
    copyVideo: nativeVideo,
  };
}

/* ── cache of prepared files ───────────────────────────────── */
const keyFor = (file, st, a) => crypto.createHash('sha1')
  .update(`${file}|${st.mtimeMs}|${st.size}|${a}`).digest('hex').slice(0, 20);
const cacheFile = key => path.join(CACHE, key + '.mp4');

/* Files in use. A prepared file is marked when it is finished and every
   time the browser asks it for a range, so the one being watched and the
   one just prepared for the next episode stay marked. Eviction goes by
   the time of last use and never removes a file used in the last ten
   minutes: when the limit is lowered from the player, or when a single
   episode is larger than the limit, the cache stays over the limit for
   a while rather than deleting the file on screen. */
const used = new Map();          // key -> last use, ms
const HOT_MS = 10 * 60 * 1000;
function touch(key) {
  const now = Date.now();
  if (now - (used.get(key) || 0) < 30000) return;   // not on every range request
  used.set(key, now);
  const t = new Date(now);
  fsp.utimes(cacheFile(key), t, t).catch(() => {});
}

async function evict() {
  let items = [];
  for (const n of await fsp.readdir(CACHE)) {
    /* thumbnails count with the video: small each, many of them */
    if (!n.endsWith('.mp4') && !n.endsWith('.jpg')) continue;
    const f = path.join(CACHE, n);
    try { const s = await fsp.stat(f); items.push({ f, key: n.slice(0, -4), size: s.size, at: s.atimeMs || s.mtimeMs }); } catch {}
  }
  let total = items.reduce((a, b) => a + b.size, 0);
  if (total <= cacheLimit()) return;
  const now = Date.now();
  items.sort((a, b) => a.at - b.at);
  for (const it of items) {
    if (total <= cacheLimit()) break;
    if (now - (used.get(it.key) || 0) < HOT_MS) continue;
    try { await fsp.unlink(it.f); total -= it.size; console.log('  cache: removed', path.basename(it.f)); } catch {}
  }
}

/* What sits in the cache and how much it takes. Counts everything we
   put there: finished mp4 files, frames for the queue, extracted
   subtitles, and half-written .part files from interrupted passes. */
const CACHE_EXT = ['.mp4', '.jpg', '.vtt', '.part'];

/* free and total describe the disk the cache lives on; max is how far
   the cache could grow on it, the taken space plus the free space, and
   it is the end of the scale in the player. statfs appeared in Node
   18.15; on an older one these stay null and the player picks a scale
   of its own. */
async function cacheStat() {
  let bytes = 0, files = 0;
  for (const n of await fsp.readdir(CACHE).catch(() => [])) {
    if (!CACHE_EXT.some(e => n.endsWith(e))) continue;
    try { const st = await fsp.stat(path.join(CACHE, n)); bytes += st.size; files++; } catch {}
  }
  let free = null, total = null;
  try {
    const d = await fsp.statfs(CACHE);
    free = d.bavail * d.bsize;
    total = d.blocks * d.bsize;
  } catch { /* no statfs */ }
  return { bytes, files, limit: cacheLimit(), min: LIMIT_MIN * GB,
           max: free == null ? null : bytes + free, free, total, dir: CACHE };
}

async function setLimit(gb) {
  let want = clampGb(gb);
  const { max } = await cacheStat();
  if (max != null) want = Math.max(LIMIT_MIN, Math.min(want, Math.floor(max / GB)));
  cacheLimitGb = want;
  await fsp.writeFile(LIMIT_FILE, JSON.stringify({ gb: cacheLimitGb }));
  console.log('  cache limit:', cacheLimitGb, 'GB');
  await evict();
}

/* Clearing by hand. Unfinished passes are stopped first, otherwise
   ffmpeg finishes writing its .part after we have reported the space
   as free, and the file stays behind.

   keep is the file playing right now. It survives: the browser holds
   it open and the first seek would ask for a chunk that is no longer
   there. */
async function cacheClear(keep) {
  for (const [key, job] of jobs) {
    if (key === keep) continue;
    try { job.proc && job.proc.kill('SIGKILL'); } catch {}
    jobs.delete(key);
  }
  let bytes = 0, files = 0;
  for (const n of await fsp.readdir(CACHE).catch(() => [])) {
    if (!CACHE_EXT.some(e => n.endsWith(e))) continue;
    if (keep && n.startsWith(keep)) continue;
    const f = path.join(CACHE, n);
    try { const st = await fsp.stat(f); await fsp.unlink(f); bytes += st.size; files++; } catch {}
  }
  console.log('  cache cleared:', files, 'files');
  return { bytes, files };
}

/* ── preparing: one pass, a plain seekable MP4 ─────────────── */
const jobs = new Map();   // key -> { progress, error, proc }

function startJob(key, file, info, audioIndex, plan, useHw) {
  const part = path.join(CACHE, key + '.part');
  const out = cacheFile(key);

  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', file];
  if (info.video) args.push('-map', `0:${info.video.index}`);
  if (audioIndex != null) args.push('-map', `0:${audioIndex}`);
  args.push('-sn', '-dn', '-map_metadata', '-1');
  args.push(...videoArgs(info, plan, useHw));
  if (audioIndex != null) args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000');

  /* one pass, no -ss: video and audio are joined exactly once, on the
     original timeline, so there is nowhere for drift to come from */
  args.push('-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', part);

  /* show the command that actually runs, minus the long paths */
  const short = a => a === file ? path.basename(file) : a === part ? path.basename(part) : a;
  const job = jobs.get(key) || {};
  Object.assign(job, {
    progress: 0, phase: 'convert', error: null, started: job.started || Date.now(),
    hw: !!useHw,
    cmd: 'ffmpeg ' + args.filter(a => a !== '-hide_banner' && a !== '-loglevel'
                                   && a !== 'error' && a !== '-nostdin' && a !== '-y'
                                   && a !== '-progress' && a !== 'pipe:1').map(short).join(' '),
  });
  jobs.set(key, job);

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = proc;

  let tail = '';
  proc.stdout.on('data', d => {
    const s = String(d);
    const m = /out_time_(?:us|ms)=(\d+)/g;
    let last = null, x;
    while ((x = m.exec(s))) last = x;
    if (last && info.duration) {
      const div = last[0].includes('_us=') ? 1e6 : 1e3;
      job.progress = Math.max(0, Math.min(1, Number(last[1]) / div / info.duration));
    }
    /* encoding is done; from here faststart rewrites the whole file and
       reports no progress, so we name it as a separate step instead */
    if (/progress=end/.test(s)) { job.phase = 'finalize'; job.progress = 1; }
  });
  proc.stderr.on('data', d => { tail = (tail + d).slice(-1500); });

  proc.on('error', e => { job.error = e.message; });
  proc.on('exit', async code => {
    if (code === 0) {
      try { await fsp.rename(part, out); } catch (e) { job.error = String(e.message); }
      used.set(key, Date.now());
      jobs.delete(key);
      evict().catch(() => {});
      console.log('  done:', info.name);
      return;
    }
    try { await fsp.unlink(part); } catch {}
    /* the hardware encoder trips over unusual sources, and then we
       quietly repeat the pass on the CPU instead of showing an error */
    if (useHw) {
      console.log('  hardware encoder failed, repeating on the CPU:', info.name);
      return startJob(key, file, info, audioIndex, plan, false);
    }
    job.error = (tail.replace(/\s+/g, ' ').trim().slice(0, 300)) || `ffmpeg exited with code ${code}`;
    job.progress = 0;
    setTimeout(() => jobs.delete(key), 30000);
    console.error('  preparation failed:', info.name, job.error);
  });
  return job;
}

/* ── extracting subtitles ──────────────────────────────────── */
const subJobs = new Map();

function extractSubs(file, idx, out) {
  const part = out + '.part';
  return new Promise((ok, bad) => {
    /* -vn -an: video and audio are not needed, the demuxer skips them */
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', file, '-map', `0:${idx}`, '-vn', '-an', '-c:s', 'webvtt', '-f', 'webvtt', part]);
    let tail = '';
    proc.stderr.on('data', d => { tail = (tail + d).slice(-800); });
    proc.on('error', bad);
    proc.on('exit', async code => {
      if (code !== 0) { try { await fsp.unlink(part); } catch {} return bad(new Error(tail || 'code ' + code)); }
      try { await fsp.rename(part, out); ok(out); } catch (e) { bad(e); }
    });
  });
}

/* ── serving a file with Range support ─────────────────────── */
function serveFile(req, res, file, size) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : size - 1;
    if (!isFinite(start) || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'no-store' });
    const s = fs.createReadStream(file, { start, end });
    s.pipe(res); res.on('close', () => s.destroy());
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size,
    'accept-ranges': 'bytes', 'cache-control': 'no-store' });
  const s = fs.createReadStream(file);
  s.pipe(res); res.on('close', () => s.destroy());
}

/* ── walking directories ───────────────────────────────────── */
const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

async function listDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const dirs = [], files = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) dirs.push({ name: e.name, path: full });
    else if (e.isFile() && MEDIA_EXT.test(e.name)) {
      let size = 0;
      try { size = (await fsp.stat(full)).size; } catch {}
      files.push({ name: e.name, path: full, size });
    }
  }
  dirs.sort((a, b) => cmp.compare(a.name, b.name));
  files.sort((a, b) => cmp.compare(a.name, b.name));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent !== dir && inRoots(parent) ? parent : null, dirs, files };
}

/* Shortcuts for the disk browser. The server does not know which
   language the interface is in, so it returns a key and the client
   supplies the label; name stays as the fallback. Volumes have no key,
   their names are proper nouns already. */
function places() {
  const home = os.homedir();
  const list = [];
  /* The directory passed as an argument used to grant access without
     appearing in the shortcuts, so it had to be walked to by hand. It
     goes first now: if it was named on the command line, that is where
     the browsing starts. */
  if (EXTRA_ROOT) list.push({ name: path.basename(EXTRA_ROOT) || EXTRA_ROOT, path: EXTRA_ROOT });
  list.push(
    { key: 'home',      name: 'Home',      path: home },
    { key: 'downloads', name: 'Downloads', path: path.join(home, 'Downloads') },
    /* on Windows the system folder is Videos, elsewhere Movies */
    { key: 'movies',    name: 'Movies',
      path: path.join(home, process.platform === 'win32' ? 'Videos' : 'Movies') },
    { key: 'desktop',   name: 'Desktop',   path: path.join(home, 'Desktop') },
  );
  if (process.platform === 'win32') {
    for (const d of winDrives()) list.push({ name: d.slice(0, 2), path: d });
  } else {
    for (const base of ['/Volumes', '/media', '/mnt']) {
      try {
        for (const v of fs.readdirSync(base)) {
          if (!v.startsWith('.')) list.push({ name: v, path: path.join(base, v) });
        }
      } catch { }
    }
  }
  return list.filter(p => { try { return fs.statSync(p.path).isDirectory(); } catch { return false; } });
}

/* finding a dropped file on disk */
const SKIP_DIR = new Set(['Library', 'Applications', 'System', 'node_modules', '.git', 'private',
                          'Photos Library.photoslibrary', 'Music', '.Trash']);
/* The browser does not hand over the absolute path of a dropped file,
   so the server looks for it. A full sweep of the disk is the last
   resort: it costs seconds and touches the whole home folder. First we
   try the directories the client already knows from previous drops,
   and their neighbours. On the second and later drops from the same
   folder the sweep does not run at all: the file is found by the very
   first stat. */
async function fromHints(name, size, dirs) {
  const near = [];
  for (const raw of dirs) {
    const dir = safePath(raw);
    if (!dir) continue;
    const full = path.join(dir, name);
    try {
      const st = await fsp.stat(full);
      if (st.isFile() && (!size || st.size === Number(size)))
        return { name, path: full, size: st.size, dir };
    } catch {}
    near.push(dir);
  }
  /* neighbouring folders: a series sits next to the last one, not anywhere */
  for (const dir of near) {
    const up = path.dirname(dir);
    if (up === dir || !inRoots(up)) continue;
    let entries; try { entries = await fsp.readdir(up, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue;
      const full = path.join(up, e.name, name);
      try {
        const st = await fsp.stat(full);
        if (st.isFile() && (!size || st.size === Number(size)))
          return { name, path: full, size: st.size, dir: path.join(up, e.name) };
      } catch {}
    }
  }
  return null;
}

async function findByName(name, size, dirs = []) {
  const hinted = await fromHints(name, size, dirs);
  if (hinted) return [hinted];

  const deadline = Date.now() + 6000;
  const queue = [...ROOTS];
  const exact = [], loose = [];
  let seen = 0;
  while (queue.length && Date.now() < deadline && seen < 15000) {
    const dir = queue.shift(); seen++;
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { queue.push(full); continue; }
      if (e.name !== name) continue;
      let st; try { st = await fsp.stat(full); } catch { continue; }
      const hit = { name: e.name, path: full, size: st.size, dir };
      if (size && st.size === Number(size)) exact.push(hit); else loose.push(hit);
      if (exact.length >= 5) return exact;
    }
  }
  return exact.length ? exact : loose.slice(0, 5);
}

/* ── one frame as a thumbnail ────────────────────────────────
   One frame per file, at roughly 12 % of the duration: the opening
   titles are over and the middle of the episode is still far off. It
   goes into the same cache. No more than two ffmpeg processes at once:
   the queue asks for thumbnails in batches, and without a limit a
   long list floors the CPU. */
const thumbJobs = new Map();
let thumbBusy = 0;

function makeThumb(file, out, at) {
  return new Promise((resolve, reject) => {
    const tmp = out + '.part';
    const pr = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-ss', String(at), '-i', file, '-frames:v', '1',
      '-vf', 'scale=400:-2', '-q:v', '4', '-f', 'image2', tmp]);
    pr.on('error', reject);
    pr.on('close', async code => {
      if (code !== 0) { await fsp.unlink(tmp).catch(() => {}); return reject(new Error('ffmpeg ' + code)); }
      try { await fsp.rename(tmp, out); resolve(); } catch (e) { reject(e); }
    });
  });
}

async function thumbFor(file, st) {
  const out = path.join(CACHE, keyFor(file, st, 'thumb') + '.jpg');
  if (fs.existsSync(out)) return out;

  let job = thumbJobs.get(out);
  if (job) return job;

  job = (async () => {
    while (thumbBusy >= 2) await new Promise(r => setTimeout(r, 120));
    thumbBusy++;
    try {
      const info = await probe(file);
      const d = info.duration || 0;
      const at = d > 20 ? Math.min(d - 1, d * 0.12) : 0;
      /* short or awkward file, take the very first frame */
      try { await makeThumb(file, out, at); } catch { await makeThumb(file, out, 0); }
      return out;
    } finally { thumbBusy--; thumbJobs.delete(out); }
  })();
  thumbJobs.set(out, job);
  return job;
}

/* ── static files ──────────────────────────────────────────── */
const STATIC = new Set(['/index.html', '/styles.css', '/app.js', '/i18n.js']);
/* Fonts live in folders under assets/fonts; only the face files are
   served out of them, and only by a plain name. No nested paths are
   possible here and the name has to end in an extension, so ".." does
   not get through. */
const FONT_RE = /^\/assets\/fonts\/(?:FixelDisplay|Inter)\/[^/]+\.(?:woff2|ttf)$/;
async function serveStatic(res, name) {
  const file = path.join(HERE, name === '/' ? 'index.html' : name);
  try {
    const buf = await fsp.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': buf.length, 'cache-control': 'no-store' });
    res.end(buf);
  } catch { res.writeHead(404).end('not found'); }
}

/* ── routes ────────────────────────────────────────────────── */
const server = http.createServer(async (req, res) => {
  if (!fromLoopback(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (p.startsWith('/api/') && p !== '/api/prepare') {
    const q = url.searchParams.get('path');
    console.log('  ->', p.replace('/api/', ''), q ? path.basename(q) : '');
  }

  try {
    if (p === '/' || STATIC.has(p)) return serveStatic(res, p);
    if (FONT_RE.test(p)) return serveStatic(res, p);

    if (p === '/api/ping') {
      return json(res, 200, { ok: true, ffmpeg: await checkFfmpeg(), hw: await checkHw(),
        roots: ROOTS, places: places(), cache: CACHE });
    }

    /* Cache size, and clearing it from the button. Clearing changes
       state, so it takes a POST and a header of its own: a plain form
       on someone else's site cannot set that header, it would need a
       preflight, and we allow none. */
    if (p === '/api/cache/limit') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
      if (req.headers['x-pip'] !== '1') return json(res, 400, { error: 'the x-pip header is required' });
      const gb = Number(url.searchParams.get('gb'));
      if (!isFinite(gb)) return json(res, 400, { error: 'gb must be a number' });
      await setLimit(gb);
      return json(res, 200, await cacheStat());
    }

    if (p === '/api/cache') {
      if (req.method === 'POST') {
        if (req.headers['x-pip'] !== '1') return json(res, 400, { error: 'the x-pip header is required' });
        const keep = (url.searchParams.get('keep') || '').replace(/[^a-f0-9]/g, '');
        const freed = await cacheClear(keep);
        return json(res, 200, { ...await cacheStat(), freed });
      }
      return json(res, 200, await cacheStat());
    }

    if (p === '/api/ls') {
      const dir = safePath(url.searchParams.get('path') || os.homedir());
      if (!dir) return json(res, 403, { error: 'path is outside the allowed directories' });
      const st = await fsp.stat(dir).catch(() => null);
      if (!st?.isDirectory()) return json(res, 404, { error: 'directory not found' });
      return json(res, 200, await listDir(dir));
    }

    if (p === '/api/find') {
      const name = url.searchParams.get('name');
      if (!name) return json(res, 400, { error: 'a file name is required' });
      /* directories where the client already found files: with them the sweep is usually skipped */
      const dirs = url.searchParams.getAll('dir').slice(0, 12);
      return json(res, 200, { matches: await findByName(name, url.searchParams.get('size'), dirs) });
    }

    if (p === '/api/probe') {
      if (!await checkFfmpeg()) return json(res, 503, { error: 'ffprobe not found in PATH' });
      const file = mediaPath(url.searchParams.get('path'));
      if (!file) return json(res, 403, { error: 'not a media file, or outside the allowed directories' });
      const info = await probe(file);
      return json(res, 200, { ...info, plan: planFor(info, info.defaultAudio) });
    }

    /* Whether the file is ready to play. The client polls this until
       it gets state:'ready' or 'direct'. */
    if (p === '/api/prepare') {
      const file = mediaPath(url.searchParams.get('path'));
      if (!file) return json(res, 403, { error: 'not a media file, or outside the allowed directories' });
      const st = await fsp.stat(file).catch(() => null);
      if (!st?.isFile()) return json(res, 404, { error: 'file not found' });
      if (!await checkFfmpeg()) return json(res, 200, { state: 'direct' });

      const info = await probe(file);
      const raw = url.searchParams.get('a');
      const a = raw != null && raw !== '' ? Number(raw) : info.defaultAudio;
      const plan = planFor(info, a);
      if (plan.direct) return json(res, 200, { state: 'direct', duration: info.duration });

      const key = keyFor(file, st, a);
      const out = cacheFile(key);
      const ready = await fsp.stat(out).catch(() => null);
      if (ready) {
        touch(key);
        return json(res, 200, { state: 'ready', key, duration: info.duration, size: ready.size });
      }

      let job = jobs.get(key);
      if (!job) {
        const hw = plan.copyVideo ? null : await checkHw();
        console.log('  preparing:', info.name, '· track', a,
          plan.copyVideo ? '· video copied' : hw ? '· re-encoding on ' + hw : '· re-encoding on the CPU');
        job = startJob(key, file, info, a, plan, hw);
      }
      if (job.error) return json(res, 200, { state: 'error', error: job.error });
      return json(res, 200, { state: 'working', key, progress: job.progress,
        phase: job.phase, cmd: job.cmd, elapsed: Date.now() - job.started, duration: info.duration });
    }

    if (p === '/api/thumb') {
      if (!await checkFfmpeg()) return res.writeHead(503).end('no ffmpeg');
      const file = mediaPath(url.searchParams.get('path'));
      if (!file) return res.writeHead(403).end('forbidden');
      const st = await fsp.stat(file).catch(() => null);
      if (!st?.isFile()) return res.writeHead(404).end('not found');

      let out;
      try { out = await thumbFor(file, st); }
      catch (e) { return res.writeHead(500).end('could not grab a frame'); }
      const buf = await fsp.readFile(out);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': buf.length,
                           'cache-control': 'private, max-age=86400' });
      return res.end(buf);
    }

    /* Subtitles as a separate WebVTT file: that is the only format the
       browser understands, and SRT or ASS inside an MKV is not one of
       them. The result is cached. */
    if (p === '/api/subs') {
      if (!await checkFfmpeg()) return res.writeHead(503).end('no ffmpeg');
      const file = mediaPath(url.searchParams.get('path'));
      if (!file) return res.writeHead(403).end('forbidden');
      const st = await fsp.stat(file).catch(() => null);
      if (!st?.isFile()) return res.writeHead(404).end('not found');

      const idx = Number(url.searchParams.get('s'));
      if (!isFinite(idx)) return res.writeHead(400).end('bad stream');

      const out = path.join(CACHE, keyFor(file, st, 'sub' + idx) + '.vtt');
      if (!fs.existsSync(out)) {
        const pending = subJobs.get(out);
        if (pending) await pending;
        else {
          const job = extractSubs(file, idx, out);
          subJobs.set(out, job);
          try { await job; } catch (e) {
            subJobs.delete(out);
            console.error('  subtitles:', String(e.message).slice(0, 200));
            return res.writeHead(500).end('could not extract subtitles');
          }
          subJobs.delete(out);
        }
      }
      const vst = await fsp.stat(out).catch(() => null);
      if (!vst) return res.writeHead(500).end('empty');
      res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8',
        'content-length': vst.size, 'cache-control': 'no-store' });
      return fs.createReadStream(out).pipe(res);
    }

    /* the prepared file */
    if (p === '/api/media') {
      const key = (url.searchParams.get('key') || '').replace(/[^a-f0-9]/g, '');
      if (!key) return res.writeHead(400).end('bad key');
      const f = cacheFile(key);
      const st = await fsp.stat(f).catch(() => null);
      if (!st) return res.writeHead(404).end('not ready');
      touch(key);
      return serveFile(req, res, f, st.size);
    }

    /* a file the browser plays on its own, served as it is */
    if (p === '/api/raw') {
      const file = mediaPath(url.searchParams.get('path'));
      if (!file) return res.writeHead(403).end('forbidden');
      const st = await fsp.stat(file).catch(() => null);
      if (!st?.isFile()) return res.writeHead(404).end('not found');
      return serveFile(req, res, file, st.size);
    }

    res.writeHead(404).end('not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: String(err.message || err) });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('');
  console.log('  PIP Player  ·  http://127.0.0.1:' + PORT);
  console.log('  ffmpeg      ·  ' + (await checkFfmpeg() ? 'found' : 'NOT FOUND'));
  console.log('  encoding    ·  ' + (await checkHw() || 'CPU (libx264)')
    + '   only needed for HEVC, H.264 is copied as it is');
  console.log('  cache       ·  ' + CACHE + '  (limit ' + cacheLimitGb + ' GB)');
  console.log('  directories ·  ' + ROOTS.join('  '));
  console.log('');
});
