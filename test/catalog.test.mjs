/* ═══════════════════════════════════════════════════════════
   The catalog model.

   Pure functions, no server, no ffmpeg. What is guarded here: that
   layers from different stages land in one tree, that one studio in
   two players is one dub with two sources, that a dead player is
   passed over and comes back, that a snapshot forgets the streams and
   nothing else.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSeries, createEpisode, createDub, createSource, createStream,
  canonicalUrl, seriesId, dubKey, allDubs,
  merge, pickSource, rankSources, pickDub, markHealth, bestStream,
  toSnapshot, fromSnapshot, RETRY_MS,
} from '../core/catalog/index.mjs';

const URL_A = 'https://example.test/anime/one-piece/';

/* The three layers a real page produces, in the order they arrive. */
const pageLayer = () => ({
  origin: 'discover:page',
  series: { title: 'One Piece', cover: 'https://example.test/c.jpg' },
  episodes: [
    { number: 2, title: 'Second', sourceUrl: 'https://example.test/anime/one-piece/2' },
    { number: 1, title: 'First', sourceUrl: 'https://example.test/anime/one-piece/1' },
  ],
});
const alphaLayer = () => ({
  origin: 'extract:alpha',
  episodes: [1, 2].map(number => ({
    number,
    dubs: [
      { name: 'AniLibria', lang: 'ru', sources: [{ player: 'alpha', embedUrl: `https://alpha.test/e/${number}?d=al`,
        streams: [{ kind: 'hls', url: `https://alpha.test/s/${number}/720.m3u8`, quality: '720p' }] }] },
      { name: 'Dream Cast', lang: 'ru', sources: [{ player: 'alpha', embedUrl: `https://alpha.test/e/${number}?d=dc` }] },
    ],
  })),
});
const betaLayer = () => ({
  origin: 'extract:beta',
  series: { title: 'Ван-Пис' },
  episodes: [1, 2, 3].map(number => ({
    number,
    dubs: [
      { name: 'Анилибрия', lang: 'ru', sources: [{ player: 'beta', embedUrl: `https://beta.test/${number}/anilibria`,
        streams: [{ kind: 'hls', url: `https://beta.test/${number}/1080.m3u8`, quality: '1080p' }] }] },
      { name: 'JAM', lang: 'ru', sources: [{ player: 'beta', embedUrl: `https://beta.test/${number}/jam` }] },
    ],
  })),
});

const built = () => {
  const s = createSeries({ sourceUrl: URL_A });
  merge(s, pageLayer()); merge(s, alphaLayer()); merge(s, betaLayer());
  return s;
};

describe('identity', () => {
  test('a series is its page, however the page was reached', () => {
    const a = canonicalUrl('https://WWW.Example.test/anime/one-piece/?utm_source=x#ep3');
    assert.equal(a, 'https://example.test/anime/one-piece');
    assert.equal(seriesId('https://www.example.test/anime/one-piece'), seriesId(URL_A));
    assert.notEqual(seriesId('https://example.test/anime/one-piece?season=2'), seriesId(URL_A));
  });

  test('a dub is its studio, however the site spelled it', () => {
    for (const n of ['AniLibria', 'Анилибрия', 'AniLibria.TV', '[AniLibria]', 'anilibria '])
      assert.equal(dubKey(n), 'anilibria');
    assert.equal(dubKey('Some New Studio'), 'somenewstudio');
    assert.equal(createDub({ name: 'анилибрия' }).name, 'AniLibria');
    assert.equal(createDub({ name: 'Some New Studio' }).name, 'Some New Studio');
  });

  test('constructors refuse to build without identity', () => {
    assert.throws(() => createSeries({}));
    assert.throws(() => createEpisode({ title: 'no number' }));
    assert.throws(() => createDub({}));
    assert.throws(() => createSource({ player: 'x' }));
    assert.throws(() => createStream({ kind: 'hls' }));
  });
});

