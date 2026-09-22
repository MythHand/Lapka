/* ═══════════════════════════════════════════════════════════
   Extractors, and the whole way from an address to streams.

   The synthetic site is started for real: embeds are fetched through
   the session the way they will be. What is guarded: a player the
   page named a dub for gets its stream under that dub; a player with
   its own dub switch brings its dubs, and the studio both players
   carry ends up as one dub with two live sources; a dead embed is
   marked dead and named in the steps; the registry puts generic last.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { build, haveFfmpeg } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { bootLapka } from '../core/lapka.mjs';
import { loadExtractors, extractorFor, closedDoor } from '../core/extract/index.mjs';
import generic from '../core/extract/players/generic.mjs';
import { createSession } from '../core/session/index.mjs';

const ffmpeg = await haveFfmpeg();
let site, lapka;

before(async () => {
  if (!ffmpeg) return;
  const fx = await build();
  site = await startSite({ media: fx.show });
  lapka = await bootLapka();
});
after(async () => { if (site) await site.close(); });

describe('the registry', () => {
  test('loads the folder and keeps generic last', async () => {
    const list = await loadExtractors();
    assert.ok(list.length >= 1);
    assert.equal(list[list.length - 1].name, 'generic');
    assert.equal(extractorFor(list, 'https://anything.example/embed/1').name, 'generic');
  });
  test('refuses a file that is not an extractor', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-x-'));
    await fsp.writeFile(path.join(dir, 'broken.mjs'), 'export default { name: "broken" }');
    await assert.rejects(loadExtractors(dir), /missing/);
    await fsp.rm(dir, { recursive: true, force: true });
  });
});

describe('the generic extractor', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  test('a <video src> embed: one stream, referer kept for delivery', async () => {
    const got = await generic.extract(`${site.base}/embed/alpha/links-1-anilibria`, { referer: `${site.base}/s/links/ep-1` }, createSession());
    assert.deepEqual(got.dubs, []);
    assert.equal(got.streams.length, 1);
    assert.equal(got.streams[0].kind, 'mp4');
    assert.equal(got.streams[0].url, `${site.base}/media/native.mp4`);
    assert.equal(got.streams[0].headers.referer, `${site.base}/embed/alpha/links-1-anilibria`);
  });
  test('an embed with its own dub list in a script: dubs with streams', async () => {
    const got = await generic.extract(`${site.base}/embed/beta/select-2`, {}, createSession());
    assert.deepEqual(got.dubs.map(d => d.name), ['AniLibria', 'AniDub', 'JAM']);
    assert.equal(got.dubs[0].streams[0].kind, 'hls');
    assert.equal(got.dubs[0].streams[0].url, `${site.base}/media/hls/index.m3u8`);
  });
  test('JavaScript object literals, not only JSON', async () => {
    const html = `<html><body><script>var p = { file: '/v/720.mp4', title: 'Dream Cast', }; var q = {file:"//cdn.example/x/1080.m3u8",name:"JAM"};</script></body></html>`;
    const session = { fetch: async () => ({ status: 200, url: 'https://e.example/embed/1', body: html, headers: {} }) };
    const got = await generic.extract('https://e.example/embed/1', {}, session);
    assert.deepEqual(got.dubs.map(d => [d.name, d.streams[0].url, d.streams[0].quality]),
      [['Dream Cast', 'https://e.example/v/720.mp4', '720p'], ['JAM', 'https://cdn.example/x/1080.m3u8', '1080p']]);
  });
});

describe('from an address to streams', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  test('dub tabs on the page: every dub gets its stream', async () => {
    const { series, steps } = await lapka.look(`${site.base}/s/links/ep-2`);
    const ep = series.episodes.find(e => e.number === 2);
    assert.deepEqual(ep.dubs.map(d => [d.name, d.sources.length, d.sources[0].streams[0]?.kind, d.sources[0].health.ok]),
      [['AniLibria', 1, 'mp4', true], ['AniDub', 1, 'mp4', true]]);
    assert.equal(ep.dubs[0].sources[0].extractor, 'generic');
    assert.ok(steps.some(s => s.startsWith('Открыла 2 плеера')), steps.join(' | '));
  });

  test('two players, one studio in both: one dub, two live sources', async () => {
    const { series, dubs, opened } = await lapka.look(`${site.base}/s/select/ep-1`);
    const ep = series.episodes.find(e => e.number === 1);
    assert.deepEqual(dubs, ['AniLibria', 'Dream Cast', 'AniDub', 'JAM']);
    const al = ep.dubs.find(d => d.key === 'anilibria');
    assert.deepEqual(al.sources.map(s => [s.player, s.streams[0].kind, s.health.ok]), [['embed/alpha', 'mp4', true], ['embed/beta', 'hls', true]]);
    assert.equal(ep.dubs.find(d => d.key === 'jam').sources[0].player, 'embed/beta');
    assert.deepEqual(opened.map(o => [o.player, o.streams]).sort(), [['embed/alpha', 1], ['embed/alpha', 1], ['embed/beta', 3]]);
    /* the other episodes are known but not opened yet */
    assert.deepEqual(series.episodes.find(e => e.number === 3).dubs, []);
  });

  test('a stream on the page needs no extractor', async () => {
    const { series, opened } = await lapka.look(`${site.base}/s/video/ep-2`);
    assert.deepEqual(opened, []);
    const ep = series.episodes.find(e => e.number === 2);
    assert.equal(ep.dubs[0].sources[0].streams[0].kind, 'hls');
  });

  test('a dead embed is marked dead and said so', async () => {
    const html = `<html><head><title>X — 1 серия</title></head><body><h1>X — 1 серия</h1>
      <div class="tabs"><button data-embed="${site.base}/embed/alpha/links-1-anilibria">AniLibria</button><button data-embed="${site.base}/embed/alpha/links-1-nobody">Ghost Studio</button></div>
      <iframe src="${site.base}/embed/alpha/links-1-anilibria"></iframe></body></html>`;
    const real = createSession();
    const session = { fetch: async (url, o) => url === 'https://dead.example/x/ep-1' ? { status: 200, url, body: html, headers: {} } : real.fetch(url, o) };
    const l = await bootLapka({ session });
    const { series, steps } = await l.look('https://dead.example/x/ep-1');
    const ep = series.episodes.find(e => e.number === 1);
    const ghost = ep.dubs.find(d => d.name === 'Ghost Studio');
    assert.equal(ghost.sources[0].health.ok, false);
    assert.match(ghost.sources[0].health.error, /404/);
    assert.equal(ep.dubs.find(d => d.key === 'anilibria').sources[0].health.ok, true);
    assert.ok(steps.some(s => s.startsWith('Открыла 1 из 2')), steps.join(' | '));
  });
});

