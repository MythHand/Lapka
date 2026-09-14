/* ═══════════════════════════════════════════════════════════
   The stream reaches a real browser.

   Chrome, headless, opens the play page for a stream of the synthetic
   site served through Lapka and reports what the video element got.
   mp4 through the range proxy has to buffer. HLS through hls.js has
   to parse the playlist and pull its segments through Lapka, which is
   as far as a headless browser under a virtual clock goes: decoding
   through MediaSource happens on real time, so it is looked at by eye.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, haveFfmpeg } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { start } from '../core/main.mjs';
import { visit, findChrome } from './browser.mjs';

const ffmpeg = await haveFfmpeg();
const chrome = !!findChrome();
let site, lapka, home, hls, mp4;

before(async () => {
  if (!ffmpeg || !chrome) return;
  const fx = await build();
  site = await startSite({ media: fx.show });
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-home-'));
  lapka = await start({ port: 0, home });
  const { series } = await lapka.lapka.look(site.base + '/s/select/ep-1');
  const al = series.episodes.find(e => e.number === 1).dubs.find(d => d.key === 'anilibria');
  hls = al.sources.find(s => s.player === 'embed/beta').streams[0];
  mp4 = al.sources.find(s => s.player === 'embed/alpha').streams[0];
});
after(async () => {
  if (lapka) await lapka.close();
  if (site) await site.close();
  if (home) await fsp.rm(home, { recursive: true, force: true });
});

describe('playback in a browser', { skip: (!ffmpeg && 'ffmpeg not installed') || (!chrome && 'no Chrome found') }, () => {
  test('hls.js takes the playlist and pulls the segments through Lapka', async () => {
    const r = await visit(`${lapka.base}/play.html?stream=${hls.id}&kind=hls&probe=4000`, { budget: 12000 });
    assert.equal(r.error, null, r.status);
    assert.match(r.status, /HLS через Lapka/);
    const files = await fsp.readdir(lapka.store.cache.dirFor(hls.id));
    assert.ok(files.filter(f => f.endsWith('.ts')).length >= 1, `segments in cache: ${files.join(',')}`);
  });

  test('mp4 buffers through Lapka', async () => {
    const r = await visit(`${lapka.base}/play.html?stream=${mp4.id}&kind=mp4&probe=3000`, { budget: 10000 });
    assert.equal(r.error, null, r.status);
    assert.ok(r.buffered > 0.5, `buffered ${r.buffered}s`);
  });
});
