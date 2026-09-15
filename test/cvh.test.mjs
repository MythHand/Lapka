/* ═══════════════════════════════════════════════════════════
   The CVH extractor, on saved answers of the cdnvideohub API.

   The embed page and its script are the real ones, and so are the
   playlist and the video answers, with their signatures scrubbed.
   Guarded: the embed's query is read right; the publisher and the
   aggregator come out of the script; the wanted voice and episode
   are picked from the playlist; the video answer becomes an HLS
   stream and mp4 streams by quality with an expiry.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cvh, { readEmbed, readModule } from '../core/extract/players/cvh.mjs';
import { loadExtractors, extractorFor } from '../core/extract/index.mjs';

const SNAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'cvh');
const snap = f => fs.readFileSync(path.join(SNAP, f), 'utf8');
const EMBED = 'https://ru.yummyani.me/iframeCVH.html?dubbing_code=AnilibriaTV&anime_id=30831&episode=2&dubbing=%D0%9E%D0%B7%D0%B2%D1%83%D1%87%D0%BA%D0%B0+AniLibria';

function fakeSession() {
  const asked = [];
  return {
    asked,
    fetch: async (url, opts = {}) => {
      asked.push({ url, ...opts });
      const u = new URL(url);
      if (u.pathname === '/iframeCVH.html') return { status: 200, url, body: snap('iframeCVH.html'), headers: {}, cookies: [] };
      if (/players-cvh.*\.js$/.test(u.pathname)) return { status: 200, url, body: snap('module.js'), headers: {}, cookies: [] };
      if (u.pathname === '/api/v1/player/sv/playlist') return { status: 200, url, body: snap('api-playlist.json'), headers: {}, cookies: [] };
      if (u.pathname.startsWith('/api/v1/player/sv/video/')) return { status: 200, url, body: snap('api-video.json'), headers: {}, cookies: [] };
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    },
  };
}

describe('reading CVH', () => {
  test('the embed says the title, the episode and the voice', () => {
    assert.deepEqual(readEmbed(EMBED), { titleId: '30831', episode: 2, season: null, voice: 'AnilibriaTV' });
  });
  test('the publisher and the aggregator come from the script', () => {
    assert.deepEqual(readModule(snap('module.js')), { publisher: 745, aggregator: 'mali' });
    assert.deepEqual(readModule('nothing'), { publisher: 745, aggregator: 'mali' });
  });
  test('the registry knows it', async () => {
    const list = await loadExtractors();
    assert.equal(extractorFor(list, EMBED).name, 'cvh');
    assert.equal(extractorFor(list, 'https://player.cdnvideohub.com/s2/v2.18.4/frame?x=1').name, 'cvh');
  });
});

describe('extracting from CVH', () => {
  test('asks the playlist, picks the voice and the episode, asks the video, returns the qualities', async () => {
    const session = fakeSession();
    const got = await cvh.extract(EMBED, { referer: 'https://old.yummyani.me/' }, session);
    const pl = session.asked.find(a => a.url.includes('/player/sv/playlist'));
    const q = new URL(pl.url).searchParams;
    assert.equal(q.get('pub'), '745'); assert.equal(q.get('id'), '30831'); assert.equal(q.get('aggr'), 'mali');
    const items = JSON.parse(snap('api-playlist.json')).items;
    const wanted = items.find(i => i.episode === 2 && i.voiceStudio === 'AnilibriaTV');
    const vid = session.asked.find(a => a.url.includes('/player/sv/video/'));
    assert.ok(vid.url.endsWith('/' + wanted.vkId), 'the video of episode 2 in the wanted voice');
    const hls = got.streams.find(s => s.kind === 'hls');
    assert.match(hls.url, /okcdn\.ru\/video\.m3u8/);
    assert.equal(hls.headers.referer, 'https://player.cdnvideohub.com/');
    assert.ok(hls.expiresAt > Date.now());
    const mp4 = got.streams.filter(s => s.kind === 'mp4').map(s => s.quality);
    assert.ok(mp4.includes('720p') && mp4.includes('480p') && mp4.includes('360p'), mp4.join(','));
    assert.equal(got.duration, 1440);
  });
  test('an episode the player lacks is an error', async () => {
    await assert.rejects(cvh.extract(EMBED.replace('episode=2', 'episode=99'), {}, fakeSession()), /no such episode/);
  });
});
