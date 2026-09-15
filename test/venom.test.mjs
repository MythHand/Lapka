/* ═══════════════════════════════════════════════════════════
   A player whose script holds the playlist of the whole series:
   seasons of episodes, each an HLS with its dubs as audio renditions
   inside and its subtitles beside. VenomPlayer at api.ortified.ws,
   as newdeaf.co embeds it. Read generally: the playlist is matched
   by brackets, the season the embed shows is unfolded into episodes
   × dubs, each dub the same stream at another rendition, and a dub
   switch needs no other stream. Saving such a stream takes the
   picture and the chosen sound. Snapshots: test/snapshots/venom,
   test/snapshots/newdeaf; the multi-audio HLS is a fixture.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discover } from '../core/discover/index.mjs';
import generic, { readPlaylist } from '../core/extract/players/generic.mjs';
import { loadExtractors } from '../core/extract/index.mjs';
import { createLapka } from '../core/lapka.mjs';
import { createSeries, merge } from '../core/catalog/index.mjs';
import { build, haveFfmpeg } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { start } from '../core/main.mjs';

const SNAPS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
const snap = (...p) => fs.readFileSync(path.join(SNAPS, ...p), 'utf8');
const PAGE = 'https://15sep.newdeaf.co/multfilm/5120-arkejn-1-sezon.html';
const EMBED = 'https://api.ortified.ws/embed/movie/51945?season=1&episode=1';
const scriptOf = html => [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(t => /seasons\s*:\s*\[/.test(t));

function fakeSession() {
  const ok = (url, body) => ({ status: 200, url, body, headers: {}, cookies: [] });
  return {
    fetch: async url => {
      const u = new URL(url);
      if (url === PAGE) return ok(url, snap('newdeaf', 'page.html'));
      if (u.hostname === 'api.ortified.ws') return ok(url, u.searchParams.get('episode') === '3' ? snap('venom', 'embed-s1e3.html') : snap('venom', 'embed.html'));
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    },
  };
}

describe('the playlist in the script', () => {
  const pl = readPlaylist(scriptOf(snap('venom', 'embed.html')));
  test('two seasons of nine, each episode with its HLS, six renditions named, a subtitle track', () => {
    assert.deepEqual(pl.seasons.map(s => [s.season, s.episodes.length]), [[1, 9], [2, 9]]);
    assert.deepEqual(pl.current, { season: 1, episode: 1 });
    const e = pl.seasons[0].episodes[0];
    assert.match(e.hls, /master\.m3u8/);
    assert.deepEqual(e.audio.names, ['TVShows', 'Рус. Дублированный', 'LostFilm', 'HDRezka Studio', 'HDRezka Studio (укр)', 'Eng.Original']);
    assert.deepEqual(e.subs.map(s => [s.label, s.format]), [['Рус. полные - 1', 'vtt']]);
    assert.equal(readPlaylist('var x = 1;'), null);
  });
  test('unfolded: the season shown, nine episodes, six dubs each on one stream at its own rendition, with an expiry and subtitles', async () => {
    const got = await generic.unfold(EMBED, { referer: PAGE }, fakeSession());
    assert.equal(got.season, 1);
    assert.deepEqual(got.seasons, [1, 2]);
    assert.equal(got.episodes.length, 9);
    const ep3 = got.episodes.find(e => e.number === 3);
    assert.equal(ep3.dubs.length, 6);
    const lf = ep3.dubs.find(d => d.name === 'LostFilm');
    assert.equal(lf.sources[0].embedUrl, 'https://api.ortified.ws/embed/movie/51945?season=1&episode=3');
    assert.deepEqual(lf.sources[0].streams[0].audio, { index: 2, name: 'LostFilm' });
    assert.equal(lf.sources[0].streams[0].kind, 'hls');
    assert.ok(lf.sources[0].streams[0].expiresAt > Date.now() - 1e12);
    /* the first episode carries a subtitle track, the third none */
    assert.equal(got.episodes.find(e => e.number === 1).dubs[0].sources[0].subs.length, 1);
    assert.equal(lf.sources[0].subs.length, 0);
    /* every dub of an episode is the same HLS */
    assert.equal(new Set(ep3.dubs.map(d => d.sources[0].streams[0].url)).size, 1);
  });
  test('extracted at one episode: its dubs and subtitles', async () => {
    const got = await generic.extract('https://api.ortified.ws/embed/movie/51945?season=1&episode=3', { referer: PAGE }, fakeSession());
    assert.equal(got.dubs.length, 6);
    assert.equal(got.dubs[2].name, 'LostFilm');
    assert.deepEqual(got.dubs[2].streams[0].audio, { index: 2, name: 'LostFilm' });
    const first = await generic.extract(EMBED, { referer: PAGE }, fakeSession());
    assert.equal(first.subs.length, 1);
  });
});