describe('merging layers', () => {
  test('page, then two players: one tree', () => {
    const s = built();
    assert.deepEqual(s.episodes.map(e => e.number), [1, 2, 3]);
    assert.equal(s.title, 'One Piece');
    assert.deepEqual(s.altTitles, ['Ван-Пис']);
    assert.equal(s.episodes[0].title, 'First');
    assert.equal(s.episodes[2].title, '');
    assert.deepEqual(s.provenance.map(p => p.origin), ['discover:page', 'extract:alpha', 'extract:beta']);
    assert.deepEqual(s.provenance[2].added, { episodes: 1, dubs: 4, sources: 6, streams: 3 });
  });

  test('the same studio in two players is one dub with two sources', () => {
    const ep = built().episodes[0];
    assert.deepEqual(ep.dubs.map(d => d.name), ['AniLibria', 'Dream Cast', 'JAM']);
    const al = ep.dubs[0];
    assert.deepEqual(al.sources.map(x => x.player), ['alpha', 'beta']);
    assert.equal(al.sources[1].origin, 'extract:beta');
  });

  test('metadata fills gaps and never overwrites', () => {
    const s = createSeries({ sourceUrl: URL_A, title: 'Given' });
    merge(s, { origin: 'x', series: { title: 'Other', year: 1999 }, episodes: [{ number: 1, title: 'One' }] });
    merge(s, { origin: 'y', episodes: [{ number: 1, title: 'Renamed', sourceUrl: 'https://example.test/1' }] });
    assert.equal(s.title, 'Given');
    assert.equal(s.year, 1999);
    assert.deepEqual(s.altTitles, ['Other']);
    assert.equal(s.episodes[0].title, 'One');
    assert.equal(s.episodes[0].sourceUrl, 'https://example.test/1');
  });

  test('season, kind and the franchise fill in once and travel through a snapshot', () => {
    const s = createSeries({ sourceUrl: URL_A });
    merge(s, { origin: 'page', series: { season: 2 } });
    merge(s, { origin: 'site', series: { season: 3, kind: 'tv', franchise: [
      { order: 1, title: 'One', url: 'https://example.test/one', kind: 'tv', year: 2016 },
      { order: 2, title: 'Two', url: URL_A, kind: 'tv', year: 2017, self: true },
      { order: 3, title: 'Film', url: 'https://example.test/film', kind: 'movie' },
    ] } });
    merge(s, { origin: 'late', series: { franchise: [{ order: 1, title: 'Other', url: 'https://example.test/x' }, { order: 2, title: 'Y', url: 'https://example.test/y' }] } });
    assert.equal(s.season, 2, 'the first to say wins');
    assert.equal(s.kind, 'tv');
    assert.deepEqual(s.franchise.map(f => [f.order, f.title, f.self]), [[1, 'One', false], [2, 'Two', true], [3, 'Film', false]]);
    const back = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(s))));
    assert.equal(back.season, 2);
    assert.equal(back.kind, 'tv');
    assert.equal(back.franchise.length, 3);
    assert.equal(back.franchise[2].kind, 'movie');
  });

  test('length and marks fill in and travel through a snapshot', () => {
    const s = createSeries({ sourceUrl: URL_A });
    merge(s, { origin: 'x', episodes: [{ number: 1, duration: 1422, marks: { opening: { start: 60, stop: 150 }, ending: null } }] });
    merge(s, { origin: 'y', episodes: [{ number: 1, duration: 9, marks: { opening: { start: 1, stop: 2 }, ending: null } }] });
    assert.equal(s.episodes[0].duration, 1422);
    assert.equal(s.episodes[0].marks.opening.stop, 150);
    const back = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(s))));
    assert.equal(back.episodes[0].duration, 1422);
    assert.deepEqual(back.episodes[0].marks, { opening: { start: 60, stop: 150 }, ending: null });
  });

  test('streams are replaced, not accumulated', () => {
    const s = built();
    const src = s.episodes[0].dubs[0].sources[0];
    assert.equal(src.streams.length, 1);
    merge(s, { origin: 'extract:alpha', episodes: [{ number: 1, dubs: [{ name: 'AniLibria', sources: [{
      player: 'alpha', embedUrl: src.embedUrl,
      streams: [{ kind: 'hls', url: 'https://alpha.test/new/480.m3u8', quality: '480p' }, { kind: 'mp4', url: 'https://alpha.test/new/1080.mp4', quality: '1080' }],
    }] }] }] });
    assert.equal(s.episodes[0].dubs[0].sources.length, 2);
    assert.deepEqual(src.streams.map(x => x.quality), ['480p', '1080']);
    /* a layer without streams leaves the ones we have alone */
    merge(s, { origin: 'extract:alpha', episodes: [{ number: 1, dubs: [{ name: 'AniLibria', sources: [{ player: 'alpha', embedUrl: src.embedUrl }] }] }] });
    assert.equal(src.streams.length, 2);
  });

  test('every dub the series has anywhere', () => {
    const s = built();
    assert.deepEqual(allDubs(s).map(d => d.key), ['anilibria', 'dreamcast', 'jam']);
  });
});

