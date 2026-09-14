/* ═══════════════════════════════════════════════════════════
   The ffmpeg server, over real HTTP.

   Every case here failed for real at some point, or guards something
   that would be silent if it broke: the loopback check, the root
   check, byte ranges, the three preparation paths.

   The server is started as a child process on a port of its own, with
   its cache in a temporary directory and the fixture folder as the one
   extra root. It never sees the user's own files.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, haveFfmpeg } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PORT = 8781;
const BASE = `http://127.0.0.1:${PORT}`;
const CACHE = path.join(os.tmpdir(), 'pip-player-test-cache');

let child, media;
const ffmpeg = await haveFfmpeg();

/* The browser sends these on every same-origin request. curl and fetch
   do not, and the server is entitled to refuse without them, so the
   tests speak the way a browser speaks. */
const asBrowser = (extra = {}) => ({
  host: `127.0.0.1:${PORT}`,
  origin: BASE,
  'sec-fetch-site': 'same-origin',
  ...extra,
});
const get = (url, headers = {}) => fetch(BASE + url, { headers: asBrowser(headers) });

/* fetch refuses to set Host: it is a forbidden header name and undici
   drops it without a word, so a rebinding test written with fetch would
   quietly pass against a server that has no check at all. The raw http
   client sets whatever it is given. */
const raw = (url, headers) => new Promise((ok, bad) => {
  const req = http.request(BASE + url, { headers }, res => {
    res.resume();
    res.on('end', () => ok(res.statusCode));
  });
  req.on('error', bad);
  req.end();
});

/* Even the raw http client writes a Host of its own, so a request
   without one has to be typed onto the socket by hand. */
const overSocket = lines => new Promise((ok, bad) => {
  const sock = net.connect(PORT, '127.0.0.1', () => sock.write(lines.join('\r\n') + '\r\n\r\n'));
  let buf = '';
  sock.on('data', d => { buf += d; });
  sock.on('end', () => ok(Number(/^HTTP\/1\.\d (\d+)/.exec(buf)?.[1]) || 0));
  sock.on('error', bad);
  sock.setTimeout(3000, () => { sock.destroy(); ok(0); });
});
const json = async (url, headers) => (await get(url, headers)).json();
const q = p => encodeURIComponent(p);

before(async () => {
  if (!ffmpeg) return;
  media = await build();
  await fsp.rm(CACHE, { recursive: true, force: true });
  child = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), media.dir], {
    env: { ...process.env, PORT: String(PORT), PIP_CACHE: CACHE },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await get('/api/ping')).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('the server did not come up');
});

after(async () => {
  if (child) child.kill();
  await fsp.rm(CACHE, { recursive: true, force: true });
});

/* Waits for a file to become playable. Preparing a two second clip
   takes well under a second, the ceiling is only there so a hung
   ffmpeg fails the test instead of the suite. */
async function ready(file, audio) {
  const url = `/api/prepare?path=${q(file)}` + (audio == null ? '' : `&a=${audio}`);
  for (let i = 0; i < 200; i++) {
    const r = await json(url);
    if (r.state === 'ready' || r.state === 'direct') return r;
    assert.notEqual(r.state, 'error', 'preparation failed: ' + r.error);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('preparation did not finish');
}

describe('who is allowed in', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('a request from our own page passes', async () => {
    assert.equal((await get('/api/ping')).status, 200);
  });

  test('a foreign name in Host is refused (DNS rebinding)', async () => {
    assert.equal(await raw('/api/ls', { host: 'evil.example.com' }), 403);
  });

  test('the right host with the wrong port is refused', async () => {
    assert.equal(await raw('/api/ls', { host: '127.0.0.1:1' }), 403);
  });

  test('a request with no Host at all is refused', async () => {
    const code = await overSocket(['GET /api/ls HTTP/1.1', 'Connection: close']);
    assert.notEqual(code, 200, 'a request without Host must not be served');
    assert.ok(code === 400 || code === 403, 'got ' + code);
  });

  test('a request made from another site is refused', async () => {
    const r = await fetch(BASE + `/api/ls?path=${q(os.homedir())}`, {
      headers: asBrowser({ origin: 'https://evil.example.com', 'sec-fetch-site': 'cross-site' }),
    });
    assert.equal(r.status, 403);
  });

  test('typing the address by hand passes', async () => {
    assert.equal(await raw('/', { host: `127.0.0.1:${PORT}`, 'sec-fetch-site': 'none' }), 200);
  });

  test('localhost is the same machine', async () => {
    assert.equal(await raw('/api/ping', { host: `localhost:${PORT}` }), 200);
  });
});

