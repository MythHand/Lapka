/* ═══════════════════════════════════════════════════════════
   Site adapters, on saved answers.

   The aniliberty adapter reads the site's own API. A session that
   answers from the snapshots stands in for the network: every link
   form of the release (any tab, no tab), a link to one episode, and
   what the whole look() makes of it together with the general reading
   of the page.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSites, siteFor } from '../core/sites/index.mjs';
import { loadProfiles, profileFor } from '../core/knowledge/index.mjs';
import { createLapka } from '../core/lapka.mjs';
import aniliberty from '../core/sites/aniliberty.mjs';
import yummyani, { dubOf, playerOf } from '../core/sites/yummyani.mjs';

/* the snapshots of real pages are kept outside the repository: without them this file is skipped as a whole */
const SNAPSHOTS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
if (!fs.existsSync(SNAPSHOTS_ROOT)) describe('the site adapters', { skip: 'the snapshots of real pages are kept outside the repository' }, () => {});
else {

const SNAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'aniliberty');
const snap = f => fs.readFileSync(path.join(SNAP, f), 'utf8');
const SITE = 'https://aniliberty.top';
const REL = `${SITE}/anime/releases/release/re-creators`;
const UUID = '95b4eca9-789e-11ec-ae92-0242ac120002';

/* what the snapshots can answer; anything else is a 404 */
const session = {
  fetch: async url => {
    const u = new URL(url);
    const p = u.pathname;
    let body = null;
    if (p === '/api/v1/anime/releases/re-creators') body = snap('api-release.json');
    else if (p === '/api/v1/anime/releases/kono-subarashii-sekai-ni-shukufuku-wo-3-ova') body = JSON.stringify({ ...JSON.parse(snap('api-release.json')), id: 10024, alias: 'kono-subarashii-sekai-ni-shukufuku-wo-3-ova', name: { main: 'Этот Замечательный Мир! 3 (OVA)' }, type: { value: 'OVA' } });
    else if (p === '/api/v1/anime/franchises/release/10024') body = snap('api-franchise-10024.json');
    else if (p === `/api/v1/anime/releases/episodes/${UUID}`) body = snap('api-episode.json');
    else if (/^\/anime\/releases\/release\/re-creators(\/[a-z]+)?\/?$/.test(p)) body = snap('release.html');
    else if (p === `/anime/video/episode/${UUID}`) body = snap('episode.html');
    return { status: body ? 200 : 404, url, body: body || '', headers: {} };
  },
};

describe('the registries', () => {
  test('the folder loads, the adapter answers to its hosts only', async () => {
    const sites = await loadSites();
    assert.ok(sites.some(s => s.name === 'aniliberty'));
    assert.equal(siteFor(sites, `${REL}/torrents`)?.name, 'aniliberty');
    assert.equal(siteFor(sites, 'https://www.anilibria.top/x'), sites.find(s => s.name === 'aniliberty'));
    assert.equal(siteFor(sites, 'https://example.test/anime'), null);
    assert.equal(siteFor(sites, 'not a url'), null);
  });
  test('the shipped profiles load and match by host', async () => {
    const profiles = await loadProfiles();
    assert.equal(profileFor(profiles, `${REL}/episodes`)?.dub, 'AniLibria');
    assert.equal(profileFor(profiles, 'https://www.aniliberty.top/')?.dub, 'AniLibria');
    assert.equal(profileFor(profiles, 'https://example.test/'), null);
  });
});

