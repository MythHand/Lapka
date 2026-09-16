/* ═══════════════════════════════════════════════════════════
   A page whose player is fetched after it loads, and a player that
   holds the whole series.

   jut-su.net (a DLE site) carries no iframe: two xfplayer elements
   with request parameters, answered by the engine's ajax controller
   with the embed's address. The Kodik embed it names is a serial:
   every translation and every episode is inside the player, the page
   itself lists nothing. Nothing here is jut-su's own: the deferred
   player is DLE's convention and the serial embed is Kodik's, both
   met on many sites. Snapshots: test/snapshots/jutsu, test/snapshots/kodik.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../core/discover/index.mjs';
import kodik, { readSerial, readEmbed } from '../core/extract/players/kodik.mjs';
import { loadExtractors } from '../core/extract/index.mjs';
import { createLapka } from '../core/lapka.mjs';

/* the snapshots of real pages are kept outside the repository: without them this file is skipped as a whole */
const SNAPSHOTS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
if (!fs.existsSync(SNAPSHOTS_ROOT)) describe('deferred players and the Kodik serial', { skip: 'the snapshots of real pages are kept outside the repository' }, () => {});
else {

const SNAPS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots');
const snap = (...p) => fs.readFileSync(path.join(SNAPS, ...p), 'utf8');
const PAGE = 'https://jut-su.net/31-klinok-rassekajuschij-demonov-o2.html';
const SERIAL = 'https://kodikplayer.com/serial/16224/dac5236f74af6509ca0d0f39d27db2d1/720p';
const ANIDUB_EP3 = 'https://kodikplayer.com/serial/19241/1488b084080e38e69aa3e5c1fd6cc8e1/720p?episode=3';
const FILM = 'https://jut-su.net/16-klinok-rassekajuschij-demonov-beskonechnyj-poezd-p1.html';
const FILM_EMBED = 'https://kodikplayer.com/video/109611/d41372e3683900687a68073a26e671f0/720p';

/* the site, the ajax controller and Kodik, played back from the snapshots */
function fakeSession() {
  const asked = [];
  const ok = (url, body, extra = {}) => ({ status: 200, url, body, headers: {}, cookies: [], ...extra });
  return {
    asked,
    fetch: async (url, opts = {}) => {
      asked.push({ url, ...opts });
      const u = new URL(url);
      if (url === PAGE) return ok(url, snap('jutsu', 'page.html'));
      if (url === FILM) return ok(url, snap('jutsu', 'film.html'));
      if (url === FILM_EMBED) return ok(url, snap('kodik', 'embed.html'));
      if (u.pathname === '/engine/ajax/controller.php') {
        assert.equal(opts.headers?.['x-requested-with'], 'XMLHttpRequest', 'asked the way the page does');
        if (u.searchParams.get('mod') === 'kodik-player') return ok(url, u.searchParams.get('id') === '16' ? JSON.stringify({ success: true, data: FILM_EMBED }) : snap('jutsu', 'ajax-kodik.json'));
        return ok(url, JSON.stringify({ success: true, data: 'https://absciss.example/?token_movie=x' }));
      }
      if (url === SERIAL) return ok(url, snap('kodik', 'serial.html'));
      if (url === ANIDUB_EP3) return ok(url, snap('kodik', 'serial-episode.html'), { cookies: ['__ddg1_=abc; Domain=.kodikplayer.com; Path=/'] });
      if (u.pathname.startsWith('/assets/js/app.player_single.')) return ok(url, snap('kodik', 'app.player_single.js'));
      if (u.pathname === '/ftor' && opts.method === 'POST') {
        const form = new URLSearchParams(opts.body);
        assert.ok(['500193', '42969'].includes(form.get('id')), 'the id of the third AniDUB episode, or the film');
        return ok(url, JSON.stringify({ links: { 720: [{ src: '//cloud.example/ep3/720.mp4:hls:manifest.m3u8', type: 'application/x-mpegURL' }] } }));
      }
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    },
  };
}

describe('reading the page', () => {
  const r = discover({ html: snap('jutsu', 'page.html'), url: PAGE });
  test('two deferred players, named by their module; the rating stars are not episodes', () => {
    assert.deepEqual(r.players.map(p => [p.kind, p.id, p.url]), [
      ['deferred', 'alloha', 'https://jut-su.net/engine/ajax/controller.php?mod=alloha-player&url=1&action=iframe&id=31'],
      ['deferred', 'kodik', 'https://jut-su.net/engine/ajax/controller.php?mod=kodik-player&url=1&action=iframe&id=31'],
    ]);
    assert.equal(r.episodes.items.length, 0);
    assert.equal(r.episode.value, null);
  });
  test('the name without its tail for search engines, the cover', () => {
    assert.equal(r.title.value, 'Клинок, рассекающий демонов');
    assert.match(r.cover.value, /klinokk-rassekajuschij-demonov2_poster/);
  });
  test('the franchise is the block the site heads "Франшиза": every part by year, this page among them, not the recommendations', () => {
    assert.equal(r.franchise.length, 10);
    assert.deepEqual(r.franchise.slice(0, 3).map(f => [f.order, f.year, f.kind, f.self, f.title]), [
      [1, 2019, 'tv', true, 'Клинок, рассекающий демонов'],
      [2, 2020, 'movie', false, 'Клинок, рассекающий демонов: Бесконечный поезд. Фильм'],
      [3, 2021, 'tv', false, 'Академия клинка: День святого Валентина'],
    ]);
    assert.equal(r.franchise[0].url, PAGE);
    assert.match(r.franchise[9].url, /beskonechnyj-zamok-3\.html$/);
    assert.equal(r.season, 1);
    assert.ok(!r.franchise.some(f => /слизь|невест|подземелье/.test(f.title)));
  });
});

describe('reading a Kodik serial', () => {
  const ser = readSerial(snap('kodik', 'serial.html'));
  test('every translation with its serial and count, the season, the episodes of the one shown', () => {
    assert.equal(ser.translations.length, 14);
    assert.deepEqual(ser.translations[0], { id: '963', title: 'Amazing Dubbing', kind: 'dub', mediaType: 'serial', mediaId: '41321', mediaHash: '6a530006fa9b594c40c9640c4aa1221d', count: 26 });
    assert.deepEqual(ser.translations.filter(t => t.kind === 'sub').map(t => t.title), ['MedusaSub (субтитры)', 'Wakanim (субтитры)']);
    assert.deepEqual(ser.seasons, [{ number: 1, selected: true }]);
    assert.equal(ser.episodes.length, 26);
    assert.deepEqual(ser.episodes[0], { number: 1, id: '424665', hash: '18cfedd8227679501fe01419825106f8', title: '1 серия', selected: false });
    assert.deepEqual(ser.current, { id: '643', title: 'Studio Band' });
  });
  test('unfolded: every episode of every translation, each a source at that episode', async () => {
    const got = await kodik.unfold(SERIAL, { referer: PAGE }, fakeSession());
    assert.equal(got.episodes.length, 26);
    assert.equal(got.episodes[2].number, 3);
    assert.equal(got.episodes[2].dubs.length, 14);
    const anidub = got.episodes[2].dubs.find(d => d.name === 'AniDUB');
    assert.deepEqual(anidub, { name: 'AniDUB', kind: 'dub', sources: [{ embedUrl: ANIDUB_EP3 }] });
    assert.equal(got.episodes[2].dubs.find(d => d.name === 'MedusaSub (субтитры)').kind, 'sub');
    /* the embed of one episode, and a serial opened at one episode only, unfold to nothing */
    assert.equal(await kodik.unfold('https://kodikplayer.com/seria/1/abc/720p', {}, fakeSession()), null);
    assert.equal(await kodik.unfold('https://kodikplayer.com/season/3207/abc/720p?only_episode=true&episode=1', {}, fakeSession()), null);
  });
  test('the serial opened at an episode is that episode', () => {
    const e = readEmbed(snap('kodik', 'serial-episode.html'));
    assert.deepEqual([e.type, e.id, e.hash], ['seria', '500193', '262474721ce0fe8baf785a5448dadd20']);
  });
});

describe('through look() and resolve()', () => {
  test('the page becomes a series of 26 episodes in 14 dubs; an episode plays from its own source', async () => {
    const session = fakeSession();
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session, extractors: await loadExtractors(), delivery });
    const r = await lapka.look(PAGE);
    assert.equal(r.series.title, 'Клинок, рассекающий демонов');
    assert.equal(r.series.episodes.length, 26);
    assert.equal(r.dubs.length, 14);
    assert.ok(r.steps.some(s => /весь сериал в плеере, 26 серий, 14 озвучек/.test(s)), r.steps.join(' | '));
    /* the deferred Alloha player was followed and found wanting, the page still plays */
    assert.ok(r.opened.some(o => o.player === 'absciss.example' && o.error), JSON.stringify(r.opened));
    assert.ok(r.opened.some(o => o.player === 'kodikplayer.com' && o.unfolded?.episodes === 26));
    const ep3 = r.series.episodes.find(e => e.number === 3);
    assert.equal(ep3.dubs.length, 14);
    const anidub = ep3.dubs.find(d => d.key === 'anidub');   // the studio dictionary spells it AniDub
    assert.equal(anidub.sources[0].embedUrl, ANIDUB_EP3);
    assert.equal(anidub.sources[0].streams.length, 0, 'no stream until it is played');
    /* played: the serial is opened at the episode, the player asked the way its script does */
    const res = await lapka.resolve({ seriesId: r.series.id, number: 3, dubKey: 'anidub' });
    assert.equal(res.dub.key, 'anidub');
    assert.equal(res.stream.quality, '720p');
    assert.ok(session.asked.some(a => a.url === ANIDUB_EP3));
    /* a series the same as the page's own: nothing to re-read for an episode */
    assert.equal(session.asked.filter(a => a.url === PAGE).length, 1);
  });
  test('a film: the site\'s player on a page that names no episode is its one episode; the film is a part of the franchise', async () => {
    const session = fakeSession();
    const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };
    const lapka = createLapka({ session, extractors: await loadExtractors(), delivery });
    const r = await lapka.look(FILM);
    assert.equal(r.series.kind, 'movie');
    assert.deepEqual(r.series.episodes.map(e => e.number), [1]);
    assert.ok(r.series.episodes[0].dubs[0].sources[0].streams.length >= 1, 'the film has its streams');
    /* the part that links to this page is this page; the head of the franchise, left without a link here, cannot be followed and is left out */
    const self = r.series.franchise.find(f => f.self);
    assert.deepEqual([self.year, self.kind, self.url], [2020, 'movie', FILM]);
    assert.equal(r.series.franchise.length, 9);   // ten in the block, the unlinked head left out
    assert.ok(!r.series.franchise.some(f => f.year === 2019));
  });
});

}