describe('what may be read', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('a directory outside the roots is refused', async () => {
    const r = await get('/api/ls?path=/etc');
    assert.equal(r.status, 403);
  });

  test('walking out with .. is refused', async () => {
    const r = await get(`/api/ls?path=${q(media.show + '/../../../../etc')}`);
    assert.equal(r.status, 403);
  });

  test('a directory inside the roots is listed', async () => {
    const d = await json(`/api/ls?path=${q(media.show)}`);
    assert.equal(d.path, media.show);
    assert.ok(d.files.some(f => f.name === 'native.mp4'));
    assert.ok(d.files.every(f => !f.name.endsWith('.srt')), 'subtitles are not media files');
  });

  test('a file outside the roots is not served raw', async () => {
    const r = await get('/api/raw?path=/etc/hosts');
    assert.equal(r.status, 403);
  });

  test('inside the roots a file that is not media is not served either', async () => {
    const r = await get(`/api/raw?path=${q(media.subs)}`);
    assert.equal(r.status, 403, 'the subtitle file lies right next to the episodes');
  });
});

describe('probing a file', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('both audio tracks come back with language and title', async () => {
    const p = await json(`/api/probe?path=${q(media.release)}`);
    assert.equal(p.audio.length, 2);
    assert.deepEqual(p.audio.map(t => t.lang), ['rus', 'eng']);
    assert.deepEqual(p.audio.map(t => t.title), ['Studio One', 'Original']);
    assert.ok(p.audio.every(t => t.codec === 'ac3'));
  });

  test('the text subtitle track is listed', async () => {
    const p = await json(`/api/probe?path=${q(media.release)}`);
    assert.equal(p.subs.length, 1);
    assert.equal(p.subs[0].lang, 'eng');
    assert.equal(p.subs[0].text, true, 'a text track, so it can become WebVTT');
  });

  test('a file the browser can play needs no preparation', async () => {
    const p = await json(`/api/probe?path=${q(media.native)}`);
    assert.equal(p.plan.direct, true);
  });

  test('MKV cannot be played as it is', async () => {
    const p = await json(`/api/probe?path=${q(media.release)}`);
    assert.equal(p.plan.direct, false);
    assert.equal(p.plan.copyVideo, true, 'H.264 is copied, not re-encoded');
  });

  test('an old container has to be re-encoded', async () => {
    const p = await json(`/api/probe?path=${q(media.legacy)}`);
    assert.equal(p.plan.copyVideo, false);
  });

  test('a file that is not media is not probed', async () => {
    assert.equal((await get(`/api/probe?path=${q(media.subs)}`)).status, 403);
  });
});

