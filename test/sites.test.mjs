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
  test('a link with no release and no episode is nothing to it', async () => {
    assert.equal(await aniliberty.look(`${SITE}/anime/catalog`, session), null);
  });
});

describe('look() on aniliberty, page and adapter together', () => {
  test('one dub, named by the adapter, no unnamed twin; the linked episode is the start', async () => {
    const lapka = createLapka({ session, sites: await loadSites(), profiles: await loadProfiles() });
    const { series, start, steps, dubs } = await lapka.look(`${SITE}/anime/video/episode/${UUID}`);
    assert.equal(series.title, 'Возрождающие');
    assert.equal(series.sourceUrl, `${REL}/episodes`);
    assert.equal(series.episodes.length, 22);
    assert.deepEqual(start, { episode: 8 });
    assert.deepEqual(dubs, ['AniLibria']);
    const r = await lapka.resolve({ seriesId: series.id, number: 8 });
    assert.deepEqual(r.episode.marks, { opening: { start: 42, stop: 132 }, ending: { start: 1330, stop: 1421 } });
    assert.ok(r.episode.duration > 1000);
    const ep = series.episodes.find(e => e.number === 8);
    assert.equal(ep.dubs.length, 1);
    /* the adapter and the page each give a source of the same dub: two ways to the same streams, three qualities each */
    assert.deepEqual(ep.dubs[0].sources.map(s => s.player).sort(), ['aniliberty', 'page']);
    for (const s of ep.dubs[0].sources) assert.deepEqual(s.streams.map(st => st.quality).sort(), ['1080p', '480p', '720p']);
    assert.ok(steps.some(s => s.includes('Сайт знаком: aniliberty')), steps.join(' | '));
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
