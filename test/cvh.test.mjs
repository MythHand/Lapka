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
import cvh, { readEmbed, readModule, readWrapper } from '../core/extract/players/cvh.mjs';
import { loadExtractors, extractorFor } from '../core/extract/index.mjs';

/* the snapshots of real pages are kept outside the repository: without them this file is skipped as a whole */
const SNAPSHOTS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
if (!fs.existsSync(SNAPSHOTS_ROOT)) describe('CVH', { skip: 'the snapshots of real pages are kept outside the repository' }, () => {});
else {

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
    assert.deepEqual(readEmbed(EMBED), { titleId: '30831', episode: 2, season: null, voice: 'AnilibriaTV', publisher: null, aggregator: null });
  });
  test('a wrapper page of a site\'s own names everything in attributes', () => {
    const w = readWrapper(fs.readFileSync(path.join(SNAP, '..', 'animego', 'cdn-iframe.html'), 'utf8'));
    assert.deepEqual(w, { titleId: '60636', episode: 1, season: null, voice: 'Jam Club', publisher: 747, aggregator: 'mali' });
    assert.equal(readWrapper('<html></html>'), null);
    assert.ok(cvh.match('https://animego.me/cdn-iframe/60636/Jam%20Club/4/1'));
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

}

/* a title of several seasons in one player, as a <video-player> on a page names it; no snapshots needed */
describe('CVH unfolded', () => {
  const ELEMENT = 'https://player.cdnvideohub.com/embed?title_id=178707&pub=15&aggr=kp';
  const item = (season, episode, voiceStudio, voiceType = 'Дубляж') => ({ cvhId: `${season}-${episode}-${voiceStudio}`, vkId: `${season}${episode}${voiceStudio.length}`, voiceStudio, voiceType, season, episode });
  const playlist = { titleName: 'Show', isSerial: true, items: [item(1, 1, 'LostFilm'), item(1, 1, 'NovaFilm'), item(1, 2, 'LostFilm'), item(2, 1, 'LostFilm'), item(2, 1, 'Субтитры', 'Субтитры'), item(2, 2, 'LostFilm')] };
  const session = () => {
    const asked = [];
    return { asked, fetch: async (url, opts = {}) => {
      asked.push(url);
      const u = new URL(url);
      if (u.pathname === '/api/v1/player/sv/playlist') return { status: 200, url, body: JSON.stringify(playlist), headers: {}, cookies: [] };
      if (u.pathname.startsWith('/api/v1/player/sv/video/')) return { status: 200, url, body: JSON.stringify({ duration: 100, sources: { hlsUrl: 'https://cdn.test/' + u.pathname.split('/').pop() + '/index.m3u8', mpegHighUrl: 'https://cdn.test/720.mp4' } }), headers: {}, cookies: [] };
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    } };
  };
  test('the first season with every voice as a dub, and the seasons there are', async () => {
    const s = session();
    const got = await cvh.unfold(ELEMENT, {}, s);
    assert.deepEqual(got.seasons, [1, 2]);
    assert.equal(got.season, 1);
    assert.deepEqual(got.episodes.map(e => [e.number, e.dubs.map(d => d.name)]), [[1, ['LostFilm', 'NovaFilm']], [2, ['LostFilm']]]);
    assert.match(got.episodes[0].dubs[1].sources[0].embedUrl, /season=1&episode=1&voice=NovaFilm$/);
    assert.equal(s.asked.filter(u => /playlist/.test(u)).length, 1, 'the ids in the address: no page to fetch');
  });
  test('the season the address names; a subtitle voice is a sub; a source plays through the playlist kept', async () => {
    const s = session();
    const got = await cvh.unfold(ELEMENT + '&season=2', {}, s);
    assert.equal(got.season, 2);
    assert.deepEqual(got.episodes[0].dubs.map(d => [d.name, d.kind]), [['LostFilm', 'dub'], ['Субтитры', 'sub']]);
    const r = await cvh.extract(got.episodes[1].dubs[0].sources[0].embedUrl, {}, s);
    assert.match(r.streams[0].url, /\/22\d+\/index\.m3u8$/);
    assert.equal(s.asked.filter(u => /playlist/.test(u)).length, 0, 'the playlist of a minute ago is kept');
  });
  test('a single video unfolds to nothing; an embed at an episode is that episode alone', async () => {
    const one = { fetch: async url => ({ status: 200, url, body: JSON.stringify({ isSerial: false, items: [item(1, 1, 'X')] }), headers: {}, cookies: [] }) };
    assert.equal(await cvh.unfold('https://player.cdnvideohub.com/embed?title_id=9&pub=1&aggr=kp', {}, one), null);
    assert.equal(await cvh.unfold(ELEMENT + '&episode=3', {}, session()), null);
  });
});
