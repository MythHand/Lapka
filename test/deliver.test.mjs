/* ═══════════════════════════════════════════════════════════
   Delivery: a stream from the synthetic site, through Lapka's own
   server, into a cache folder of its own.

   Guarded: the playlist comes back with every address pointing at
   Lapka; a segment passes through once and is served from disk the
   second time; nothing outside the stream's playlist is fetched; an
   mp4 range request comes back byte-exact; the cache keeps under its
   limit and never drops what is being watched.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, haveFfmpeg } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { start } from '../core/main.mjs';
import { openStore, HOT_MS } from '../core/store/index.mjs';

const ffmpeg = await haveFfmpeg();
let site, lapka, home;
const get = (p, headers = {}) => fetch(lapka.base + p, { headers });

before(async () => {
  if (!ffmpeg) return;
  const fx = await build();
  site = await startSite({ media: fx.show });
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-home-'));
  lapka = await start({ port: 0, home });
});
after(async () => {
  if (lapka) await lapka.close();
  if (site) await site.close();
  if (home) await fsp.rm(home, { recursive: true, force: true });
});

describe('delivery', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  let hls, mp4;

  test('look() hands out an address per stream', async () => {
    const r = await (await get(`/api/look?url=${encodeURIComponent(site.base + '/s/select/ep-1')}`)).json();
    const ep = r.series.episodes.find(e => e.number === 1);
    const al = ep.dubs.find(d => d.key === 'anilibria');
    mp4 = al.sources.find(s => s.player === 'embed/alpha').streams[0];
    hls = al.sources.find(s => s.player === 'embed/beta').streams[0];
    assert.match(mp4.play, /^\/api\/stream\/[a-f0-9]{16}\.mp4$/);
    assert.match(hls.play, /^\/api\/stream\/[a-f0-9]{16}\.m3u8$/);
  });

  test('the playlist points every segment back at Lapka', async () => {
    const r = await get(hls.play);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /mpegurl/);
    const text = await r.text();
    const segs = text.split('\n').filter(l => l && !l.startsWith('#'));
    assert.equal(segs.length, 3);
    for (const s of segs) assert.match(s, new RegExp(`^/api/stream/${hls.id}/seg\\?u=`));
    assert.ok(!text.includes(site.base), 'no origin address leaks into the playlist');
    hls.first = segs[0];
  });

  test('a segment passes through once, then comes from disk', async () => {
    const a = await get(hls.first);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('content-type'), 'video/mp2t');
    assert.equal(a.headers.get('x-lapka-cache'), 'miss');
    const bytes = Buffer.from(await a.arrayBuffer());
    assert.ok(bytes.length > 1000);
    await new Promise(r => setTimeout(r, 50));
    const b = await get(hls.first);
    assert.equal(b.headers.get('x-lapka-cache'), 'hit');
    assert.equal(Buffer.compare(bytes, Buffer.from(await b.arrayBuffer())), 0);
    const files = await fsp.readdir(lapka.store.cache.dirFor(hls.id));
    assert.ok(files.some(f => f.endsWith('.ts')) && files.some(f => f.endsWith('.m3u8')), files.join(','));
  });

  test('nothing outside the playlist is fetched', async () => {
    const r = await get(`/api/stream/${hls.id}/seg?u=${encodeURIComponent(site.base + '/media/native.mp4')}`);
    assert.equal(r.status, 403);
    const s = await get(`/api/stream/${hls.id}/seg?u=${encodeURIComponent('http://127.0.0.1:1/x.ts')}`);
    assert.equal(s.status, 403);
    assert.equal((await get('/api/stream/0000000000000000.m3u8')).status, 404);
  });

  test('an mp4 range comes back byte-exact', async () => {
    const whole = Buffer.from(await (await fetch(site.base + '/media/native.mp4')).arrayBuffer());
    const r = await get(mp4.play, { range: 'bytes=100-199' });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), `bytes 100-199/${whole.length}`);
    const part = Buffer.from(await r.arrayBuffer());
    assert.equal(part.length, 100);
    assert.equal(Buffer.compare(part, whole.subarray(100, 200)), 0);
    const full = await get(mp4.play);
    assert.equal(full.status, 200);
    assert.equal(Number(full.headers.get('content-length')), whole.length);
  });

  test('the play page and the library it needs are served', async () => {
    assert.equal((await get('/play.html')).status, 200);
    const js = await get('/vendor/hls.min.js');
    assert.equal(js.status, 200);
    assert.ok((await js.text()).length > 100000);
  });
});

describe('the cache', () => {
  test('keeps under its limit, oldest first, never what is being watched', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-cache-'));
    const store = await openStore({ home: dir, limitGb: 1 });
    assert.equal(store.cache.limit(), 1024 ** 3);
    const big = Buffer.alloc(300 * 1024);
    for (const id of ['old', 'mid', 'new']) { await store.cache.write(id, 'seg00.ts', big); await new Promise(r => setTimeout(r, 20)); }
    const past = new Date(Date.now() - 2 * HOT_MS);
    for (const id of ['old', 'mid']) await fsp.utimes(store.cache.fileFor(id, 'seg00.ts'), past, past);
    /* room for two: the oldest goes, but only once it is cold */
    let r = await store.cache.evict({ limit: 2 * big.length });
    assert.deepEqual(r.dropped, [], 'everything was just written, all of it is hot');
    r = await store.cache.evict({ limit: 2 * big.length, now: Date.now() + 2 * HOT_MS });
    assert.deepEqual(r.dropped, ['old']);
    assert.equal(r.bytes, 2 * big.length);
    /* later, 'new' is being watched: with room for one, 'mid' goes and 'new' stays */
    const later = Date.now() + 3 * HOT_MS;
    store.cache.touch('new', later);
    r = await store.cache.evict({ limit: big.length, now: later });
    assert.deepEqual(r.dropped, ['mid']);
    assert.equal((await store.cache.stat()).streams, 1);
    assert.ok(await store.cache.has('new', 'seg00.ts'));
    await fsp.rm(dir, { recursive: true, force: true });
  });
});