describe('preparing and serving', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('MP4 is served straight from disk', async () => {
    assert.equal((await ready(media.native)).state, 'direct');
  });

  test('MKV is prepared and then reported ready', async () => {
    const r = await ready(media.release);
    assert.equal(r.state, 'ready');
    assert.ok(r.size > 0);
    assert.ok(r.duration > 1.5 && r.duration < 3);
  });

  test('AVI is prepared as well', async () => {
    assert.equal((await ready(media.legacy)).state, 'ready');
  });

  test('each audio track gets a cache entry of its own', async () => {
    const a = await ready(media.release, 1);
    const b = await ready(media.release, 2);
    assert.notEqual(a.key, b.key);
  });

  test('asking again returns the same key rather than working again', async () => {
    const a = await ready(media.release);
    const b = await json(`/api/prepare?path=${q(media.release)}`);
    assert.equal(b.state, 'ready');
    assert.equal(b.key, a.key);
  });

  test('the prepared file answers byte ranges', async () => {
    const { key } = await ready(media.release);
    const whole = await get(`/api/media?key=${key}`);
    const all = Buffer.from(await whole.arrayBuffer());

    const part = await get(`/api/media?key=${key}`, { range: 'bytes=100-199' });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-length'), '100');
    assert.equal(part.headers.get('content-range'), `bytes 100-199/${all.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), all.subarray(100, 200));
  });

  test('a file played as it is answers byte ranges too', async () => {
    const r = await get(`/api/raw?path=${q(media.native)}`, { range: 'bytes=0-49' });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 50);
  });

  test('an unknown key is not found', async () => {
    assert.equal((await get('/api/media?key=deadbeef')).status, 404);
  });
});

describe('subtitles', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('a text track comes back as WebVTT', async () => {
    const p = await json(`/api/probe?path=${q(media.release)}`);
    const r = await get(`/api/subs?path=${q(media.release)}&s=${p.subs[0].index}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/vtt/);
    const body = await r.text();
    assert.match(body, /^WEBVTT/);
    assert.match(body, /first line/);
  });

  test('a stream that is not a subtitle track fails rather than lying', async () => {
    const r = await get(`/api/subs?path=${q(media.release)}&s=99`);
    assert.equal(r.status, 500);
  });
});

