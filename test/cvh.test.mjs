/* ═══════════════════════════════════════════════════════════
   The CVH extractor on a title of several seasons, as a <video-player>
   on a page names it: the playlist is a fake answer, no snapshots.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import cvh from '../core/extract/players/cvh.mjs';

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