describe('picking', () => {
  test('a live source over an unknown one, an unknown over a dead one', () => {
    const dub = built().episodes[0].dubs[0];
    const [alpha, beta] = dub.sources;
    /* nothing known: the better quality wins */
    assert.equal(pickSource(dub).player, 'beta');
    markHealth(alpha, true);
    assert.equal(pickSource(dub).player, 'alpha');
    markHealth(beta, true);
    assert.equal(pickSource(dub).player, 'beta');
    markHealth(beta, false, new Error('403'));
    assert.equal(pickSource(dub).player, 'alpha');
    assert.equal(beta.health.error, 'Error: 403');
    /* a failure is forgotten after a while */
    assert.equal(rankSources(dub, { now: Date.now() + RETRY_MS + 1 })[0].player, 'alpha');
    markHealth(alpha, false);
    assert.equal(rankSources(dub, { now: Date.now() + RETRY_MS + 1 })[0].player, 'beta');
  });

  test('the preferred player wins among the equally healthy', () => {
    const dub = built().episodes[0].dubs[0];
    assert.equal(pickSource(dub, { preferPlayer: 'alpha' }).player, 'alpha');
    markHealth(dub.sources[0], false);
    assert.equal(pickSource(dub, { preferPlayer: 'alpha' }).player, 'beta');
  });

  test('best stream by the number in the quality', () => {
    const src = createSource({ player: 'p', embedUrl: 'https://p.test/1' });
    src.streams = [
      createStream({ kind: 'hls', url: 'u1', quality: 'auto' }),
      createStream({ kind: 'hls', url: 'u2', quality: '720p' }),
      createStream({ kind: 'mp4', url: 'u3', quality: '1080' }),
    ];
    assert.equal(bestStream(src).url, 'u3');
    assert.equal(bestStream(createSource({ player: 'p', embedUrl: 'https://p.test/2' })), null);
  });

  test('the dub choice carries to the next episode', () => {
    const s = built();
    const chosen = s.episodes[0].dubs[2]; // JAM
    assert.equal(pickDub(s.episodes[1], chosen).key, 'jam');
    assert.equal(pickDub(s.episodes[2], chosen).key, 'jam');
    /* the studio is gone in this episode: same kind and language */
    const ep = createEpisode({ number: 9 });
    ep.dubs = [createDub({ name: 'Original', lang: 'ja', kind: 'raw' }), createDub({ name: 'AniDub', lang: 'ru' })];
    assert.equal(pickDub(ep, chosen).key, 'anidub');
    assert.equal(pickDub(ep, null).key, 'original');
    assert.equal(pickDub(createEpisode({ number: 10 }), chosen), null);
  });
});

describe('snapshot', () => {
  test('forgets the streams and nothing else', () => {
    const s = built();
    markHealth(s.episodes[0].dubs[0].sources[1], false, 'gone');
    const back = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(s))));
    assert.equal(back.id, s.id);
    assert.equal(back.title, 'One Piece');
    assert.deepEqual(back.altTitles, ['Ван-Пис']);
    assert.deepEqual(back.episodes.map(e => e.number), [1, 2, 3]);
    assert.deepEqual(back.episodes[0].dubs.map(d => d.key), ['anilibria', 'dreamcast', 'jam']);
    const src = back.episodes[0].dubs[0].sources[1];
    assert.equal(src.player, 'beta');
    assert.equal(src.health.ok, false);
    assert.equal(src.health.error, 'gone');
    assert.deepEqual(src.streams, []);
    assert.equal(back.provenance.length, 3);
    /* and merging keeps working on the restored tree */
    merge(back, alphaLayer());
    assert.equal(back.episodes[0].dubs[0].sources[0].streams.length, 1);
    assert.equal(back.episodes[0].dubs[0].sources.length, 2);
  });

  test('refuses a snapshot it does not understand', () => {
    assert.throws(() => fromSnapshot({ v: 99 }));
    assert.throws(() => fromSnapshot(null));
  });
});
