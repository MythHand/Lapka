/* ═══════════════════════════════════════════════════════════
   AnimeGO: a page with no player, whose episodes live in fragments
   a script asks for.

   The adapter knows where the fragments are and how to ask; what
   they say is read the general way: buttons that name the dub and
   the player in attributes and carry the embed. Kodik, AniBoom and
   the site's own CVH wrapper are the players behind. Snapshots in
   test/snapshots/animego, aniboom, kodik.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../core/discover/index.mjs';
import animego, { unwrap, readEpisodes } from '../core/sites/animego.mjs';
import { loadSites } from '../core/sites/index.mjs';
import { loadExtractors } from '../core/extract/index.mjs';
import { createLapka } from '../core/lapka.mjs';

const SNAPS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
const snap = (...p) => fs.readFileSync(path.join(SNAPS, ...p), 'utf8');
const SITE = 'https://animego.me';
const PAGE = `${SITE}/anime/blich-tysyacheletnyaya-krovavaya-voina-bedstviye-3590`;

const encodeLink = (url, shift) => Buffer.from(url).toString('base64').replace(/[a-zA-Z]/g, c => { const b = c <= 'Z' ? 65 : 97; let n = c.charCodeAt(0) - shift; if (n < b) n += 26; return String.fromCharCode(n); });

/* the site, Kodik, AniBoom and the CVH wrapper, played back from the snapshots */
function fakeSession() {
  const asked = [];
  const ok = (url, body) => ({ status: 200, url, body, headers: {}, cookies: [] });
  return {
    asked,
    fetch: async (url, opts = {}) => {
      asked.push({ url, ...opts });
      const u = new URL(url);
      if (u.hostname === 'animego.me') {
        if (u.pathname.startsWith('/player/')) assert.equal(opts.headers?.['x-requested-with'], 'XMLHttpRequest', `a fragment is asked the way the script asks: ${url}`);
        if (url === PAGE) return ok(url, snap('animego', 'page.html'));
        if (u.pathname === '/player/3590') return ok(url, snap('animego', 'player-3590.json'));
        if (u.pathname === '/player/videos/46939') return ok(url, snap('animego', 'videos-46939.json'));
        if (u.pathname === '/player/videos/48805') return ok(url, snap('animego', 'videos-48805.json'));
        if (u.pathname.startsWith('/cdn-iframe/')) return ok(url, snap('animego', 'cdn-iframe.html'));
      }
      if (u.hostname === 'aniboom.one') return ok(url, snap('aniboom', 'embed.html'));
      if (u.hostname === 'kodikplayer.com') {
        if (u.pathname.startsWith('/seria/')) return ok(url, snap('kodik', 'embed.html'));
        if (u.pathname.startsWith('/assets/js/app.player_single.')) return ok(url, snap('kodik', 'app.player_single.js'));
        if (u.pathname === '/ftor') return ok(url, JSON.stringify({ links: { 720: [{ src: encodeLink('//cloud.example/k/720.mp4:hls:manifest.m3u8', 18), type: 'application/x-mpegURL' }] } }));
      }
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    },
  };
}