describe('the aniliberty adapter', () => {
  test('a release link, whatever tab it ends in, is the release', async () => {
    for (const tail of ['/episodes', '/franchises', '/members', '/torrents', '/comments', '/', '']) {
      const c = await aniliberty.look(REL + tail, session);
      assert.equal(c.seriesUrl, `${REL}/episodes`, tail);
      assert.equal(c.series.title, 'Возрождающие');
      assert.equal(c.episodes.length, 22);
      assert.equal(c.start, null);
    }
  });
  test('a link to one episode finds its release and says which episode', async () => {
    const c = await aniliberty.look(`${SITE}/anime/video/episode/${UUID}`, session);
    assert.equal(c.seriesUrl, `${REL}/episodes`);
    assert.equal(c.start, 8);
  });
  test('every episode: its name, its length, the studio, three qualities with a referer', async () => {
    const c = await aniliberty.look(`${REL}/episodes`, session);
    const ep = c.episodes.find(e => e.number === 8);
    assert.equal(ep.title, 'Я выбрала свой путь в жизни');
    assert.ok(ep.duration > 1000, String(ep.duration));
    assert.match(ep.sourceUrl, new RegExp(`/anime/video/episode/${UUID}$`));
    assert.deepEqual(ep.dubs.map(d => d.name), ['AniLibria']);
    const src = ep.dubs[0].sources[0];
    assert.equal(src.player, 'aniliberty');
    assert.deepEqual(src.streams.map(s => s.quality), ['480p', '720p', '1080p']);
    assert.equal(src.streams[0].headers.referer, `${SITE}/`);
    /* where the opening and the ending are, so the player can offer to skip them */
    assert.deepEqual(ep.marks, { opening: { start: 42, stop: 132 }, ending: { start: 1330, stop: 1421 } });
    /* the first episode has no opening marked: only the ending is offered */
    assert.deepEqual(c.episodes.find(e => e.number === 1).marks, { opening: null, ending: { start: 1170, stop: 1290 } });
    assert.ok(c.series.altTitles.includes('Re:Creators'));
    assert.match(c.series.cover, /^https:\/\/aniliberty\.top\/storage\//);
  });
  test('a release in a franchise: the viewing order, this release marked, the season from the name', async () => {
    const c = await aniliberty.look(`${REL.replace('re-creators', 'kono-subarashii-sekai-ni-shukufuku-wo-3-ova')}/episodes`, session);
    assert.equal(c.series.kind, 'ova');
    assert.deepEqual(c.series.franchise.map(f => [f.order, f.kind, f.self]), [[6, 'tv', false], [7, 'tv', false], [8, 'ova', true]]);
    assert.match(c.series.franchise[1].url, /\/anime\/releases\/release\/kono-subarashii-sekai-ni-shukufuku-wo-3\/episodes$/);
    assert.equal(c.series.season, 3);
    /* a release outside any franchise has none, and is season one of itself */
    const r = await aniliberty.look(`${REL}/episodes`, session);
    assert.equal(r.series.franchise, undefined);
    assert.equal(r.series.season, 1);
  });
  test('a link with no release and no episode is nothing to it', async () => {
    assert.equal(await aniliberty.look(`${SITE}/anime/catalog`, session), null);
  });
});

describe('look() on aniliberty, page and adapter together', () => {
  test('one dub, named by the adapter, no unnamed twin; the linked episode is the start', async () => {
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session, sites: await loadSites(), profiles: await loadProfiles(), delivery });
    const { series, start, steps, dubs } = await lapka.look(`${SITE}/anime/video/episode/${UUID}`);
    assert.equal(series.title, 'Возрождающие');
    assert.equal(series.sourceUrl, `${REL}/episodes`);
    assert.equal(series.episodes.length, 22);
    assert.deepEqual(start, { episode: 8 });
    assert.deepEqual(dubs, ['AniLibria']);
    const r = await lapka.resolve({ seriesId: series.id, number: 8 });
    assert.deepEqual(r.episode.marks, { opening: { start: 42, stop: 132 }, ending: { start: 1330, stop: 1421 } });
    /* the streams of every live source of the dub, each saying its player */
    assert.deepEqual([...new Set(r.streams.map(st => st.quality))].sort(), ['1080p', '480p', '720p']);
    assert.deepEqual([...new Set(r.streams.map(st => st.player))].sort(), ['aniliberty', 'page']);
    assert.ok(r.streams.every(st => st.id && st.play && st.sourceId));
    assert.ok(r.episode.duration > 1000);
    const ep = series.episodes.find(e => e.number === 8);
    assert.equal(ep.dubs.length, 1);
    /* the adapter and the page each give a source of the same dub: two ways to the same streams, three qualities each */
    assert.deepEqual(ep.dubs[0].sources.map(s => s.player).sort(), ['aniliberty', 'page']);
    for (const s of ep.dubs[0].sources) assert.deepEqual(s.streams.map(st => st.quality).sort(), ['1080p', '480p', '720p']);
    assert.ok(steps.some(s => s.includes('Сайт знаком: aniliberty')), steps.join(' | '));
  });
  test('a failed stream of a page source is re-read from that page, never from every episode at once', async () => {
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session, sites: await loadSites(), profiles: await loadProfiles(), delivery, extractors: await (await import('../core/extract/index.mjs')).loadExtractors() });
    const { series } = await lapka.look(`${SITE}/anime/video/episode/${UUID}`);
    const r = await lapka.resolve({ seriesId: series.id, number: 8 });
    assert.equal(r.stream.quality, '1080p');
    const r2 = await lapka.resolve({ seriesId: series.id, number: 8, avoid: r.stream.id });
    const ep = series.episodes.find(e => e.number === 8);
    for (const src of ep.dubs[0].sources) {
      assert.ok(src.streams.length <= 3, `${src.player}: ${src.streams.length} streams`);
      for (const st of src.streams) assert.match(st.url, /\/3993\/8\//, 'only this episode');
    }
    assert.ok(r2.stream, 'still something to play');
  });

  test('the dubs of an episode say what they can play in, once their sources are opened', async () => {
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session, sites: await loadSites(), profiles: await loadProfiles(), delivery, extractors: await (await import('../core/extract/index.mjs')).loadExtractors() });
    const { series } = await lapka.look(`${SITE}/anime/video/episode/${UUID}`);
    const ep = await lapka.openAllSources(series.id, 8);
    const dubs = lapka.dubsOf(ep);
    assert.equal(dubs.length, 1);
    assert.equal(dubs[0].unopened, 0);
    assert.deepEqual([...new Set(dubs[0].qualities.map(q => q.quality))], ['1080p', '720p', '480p']);
    assert.ok(dubs[0].qualities.every(q => q.id && q.play && q.player));
  });

  test('without the adapter and the profile the page still plays, under the unnamed dub', async () => {
    const lapka = createLapka({ session });
    const { series, start } = await lapka.look(`${REL}/torrents`);
    assert.equal(series.episodes.length, 22);
    assert.equal(start, null);
    const one = await lapka.openEpisode(series.id, 8);
    assert.deepEqual(one.dubs.map(d => d.name), ['Основной']);
    assert.equal(one.dubs[0].sources[0].streams.length, 3);
  });
});