describe('the site around it', () => {
  test('the page: the name without its tail, the season from the address, three players, the second season a part of the franchise', () => {
    const r = discover({ html: snap('newdeaf', 'page.html'), url: PAGE });
    assert.equal(r.title.value, 'Аркейн');
    assert.equal(r.season, 1);
    assert.ok(r.players.some(p => p.id === 'api.ortified.ws') && r.players.some(p => p.id === 'gencit.info'));
    assert.deepEqual(r.franchise.map(f => [f.order, f.self]), [[1, true], [2, false]]);
    assert.match(r.franchise[1].url, /11199-arkejn-2-sezon-subtitry\.html$/);
  });
  test('through look() and resolve(): nine episodes in six dubs; two dubs are one stream at two renditions', async () => {
    /* ids by address, the way the real delivery gives them: one address, one id */
    const ids = new Map();
    const delivery = { register: st => { if (!ids.has(st.url)) ids.set(st.url, 'id' + (ids.size + 1)); return ids.get(st.url); }, get: () => null };
    const lapka = createLapka({ session: fakeSession(), extractors: await loadExtractors(), delivery });
    const r = await lapka.look(PAGE);
    assert.equal(r.series.title, 'Аркейн');
    assert.equal(r.series.episodes.length, 9);
    assert.equal(r.dubs.length, 6, r.dubs.join(','));
    const a = await lapka.resolve({ seriesId: r.series.id, number: 3, dubKey: 'lostfilm' });
    const b = await lapka.resolve({ seriesId: r.series.id, number: 3, dubKey: 'tvshows' });
    assert.equal(a.dub.name, 'LostFilm');
    assert.deepEqual(a.stream.audio, { index: 2, name: 'LostFilm' });
    assert.deepEqual(b.stream.audio, { index: 0, name: 'TVShows' });
    assert.equal(a.stream.id, b.stream.id, 'one stream, two renditions');
    const one = await lapka.resolve({ seriesId: r.series.id, number: 1, dubKey: 'lostfilm' });
    assert.equal(one.subs.length, 1);
  });
});

describe('the qualities inside one HLS', () => {
  test('the master names the variants; the menu offers them as qualities of the dub, one level each', async () => {
    const master = snap('venom', 'master.m3u8');
    const ids = new Map();
    const delivery = { register: st => { if (!ids.has(st.url)) ids.set(st.url, 'id' + (ids.size + 1)); return ids.get(st.url); }, get: id => ({ id, stream: {} }), playlist: async () => master };
    const lapka = createLapka({ session: fakeSession(), extractors: await loadExtractors(), delivery });
    assert.deepEqual(lapka.levelsOfMaster(master), ['720p', '360p']);
    const r = await lapka.look(PAGE);
    const ep = await lapka.openEpisode(r.series.id, 2);
    await lapka.levelsOf(ep);
    const dubs = lapka.dubsOf(ep);
    const lf = dubs.find(d => d.key === 'lostfilm');
    assert.deepEqual(lf.qualities.map(q => [q.quality, q.level]), [['720p', true], ['360p', true]]);
    assert.equal(new Set(lf.qualities.map(q => q.id)).size, 1, 'both are the one stream');
  });
});

describe('saving with the sound of its own', { skip: !(await haveFfmpeg()) && 'ffmpeg not installed' }, () => {
  let site, lapka, home;
  const get = p => fetch(lapka.base + p);
  const post = p => fetch(lapka.base + p, { method: 'POST', headers: { 'x-lapka': '1' } });
  const probe = file => new Promise((ok, bad) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:stream_tags=language', '-of', 'csv=p=0', file], (e, out) => e ? bad(e) : ok(out.trim().split('\n'))));
  before(async () => {
    const fx = await build();
    site = await startSite({ media: fx.show });
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-audio-'));
    lapka = await start({ port: 0, home });
  });
  after(async () => { if (lapka) await lapka.close(); if (site) await site.close(); if (home) await fsp.rm(home, { recursive: true, force: true }); });

  test('the master names an audio group: the chosen rendition is muxed with the picture', async () => {
    const s = createSeries({ sourceUrl: site.base + '/s/audio/' });
    merge(s, { origin: 'test', series: { title: 'Two Voices' }, episodes: [{ number: 1, dubs: [
      { name: 'Studio One', sources: [{ player: 'own', embedUrl: site.base + '/embed/audio', streams: [{ kind: 'hls', url: site.base + '/media/hls-audio/master.m3u8', audio: { index: 1, name: 'Original' } }] }] },
    ] }] });
    s.episodes[0].opened = true;
    lapka.lapka.adopt(s);
    const st = s.episodes[0].dubs[0].sources[0].streams[0];
    assert.ok(st.id && st.play);
    const master = await (await get(st.play)).text();
    assert.match(master, /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="\/api\/stream\//, 'the renditions go through us too');
    let job = await (await post(`/api/save?stream=${st.id}`)).json();
    for (let i = 0; i < 300 && job.state === 'working'; i++) { await new Promise(r => setTimeout(r, 100)); job = await (await get(`/api/save/${job.id}`)).json(); }
    assert.equal(job.state, 'done', job.error);
    const streams = await probe(job.file);
    assert.ok(streams.some(l => l.startsWith('video')), streams.join(' | '));
    assert.ok(streams.some(l => /^audio,eng/.test(l)), 'the second rendition, English, is the sound: ' + streams.join(' | '));
  });
});