/* ── Sibnet: no extractor of its own, the generic one reads it ── */
describe('the generic extractor on a Sibnet embed', { skip: !existsSync(new URL('./snapshots/sibnet/embed.html', import.meta.url)) && 'the snapshots of real pages are kept outside the repository' }, () => {
  test('finds the mp4 in the script and keeps the embed as the referer', async () => {
    const fs = await import('node:fs');
    const html = fs.readFileSync(new URL('./snapshots/sibnet/embed.html', import.meta.url), 'utf8');
    const session = { fetch: async url => ({ status: 200, url, body: html, headers: {}, cookies: [] }) };
    const got = await generic.extract('https://video.sibnet.ru/shell.php?videoid=3647476', { referer: 'https://old.yummyani.me/' }, session);
    assert.equal(got.streams.length, 1);
    assert.equal(got.streams[0].kind, 'mp4');
    assert.match(got.streams[0].url, /^https:\/\/video\.sibnet\.ru\/v\/[a-f0-9]+\/3647476\.mp4$/);
    assert.equal(got.streams[0].headers.referer, 'https://video.sibnet.ru/shell.php?videoid=3647476');
  });
});

describe('closed doors', () => {
  test('a player behind a door known to be closed is refused without a request, with the reason', () => {
    assert.match(closedDoor('https://www.youtube.com/embed/abc?autoplay=1'), /закрытая дверь/);
    assert.match(closedDoor('https://youtu.be/abc'), /закрытая дверь/);
    assert.equal(closedDoor('https://kodik.info/serial/1/abc/720p'), null);
    assert.equal(closedDoor('not a url'), null);
  });
});
