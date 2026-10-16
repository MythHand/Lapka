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
import { createDelivery } from '../core/deliver/index.mjs';
import http from 'node:http';

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
    /* the page's timeline asks what is on the disk: the first piece as a stretch from the start */
    const disk = await (await get(`/api/stream/${hls.id}/cached`)).json();
    assert.equal(disk.ranges.length, 1);
    assert.equal(disk.ranges[0][0], 0);
    assert.ok(disk.ranges[0][1] > 0 && disk.duration > disk.ranges[0][1], JSON.stringify(disk));
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

/* ── the same episode at an address signed anew ── */
describe('a stream under a changing address', () => {
  test('the episode keeps its id and its pieces when its address is signed anew; another quality is another stream', async () => {
    /* an origin that serves the same clip under any signature in the path */
    const srv = http.createServer((req, res) => {
      const m = /^\/(\w+)\/(index\.m3u8|seg-(\d)\.ts)$/.exec(req.url);
      if (!m) { res.writeHead(404); return res.end(); }
      if (m[2] === 'index.m3u8') { res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg-1.ts\n#EXTINF:6,\nseg-2.ts\n#EXT-X-ENDLIST\n'); }
      res.writeHead(200, { 'content-type': 'video/mp2t' }); res.end(`bytes of ${m[1]} ${m[3]}`);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const kept = new Map();
    const cache = { has: async (id, n) => kept.has(`${id}/${n}`), read: async (id, n) => kept.get(`${id}/${n}`), write: async (id, n, b) => { kept.set(`${id}/${n}`, Buffer.from(b)); }, touch() {} };
    const delivery = createDelivery({ session: { ua: 'test' }, cache });
    const meta = { seriesId: 's1', episode: 3, dub: 'anidub', sourceId: 'src1' };
    const firstSeg = async id => { const pl = await delivery.playlist(delivery.get(id)); return decodeURIComponent(/u=(\S+)/.exec(pl)[1]); };
    try {
      const id = delivery.register({ kind: 'hls', url: `${base}/sigA/index.m3u8`, quality: '720p', headers: {} }, meta);
      const seg = await firstSeg(id);
      assert.equal((await delivery.piece(delivery.get(id), seg)).hit, false);
      assert.equal((await delivery.piece(delivery.get(id), seg)).hit, true);
      assert.equal(delivery.nameFor(delivery.get(id), seg), 'main-0.ts', 'named by its place, not its address');
      /* read again, signed anew: the same episode, another address */
      const again = delivery.register({ kind: 'hls', url: `${base}/sigB/index.m3u8`, quality: '720p', headers: {} }, meta);
      assert.equal(again, id, 'the id is the episode’s, not the address’s');
      assert.equal(delivery.get(id).stream.url, `${base}/sigB/index.m3u8`, 'the fresh address is the one asked from now on');
      const seg2 = await firstSeg(id);
      assert.notEqual(seg2, seg);
      const got = await delivery.piece(delivery.get(id), seg2);
      assert.equal(got.hit, true, 'the piece is found by its place');
      assert.equal(String(got.bytes), 'bytes of sigA 1', 'what was kept under the first address');
      /* what is on the disk, as stretches of the timeline: the first piece, six seconds of twelve */
      assert.deepEqual(await delivery.cached(delivery.get(id)), { ranges: [[0, 6]], duration: 12, tag: 'main' });
      const pl2 = await delivery.playlist(delivery.get(id));
      await delivery.piece(delivery.get(id), decodeURIComponent(/u=(\S+)/.exec(pl2.split('\n').filter(l => l.includes('seg?u=')).pop())[1]));
      assert.deepEqual((await delivery.cached(delivery.get(id))).ranges, [[0, 12]], 'two pieces side by side are one stretch');
      /* the trace tells who asked for what and who answered: the origin the first time, the disk after */
      const trace = delivery.trace(delivery.get(id));
      assert.deepEqual(trace.filter(r => r.name === 'main-0.ts').map(r => [r.who, r.from]), [['play', 'origin'], ['play', 'disk'], ['play', 'disk']]);
      assert.ok(trace.every(r => typeof r.ms === 'number' && r.at > 0));
      /* another quality of the same source is another stream; the same quality twice is told apart by order */
      assert.notEqual(delivery.register({ kind: 'hls', url: `${base}/sigB/index.m3u8`, quality: '480p', headers: {} }, meta), id);
      assert.notEqual(delivery.register({ kind: 'hls', url: `${base}/sigC/index.m3u8`, quality: '720p', headers: {} }, { ...meta, nth: 1 }), id);
    } finally { srv.close(); }
  });

  test('another cut under the same name of quality drops what was on the disk of the stream', async () => {
    /* an origin whose "720" served one file one night and another the next: the pieces are named otherwise */
    const srv = http.createServer((req, res) => {
      const m = /^\/(\w+)\/(index\.m3u8|(\w+)-(\d)\.ts)$/.exec(req.url);
      if (!m) { res.writeHead(404); return res.end(); }
      if (m[2] === 'index.m3u8') {
        const stem = m[1] === 'night' ? '480' : '720';
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        return res.end(`#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n${stem}-1.ts\n#EXTINF:6,\n${stem}-2.ts\n#EXT-X-ENDLIST\n`);
      }
      res.writeHead(200, { 'content-type': 'video/mp2t' }); res.end(`bytes of ${m[3]} ${m[4]}`);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const kept = new Map();
    const cache = {
      has: async (id, n) => kept.has(`${id}/${n}`), read: async (id, n) => { if (!kept.has(`${id}/${n}`)) throw new Error('none'); return kept.get(`${id}/${n}`); },
      write: async (id, n, b) => { kept.set(`${id}/${n}`, Buffer.from(b)); }, touch() {},
      drop: async id => { for (const k of [...kept.keys()]) if (k.startsWith(`${id}/`)) kept.delete(k); },
    };
    const delivery = createDelivery({ session: { ua: 'test' }, cache });
    const meta = { seriesId: 's1', episode: 5, dub: 'anilibria', sourceId: 'src1' };
    const segsOf = async id => { const pl = await delivery.playlist(delivery.get(id)); return pl.split('\n').filter(l => l.includes('seg?u=')).map(l => decodeURIComponent(/u=(\S+)/.exec(l)[1])); };
    try {
      const id = delivery.register({ kind: 'hls', url: `${base}/night/index.m3u8`, quality: '720p', headers: {} }, meta);
      const [a1, a2] = await segsOf(id);
      await delivery.piece(delivery.get(id), a1); await delivery.piece(delivery.get(id), a2);
      assert.deepEqual((await delivery.cached(delivery.get(id))).ranges, [[0, 12]], 'the whole night cut is on the disk');
      /* read anew the next day: the same id, the same name of quality, another cut */
      assert.equal(delivery.register({ kind: 'hls', url: `${base}/day/index.m3u8`, quality: '720p', headers: {} }, meta), id);
      const [b1] = await segsOf(id);
      assert.deepEqual((await delivery.cached(delivery.get(id))).ranges, [], 'the night pieces are gone: they would not join the day ones');
      const got = await delivery.piece(delivery.get(id), b1);
      assert.equal(got.hit, false); assert.equal(String(got.bytes), 'bytes of 720 1');
      assert.equal(delivery.nameFor(delivery.get(id), b1), 'main-0.ts', 'the day cut takes the places from the start');
      assert.ok(await cache.has(id, 'main-0.ts'));
      const dropped = delivery.trace(delivery.get(id)).find(r => r.from === 'dropped');
      assert.ok(dropped && /another cut: 2 pieces of main dropped/.test(dropped.err), 'the trace says what went and why');
      /* the same day cut read once more, signed anew: nothing is dropped */
      assert.equal(delivery.register({ kind: 'hls', url: `${base}/day2/index.m3u8`, quality: '720p', headers: {} }, meta), id);
      await segsOf(id);
      assert.ok(await cache.has(id, 'main-0.ts'), 'the same cut under a fresh signature keeps its pieces');
      assert.equal(delivery.trace(delivery.get(id)).filter(r => r.from === 'dropped').length, 1);
    } finally { srv.close(); }
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
