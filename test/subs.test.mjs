/* ═══════════════════════════════════════════════════════════
   Subtitles as a track of the source.

   The beta embed of the synthetic site names a subtitle file the way
   a jwplayer setup does; the general extractor reads it beside the
   streams, the catalog keeps it with the source, resolve() offers it
   with an address of ours, and the address gives WebVTT even when
   the origin holds SRT. A track of thumbnails is not a subtitle.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { start } from '../core/main.mjs';
import { createSub } from '../core/catalog/model.mjs';

let site, lapka, home;
const get = p => fetch(lapka.base + p);

before(async () => {
  const fx = await build();
  site = await startSite({ media: fx.show });
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-subs-'));
  lapka = await start({ port: 0, home });
});
after(async () => {
  if (lapka) await lapka.close();
  if (site) await site.close();
  if (home) await fsp.rm(home, { recursive: true, force: true });
});

describe('a subtitle track', () => {
  test('is known by its address: SRT or WebVTT', () => {
    assert.equal(createSub({ url: 'https://x/a.srt' }).format, 'srt');
    assert.equal(createSub({ url: 'https://x/a.vtt', label: 'English' }).format, 'vtt');
  });
  test('comes out of the embed beside the streams, is offered by resolve() with an address of ours, and that address speaks WebVTT', async () => {
    const r = await (await get(`/api/look?url=${encodeURIComponent(site.base + '/s/select/ep-2')}`)).json();
    const ep = r.series.episodes.find(e => e.number === 2);
    const beta = ep.dubs.flatMap(d => d.sources).find(s => s.player === 'embed/beta');
    assert.equal(beta.subs.length, 1, 'one track, the thumbnails left out');
    assert.deepEqual([beta.subs[0].label, beta.subs[0].lang, beta.subs[0].format], ['Русские', 'ru', 'srt']);
    assert.match(beta.subs[0].play, /^\/api\/stream\/[a-f0-9]{16}\.vtt$/);
    const res = await (await get(`/api/resolve?series=${r.series.id}&episode=2&dub=anilibria`)).json();
    assert.equal(res.subs.length, 1);
    assert.equal(res.subs[0].label, 'Русские');
    const text = await get(res.subs[0].play);
    assert.equal(text.status, 200);
    assert.match(text.headers.get('content-type'), /^text\/vtt/);
    const body = await text.text();
    assert.match(body, /^WEBVTT\n/);
    assert.match(body, /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/);
    assert.doesNotMatch(body, /\d{2}:\d{2}:\d{2},\d{3}/);
  });
  test('a snapshot keeps no track: like a stream, it may be signed', async () => {
    const { toSnapshot } = await import('../core/catalog/snapshot.mjs').catch(() => ({}));
    if (!toSnapshot) return;
    const r = await (await get(`/api/look?url=${encodeURIComponent(site.base + '/s/select/ep-2')}`)).json();
    const snap = toSnapshot(r.series);
    assert.ok(snap.episodes.every(e => e.dubs.every(d => d.sources.every(s => !s.subs || !s.subs.length))));
  });
});
