/* ═══════════════════════════════════════════════════════════
   jkanime.net and animeflv.or.at, two Spanish sites read with no
   knowledge of them. jkanime keeps its servers in a script, each
   address in base64, and lists its episodes by script only, but
   names the last one; animeflv keeps the servers in base64 on its
   buttons and dates its episode addresses.
   Snapshots: test/snapshots/jkanime, test/snapshots/animeflv, hosters.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../core/discover/index.mjs';
import { loadExtractors } from '../core/extract/index.mjs';
import { createLapka } from '../core/lapka.mjs';

const SNAPS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
const snap = (...p) => fs.readFileSync(path.join(SNAPS, ...p), 'utf8');
const JK_EP = 'https://jkanime.net/grand-blue-season-3/11/', JK_SERIES = 'https://jkanime.net/grand-blue-season-3/';
const FLV_EP = 'https://animeflv.or.at/2026/09/14/grand-blue-season-3-episodio-11/', FLV_SERIES = 'https://animeflv.or.at/anime/grand-blue-season-3/';

function fakeSession() {
  const ok = (url, body) => ({ status: 200, url, body, headers: {}, cookies: [] });
  return {
    fetch: async (url) => {
      const u = new URL(url);
      if (url === JK_EP) return ok(url, snap('jkanime', 'episode.html'));
      if (url === JK_SERIES) return ok(url, snap('jkanime', 'series.html'));
      if (url === FLV_EP) return ok(url, snap('animeflv', 'episode.html'));
      if (url === FLV_SERIES) return ok(url, snap('animeflv', 'series.html'));
      if (/sfastwish|flaswish/.test(u.hostname)) return ok('https://flaswish.com/e/x', snap('hosters', 'streamwish.html'));
      if (/mp4upload/.test(u.hostname)) return ok(url, snap('hosters', 'mp4upload.html'));
      if (/streamtape/.test(u.hostname)) return ok(url, snap('hosters', 'streamtape.html'));
      if (/mixdrop/.test(u.hostname)) return ok(url, snap('hosters', 'mixdrop.html'));
      if (/zilla-networks/.test(u.hostname)) return ok(url, snap('hosters', 'zilla.m3u8'));
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    },
  };
}

describe('jkanime', () => {
  const r = discover({ html: snap('jkanime', 'episode.html'), url: JK_EP });
  test('the episode: its number from the page and the address, the name, the way to the series', () => {
    assert.equal(r.kind, 'episode');
    assert.equal(r.episode.value, 11);
    assert.equal(r.title.value, 'Grand Blue Season 3');
    assert.equal(r.season, 3);
    assert.equal(r.seriesUrl.value, JK_SERIES);
  });
  test('the servers out of the script, each address out of base64', () => {
    const names = r.players.map(p => p.playerLabel).filter(Boolean);
    assert.ok(names.includes('Mediafire') && names.includes('Streamtape') && names.length >= 8, names.join(','));
    assert.ok(r.players.some(p => /^https:\/\/streamtape\.com\/e\//.test(p.url)));
    assert.equal(r.switches.find(s => s.where === 'script').kind, 'players');
  });
  test('the episode page lists nothing itself; the series page names the last episode out, and the others follow its address', () => {
    assert.equal(r.episodes.items.length, 0);
    const s = discover({ html: snap('jkanime', 'series.html'), url: JK_SERIES });
    assert.equal(s.title.value, 'Grand Blue Season 3');
    assert.equal(s.episodes.by, 'template');
    assert.equal(s.episodes.items.length, 11);
    assert.equal(s.episodes.items[2].url, 'https://jkanime.net/grand-blue-season-3/3/');
  });
  test('through look(): eleven episodes, the eleventh plays from one of the open hosters', async () => {
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session: fakeSession(), extractors: await loadExtractors(), delivery });
    const got = await lapka.look(JK_EP);
    assert.equal(got.series.title, 'Grand Blue Season 3');
    assert.equal(got.series.sourceUrl, JK_SERIES);
    assert.equal(got.series.episodes.length, 11);
    assert.deepEqual(got.start, { episode: 11 });
    const res = await lapka.resolve({ seriesId: got.series.id, number: 11 });
    assert.ok(res.stream, 'a stream to play');
    const players = [...new Set(res.streams.map(s => s.player))].sort();
    assert.ok(players.some(p => /streamtape|mp4upload|flaswish|sfastwish|mixdrop/.test(p)), players.join(','));
  });
});

describe('animeflv', () => {
  const r = discover({ html: snap('animeflv', 'episode.html'), url: FLV_EP });
  test('the episode: the number from "Episodio 11", six servers out of base64 on the buttons, the series by its name', () => {
    assert.equal(r.kind, 'episode');
    assert.equal(r.episode.value, 11);
    assert.equal(r.title.value, 'Grand Blue Season 3');
    assert.equal(r.seriesUrl.value, FLV_SERIES);
    assert.equal(r.players.length, 6);
    assert.ok(r.players.some(p => /zilla-networks\.com\/m3u8\//.test(p.url)) && r.players.some(p => /mp4upload\.com\/embed-/.test(p.url)));
    /* the addresses carry a date: no template for the other episodes */
    assert.equal(r.episodes.items.length, 0);
  });
  test('through look(): the one episode plays, the two open hosters among six', async () => {
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session: fakeSession(), extractors: await loadExtractors(), delivery });
    const got = await lapka.look(FLV_EP);
    assert.equal(got.series.title, 'Grand Blue Season 3');
    assert.deepEqual(got.series.episodes.map(e => e.number), [11]);
    const res = await lapka.resolve({ seriesId: got.series.id, number: 11 });
    assert.ok(res.stream);
    assert.deepEqual([...new Set(res.streams.map(s => s.kind))].sort(), ['hls', 'mp4']);
  });
});