describe('thumbnails', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('a frame comes back as a JPEG', async () => {
    const r = await get(`/api/thumb?path=${q(media.native)}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    const b = Buffer.from(await r.arrayBuffer());
    assert.ok(b.length > 500);
    assert.equal(b[0], 0xff, 'JPEG starts with FF D8');
    assert.equal(b[1], 0xd8);
  });

  test('the second request is served from the cache', async () => {
    await get(`/api/thumb?path=${q(media.legacy)}`);
    const t = Date.now();
    const r = await get(`/api/thumb?path=${q(media.legacy)}`);
    assert.equal(r.status, 200);
    await r.arrayBuffer();
    assert.ok(Date.now() - t < 300, 'a cached frame must not run ffmpeg again');
  });
});

describe('finding a dropped file', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('found by name and size', async () => {
    const size = (await fsp.stat(media.native)).size;
    const d = await json(`/api/find?name=native.mp4&size=${size}`);
    assert.equal(d.matches[0].path, media.native);
    assert.equal(d.matches[0].dir, media.show);
  });

  test('a known directory finds it without a sweep', async () => {
    const d = await json(`/api/find?name=native.mp4&dir=${q(media.show)}`);
    assert.equal(d.matches[0].path, media.native);
  });

  test('a neighbouring directory is enough', async () => {
    const sister = path.join(media.dir, 'Show', 'S02');
    await fsp.mkdir(sister, { recursive: true });
    const d = await json(`/api/find?name=native.mp4&dir=${q(sister)}`);
    assert.equal(d.matches[0].path, media.native);
  });

  test('a hint outside the roots is ignored, not followed', async () => {
    const d = await json('/api/find?name=hosts&dir=/etc');
    assert.deepEqual(d.matches, []);
  });

  test('a name that is not there returns nothing', async () => {
    const d = await json('/api/find?name=there-is-no-such-file.mkv');
    assert.deepEqual(d.matches, []);
  });
});

describe('the cache', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('reports what it holds', async () => {
    await ready(media.release);
    const c = await json('/api/cache');
    assert.ok(c.bytes > 0);
    assert.ok(c.files > 0);
    assert.equal(c.dir, CACHE);
  });

  test('clearing without the header is refused', async () => {
    const r = await fetch(BASE + '/api/cache', { method: 'POST', headers: asBrowser() });
    assert.equal(r.status, 400);
  });

  test('clearing from another site is refused', async () => {
    const r = await fetch(BASE + '/api/cache', {
      method: 'POST',
      headers: asBrowser({ 'x-pip': '1', 'sec-fetch-site': 'cross-site' }),
    });
    assert.equal(r.status, 403);
  });

  test('clearing empties it', async () => {
    await ready(media.release);
    const r = await fetch(BASE + '/api/cache', {
      method: 'POST', headers: asBrowser({ 'x-pip': '1' }),
    });
    const c = await r.json();
    assert.equal(c.bytes, 0);
    assert.ok(c.freed.bytes > 0);
  });

  test('the file playing right now survives the clearing', async () => {
    const { key } = await ready(media.release);
    await get(`/api/thumb?path=${q(media.native)}`);
    const r = await fetch(BASE + `/api/cache?keep=${key}`, {
      method: 'POST', headers: asBrowser({ 'x-pip': '1' }),
    });
    const c = await r.json();
    assert.ok(c.freed.files > 0, 'the thumbnail was dropped');
    assert.ok(c.bytes > 0, 'the file being played stayed');
    assert.equal((await get(`/api/media?key=${key}`, { range: 'bytes=0-9' })).status, 206);
  });
});

describe('the cache limit', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  const GB = 1024 ** 3;
  const setLimit = (gb, headers = { 'x-pip': '1' }) =>
    fetch(BASE + '/api/cache/limit?gb=' + gb, { method: 'POST', headers: asBrowser(headers) });

  test('reports the floor, the limit and the disk', async () => {
    const c = await json('/api/cache');
    assert.equal(c.min, 4 * GB);
    assert.ok(c.free > 0 && c.total >= c.free, 'free and total come from the disk');
    assert.equal(c.max, c.bytes + c.free, 'the ceiling is what the cache takes plus what is free');
    assert.ok(c.limit >= c.min);
  });

  test('is changed from the player and kept in a file', async () => {
    const c = await (await setLimit(40)).json();
    assert.equal(c.limit, 40 * GB);
    const saved = JSON.parse(await fsp.readFile(path.join(CACHE, 'limit.json'), 'utf8'));
    assert.equal(saved.gb, 40);
    assert.equal((await json('/api/cache')).limit, 40 * GB);
  });

  test('does not go below 4 GB', async () => {
    assert.equal((await (await setLimit(2)).json()).limit, 4 * GB);
  });

  test('has no fixed ceiling, only the disk', async () => {
    const c = await (await setLimit(1e6)).json();
    assert.equal(c.limit, Math.floor(c.max / GB) * GB, 'a limit past the disk is cut down to it');
    assert.ok(c.limit > 128 * GB || c.max < 129 * GB, 'nothing stops it at 128');
  });

  test('a limit that is not a number is refused', async () => {
    assert.equal((await setLimit('abc')).status, 400);
  });

  test('changing it without the header is refused', async () => {
    assert.equal((await setLimit(30, {})).status, 400);
  });

  test('changing it from another site is refused', async () => {
    assert.equal((await setLimit(30, { 'x-pip': '1', 'sec-fetch-site': 'cross-site' })).status, 403);
  });

  test('changing it takes a POST', async () => {
    assert.equal((await get('/api/cache/limit?gb=30')).status, 405);
  });

  test('clearing the cache leaves the limit alone', async () => {
    await setLimit(32);
    const r = await fetch(BASE + '/api/cache', { method: 'POST', headers: asBrowser({ 'x-pip': '1' }) });
    assert.equal((await r.json()).limit, 32 * GB);
    await setLimit(24);
  });
});

describe('static files', { skip: !ffmpeg && 'no ffmpeg' }, () => {
  test('the page and its three scripts are served', async () => {
    for (const p of ['/', '/app.js', '/i18n.js', '/styles.css'])
      assert.equal((await get(p)).status, 200, p);
  });

  test('a font face is served', async () => {
    const r = await get('/assets/fonts/FixelDisplay/FixelDisplay-Regular.woff2');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'font/woff2');
  });

  test('the font route does not lead out of the font folders', async () => {
    assert.equal((await get('/assets/fonts/FixelDisplay/../server.mjs')).status, 404);
    assert.equal((await get('/assets/fonts/FixelDisplay/nested/face.woff2')).status, 404);
  });

  test('the server itself is not downloadable', async () => {
    assert.equal((await get('/server.mjs')).status, 404);
  });

  test('an unknown address is not found', async () => {
    assert.equal((await get('/nothing/here')).status, 404);
  });
});
