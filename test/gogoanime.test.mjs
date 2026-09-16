/* ═══════════════════════════════════════════════════════════
   gogoanime.by, a WordPress site read with no knowledge of it: the
   episode page carries its players as switch items with data-src,
   one of them the site's own page around a Blogger video (plain mp4
   on googlevideo, named by label and by itag), the others megaplay
   embeds Lapka does not open. The episode links to its series by
   the series' name; the series page lists the episodes.
   Snapshots: test/snapshots/gogoanime.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../core/discover/index.mjs';
import generic from '../core/extract/players/generic.mjs';
import { loadExtractors } from '../core/extract/index.mjs';
import { createLapka } from '../core/lapka.mjs';

/* the snapshots of real pages are kept outside the repository: without them this file is skipped as a whole */
const SNAPSHOTS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
if (!fs.existsSync(SNAPSHOTS_ROOT)) describe('gogoanime.by', { skip: 'the snapshots of real pages are kept outside the repository' }, () => {});
else {

const SNAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'gogoanime');
const snap = f => fs.readFileSync(path.join(SNAP, f), 'utf8');
const EP = 'https://gogoanime.by/dr-stone-science-future-part-3-episode-13-english-subbed/';
const SERIES = 'https://gogoanime.by/series/dr-stone-science-future-part-3/';

function fakeSession() {
  const asked = [];
  const ok = (url, body) => ({ status: 200, url, body, headers: {}, cookies: [] });
  return {
    asked,
    fetch: async (url, opts = {}) => {
      asked.push({ url, ...opts });
      const u = new URL(url);
      if (url === EP) return ok(url, snap('episode.html'));
      if (url === SERIES) return ok(url, snap('series.html'));
      if (u.pathname === '/player/' && u.searchParams.get('source') === 'blogger') return ok(url, snap('player-blogger.html'));
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    },
  };
}

describe('the pages', () => {
  test('the episode page: three players out of the switch, the number, the name, the way to the series', () => {
    const r = discover({ html: snap('episode.html'), url: EP });
    assert.equal(r.kind, 'episode');
    assert.equal(r.episode.value, 13);
    assert.equal(r.title.value, 'Dr. Stone: Science Future Part 3');
    assert.equal(r.seriesUrl.value, SERIES);
    assert.equal(r.players.length, 3);
    assert.ok(r.players.every(p => /gogoanime\.by\/player\/\?source=/.test(p.url)));
    assert.equal(r.season, 3);
  });
  test('the series page: twelve episodes as links, the name, the part as the season', () => {
    const r = discover({ html: snap('series.html'), url: SERIES });
    assert.equal(r.kind, 'series');
    assert.equal(r.title.value, 'Dr. Stone: Science Future Part 3');
    assert.equal(r.episodes.items.length, 12);
    assert.deepEqual(r.episodes.items.map(e => e.number).slice(0, 3), [1, 2, 3]);   // the eighth is missing on the site
    assert.equal(r.season, 3);
  });
});

describe('the Blogger player through the general extractor', () => {
  test('two mp4 files on googlevideo, without an extension: named by their type, the quality by label and by itag', async () => {
    const got = await generic.extract('https://gogoanime.by/player/?source=blogger&url=x', { referer: EP }, fakeSession());
    assert.equal(got.streams.length, 2);
    assert.ok(got.streams.every(s => s.kind === 'mp4' && /googlevideo\.com\/videoplayback/.test(s.url)));
    assert.equal(got.streams[0].quality, '360p');
    assert.deepEqual(got.dubs, []);
  });
});

describe('through look() and resolve()', () => {
  test('the episode leads to its series, twelve episodes; the thirteenth plays from Blogger, the megaplay players stay dead', async () => {
    const session = fakeSession();
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session, extractors: await loadExtractors(), delivery });
    const r = await lapka.look(EP);
    assert.equal(r.series.title, 'Dr. Stone: Science Future Part 3');
    assert.equal(r.series.sourceUrl, SERIES);
    assert.equal(r.series.season, 3);
    assert.equal(r.series.episodes.length, 12);
    assert.deepEqual(r.start, { episode: 13 });
    const ep = r.series.episodes.find(e => e.number === 13);
    assert.equal(ep.dubs.length, 1);
    const live = ep.dubs[0].sources.filter(s => s.health.ok !== false);
    assert.equal(live.length, 1);
    assert.equal(live[0].streams[0].quality, '360p');
    const res = await lapka.resolve({ seriesId: r.series.id, number: 13 });
    assert.equal(res.stream.kind, 'mp4');
    assert.equal(res.stream.quality, '360p');
  });
});

}