/* ── yummyani: a catalog whose player is a script; the API says it all ── */

const YSNAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'yummyani');
const ysnap = f => fs.readFileSync(path.join(YSNAP, f), 'utf8');
const YSITE = 'https://old.yummyani.me';
const YURL = `${YSITE}/catalog/item/etot-zamechatel-nyj-mir`;
const ysession = {
  fetch: async url => {
    const p = new URL(url).pathname;
    let body = null;
    if (p === '/api/anime/etot-zamechatel-nyj-mir') body = ysnap('api-anime.json');
    else if (p === '/api/anime/107/videos') body = ysnap('api-videos.json');
    else if (p === '/catalog/item/etot-zamechatel-nyj-mir') body = ysnap('item.html');
    return { status: body ? 200 : 404, url, body: body || '', headers: {} };
  },
};

describe('the yummyani adapter', () => {
  test('labels become dubs and kinds, hosts become players', () => {
    assert.deepEqual(dubOf('Озвучка AniDUB'), { name: 'AniDUB', kind: 'dub' });
    assert.deepEqual(dubOf('Субтитры SovetRomantica'), { name: 'SovetRomantica (субтитры)', kind: 'sub' });
    assert.deepEqual(dubOf('Субтитры'), { name: 'Субтитры', kind: 'dub' });
    assert.equal(playerOf('//kodikplayer.com/season/3207/abc/720p?episode=1'), 'kodik');
    assert.equal(playerOf('//alloha.yani.tv/?token_movie=x'), 'alloha');
    assert.equal(playerOf('//ru.yummyani.me/iframeCVH.html?anime_id=1'), 'cvh');
  });
  test('eleven episodes, twelve dubs and subtitle tracks, three players, the marks of the openings', async () => {
    const c = await yummyani.look(YURL, ysession);
    assert.equal(c.series.title, 'Богиня благословляет этот прекрасный мир');
    assert.match(c.series.cover, /^https:\/\/static\.yani\.tv\/posters\//);
    assert.equal(c.seriesUrl, YURL);
    /* ten episodes and one more that only Alloha carries */
    assert.equal(c.episodes.length, 11);
    assert.deepEqual(c.episodes[10].dubs.flatMap(d => d.sources.map(s => s.player)), ['alloha', 'alloha', 'alloha', 'alloha']);
    const ep1 = c.episodes[0];
    assert.equal(ep1.number, 1);
    /* AniDUB, AniLibria, SHIZA, plain subtitles, Crunchyroll dub and subtitles, Animedia, Комната Диди, SovetRomantica subtitles, AniBaza, OnWave, RedMic */
    assert.equal(ep1.dubs.length, 12);
    assert.ok(ep1.dubs.some(d => d.name === 'Crunchyroll' && d.kind === 'dub') && ep1.dubs.some(d => d.name === 'Crunchyroll (субтитры)' && d.kind === 'sub'));
    const anilibria = ep1.dubs.find(d => d.name === 'AniLibria');
    assert.deepEqual(anilibria.sources.map(s => s.player).sort(), ['alloha', 'cvh', 'kodik']);
    assert.match(anilibria.sources.find(s => s.player === 'kodik').embedUrl, /^https:\/\/kodikplayer\.com\/season\//);
    assert.deepEqual(ep1.marks, { opening: { start: 107, stop: 196 }, ending: { start: 1405, stop: 1504 } });
    assert.equal(ep1.duration, 1513);
    /* the viewing order: this season first, then OVAs, the sequel, a film, a spin-off */
    assert.equal(c.series.season, 1);
    assert.equal(c.series.kind, 'tv');
    assert.equal(c.series.franchise.length, 9);
    assert.deepEqual(c.series.franchise.slice(0, 5).map(f => [f.order, f.kind, f.self]), [[1, 'tv', true], [2, 'ova', false], [3, 'tv', false], [4, 'ova', false], [5, 'movie', false]]);
    assert.match(c.series.franchise[2].url, /\/catalog\/item\/boginya-blagoslovlyaet-etot-prekrasnyj-mir-2$/);
    assert.equal(c.series.franchise[5].relation, 'spinoff (ответвление сюжета)');
    assert.equal(c.series.franchise[5].kind, 'spinoff');
    /* a source has no stream yet: the extractors bring those */
    assert.ok(anilibria.sources.every(s => !s.streams));
  });
  test('through look(): the page says nothing, the adapter says everything, the dubs merge by studio', async () => {
    const lapka = createLapka({ session: ysession, sites: await loadSites(), profiles: await loadProfiles() });
    const { series, dubs, steps } = await lapka.look(YURL);
    assert.equal(series.episodes.length, 11);
    assert.ok(dubs.includes('AniLibria') && dubs.includes('AniDub') && dubs.includes('SHIZA Project'), dubs.join(','));
    assert.ok(steps.some(s => s.includes('Сайт знаком: yummyani')), steps.join(' | '));
    const ep = series.episodes[0];
    assert.equal(ep.dubs.find(d => d.key === 'anilibria').sources.length, 3);
  });
});

}