describe('reading animego', () => {
  test('the page: the name whole, the cover, no player mistaken for the poster; the year and the kind from its schema.org data', () => {
    const r = discover({ html: snap('animego', 'page.html'), url: PAGE });
    assert.equal(r.title.value, 'Блич: Тысячелетняя кровавая война — Бедствие');
    assert.deepEqual(r.players, []);
    assert.match(r.cover.value, /^https:\/\/img\.cdngos\.com\//);
    assert.equal(r.year, 2026);
    assert.equal(r.kind_, 'tv');
  });
  test('"Связанное" names the neighbour only: the franchise is that part and this page, by year', () => {
    const r = discover({ html: snap('animego', 'page.html'), url: PAGE });
    assert.deepEqual(r.franchise.map(f => [f.order, f.year, f.kind, f.self, f.title]), [
      [1, 2024, 'tv', false, 'Блич: Тысячелетняя кровавая война — Конфликт'],
      [2, 2026, 'tv', true, 'Блич: Тысячелетняя кровавая война — Бедствие'],
    ]);
    assert.equal(r.franchise[0].url, `${SITE}/anime/blich-tysyacheletnyaya-krovavaya-voyna-konflikt-2689`);
    assert.equal(r.franchise[1].url, PAGE);
  });
  test('the fragments: the JSON unwrapped, the episodes with their ids', () => {
    const html = unwrap(snap('animego', 'player-3590.json'));
    const { episodes, pages } = readEpisodes(html);
    assert.equal(pages, 1);
    assert.deepEqual(episodes.slice(0, 2), [{ number: 1, id: '44863' }, { number: 2, id: '46939' }]);
    assert.equal(episodes.length, 9);
    assert.equal(unwrap('<html>'), null);
    assert.equal(unwrap(snap('animego', 'videos-48805.json')).trim(), '', 'an episode with no videos yet is an empty fragment');
  });
  test('an episode\'s fragment reads as a page: eight dubs named in attributes, each with its players', () => {
    const r = discover({ html: unwrap(snap('animego', 'videos-46939.json')), url: `${SITE}/player/videos/46939` });
    assert.equal(r.kind, 'episode');
    assert.equal(r.switches.length, 1);
    assert.equal(r.switches[0].kind, 'dubs');
    assert.deepEqual([...new Set(r.players.map(p => p.dubLabel))], ['Amber', 'JAM CLUB', 'Dream Cast', 'TVShows', 'AniDUB', 'AnimeVost', 'AniStar', 'Манипулятор.Subtitles']);
    assert.deepEqual([...new Set(r.players.map(p => p.playerLabel))], ['AniBoom', 'Kodik', 'CVH']);
    assert.deepEqual([...new Set(r.players.map(p => p.id))].sort(), ['animego.me/cdn-iframe', 'aniboom.one', 'kodikplayer.com'].map(x => x === 'animego.me/cdn-iframe' ? 'cdn-iframe/60636' : x).sort());
  });
  test('the adapter: the series page is the address, the episodes point at their fragments', async () => {
    const c = await animego.look(PAGE, fakeSession());
    assert.equal(c.seriesUrl, PAGE);
    assert.equal(c.episodes.length, 9);
    assert.deepEqual(c.episodes[1], { number: 2, sourceUrl: `${SITE}/player/videos/46939` });
    assert.equal(await animego.look(`${SITE}/anime/`, fakeSession()), null);
  });
});

describe('through look() and resolve()', () => {
  test('nine episodes; the second opens its fragment and plays; the ninth has nothing yet', async () => {
    const session = fakeSession();
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session, sites: await loadSites(), extractors: await loadExtractors(), delivery });
    const r = await lapka.look(PAGE);
    assert.equal(r.series.title, 'Блич: Тысячелетняя кровавая война — Бедствие');
    assert.equal(r.series.sourceUrl, PAGE);
    assert.equal(r.series.year, 2026);
    assert.equal(r.series.kind, 'tv');
    assert.equal(r.series.franchise.length, 2);
    assert.equal(r.series.episodes.length, 9);
    assert.ok(r.steps.some(s => s.includes('Сайт знаком: animego')), r.steps.join(' | '));
    assert.equal(r.series.episodes[1].dubs.length, 0, 'nothing is opened until it is played');

    const two = await lapka.resolve({ seriesId: r.series.id, number: 2, dubKey: 'jam' });
    assert.equal(two.dub.key, 'jam');   // the studio dictionary calls JAM CLUB by its short name
    assert.equal(two.dubs.length, 8);
    const ep = r.series.episodes.find(e => e.number === 2);
    const jam = ep.dubs.find(d => d.key === 'jam');
    assert.deepEqual(jam.sources.map(s => s.player).sort(), ['aniboom.one', 'cdn-iframe/60636', 'kodikplayer.com']);
    /* AniBoom answered with its HLS, Kodik with its qualities; the CVH wrapper's API is not reachable here and its source is marked dead */
    assert.ok(jam.sources.find(s => s.player === 'aniboom.one').streams.some(st => st.kind === 'hls' && /master\.m3u8$/.test(st.url)));
    assert.equal(jam.sources.find(s => s.player === 'aniboom.one').streams[0].headers.referer, 'https://aniboom.one/');
    assert.ok(jam.sources.find(s => s.player === 'kodikplayer.com').streams.some(st => st.quality === '720p'));
    assert.equal(jam.sources.find(s => s.player === 'cdn-iframe/60636').health.ok, false);
    assert.ok(two.stream, 'a stream to play');

    const nine = await lapka.resolve({ seriesId: r.series.id, number: 9 });
    assert.equal(nine.stream, null);
    assert.equal(nine.dubs.length, 0);
  });
});
