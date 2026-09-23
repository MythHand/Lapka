/* ═══════════════════════════════════════════════════════════
   Discovery: what Lapka sees on a page.

   The synthetic site's pages are rendered straight into the reader,
   no HTTP. One hand-written page stands in for the wild: breadcrumbs,
   "Серия 5" said the other way round, an external player host. And
   a page built to fool the heuristics, which a profile then fixes.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { discover, toContribution, UNNAMED_DUB } from '../core/discover/index.mjs';
import { numberFromText, numberFromUrl, titleFromText } from '../core/discover/numbers.mjs';
import { createSeries, merge } from '../core/catalog/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseById } from './site/cases.mjs';
import { qualityOf } from '../core/discover/players.mjs';
import { renderSeries, renderEpisode } from './site/render.mjs';

const BASE = 'http://127.0.0.1:8801';
const seriesPage = id => discover({ html: renderSeries(caseById(id)), url: `${BASE}/s/${id}/` });
const episodePage = (id, ep) => discover({ html: renderEpisode(caseById(id), ep), url: `${BASE}/s/${id}/ep-${ep}` });

describe('reading numbers', () => {
  test('from text, every way a page says it', () => {
    for (const [t, n] of [['1 серия', 1], ['Серия 12', 12], ['3-я серия', 3], ['Episode 7', 7], ['Ep. 4', 4], ['ep 9', 9], ['12 話', 12], [' 5 ', 5], ['№ 8', 8], ['Эпизод №3: Пробуждение', 3], ['Ван-Пис 1080p', null], ['2024', null]])
      assert.equal(numberFromText(t), n, t);
  });
  test('from an address', () => {
    for (const [u, n] of [['http://x/s/a/ep-3', 3], ['http://x/anime/one/episode_12', 12], ['http://x/watch?episode=7', 7], ['http://x/s01e04.html', 4], ['http://x/anime/one/', null], ['http://x/a/e5', 5], ['http://x/1080p/', null]])
      assert.equal(numberFromUrl(u), n, u);
  });
  test('the title is what is left', () => {
    assert.equal(titleFromText('3 серия — Возвращение'), 'Возвращение');
    assert.equal(titleFromText('Серия 3'), '');
    assert.equal(titleFromText('Episode 12: The End'), 'The End');
  });
});

describe('the synthetic site', () => {
  test('a series page with episodes as links', () => {
    const r = seriesPage('links');
    assert.equal(r.kind, 'series');
    assert.equal(r.title.value, 'Сериал Ссылки');
    assert.equal(r.cover.value, `${BASE}/media/cover-links.jpg`);
    assert.deepEqual(r.episodes.items.map(e => e.number), [1, 2, 3]);
    assert.equal(r.episodes.items[1].url, `${BASE}/s/links/ep-2`);
    assert.ok(r.episodes.confidence >= 0.8, String(r.episodes.confidence));
    assert.deepEqual(r.players, []);
  });

  test('a series page with episodes in a select', () => {
    const r = seriesPage('select');
    assert.equal(r.kind, 'series');
    assert.deepEqual(r.episodes.items.map(e => e.number), [1, 2, 3, 4]);
    assert.equal(r.episodes.by, 'option');
  });

  test('an episode page with dub tabs and one iframe', () => {
    const r = episodePage('links', 2);
    assert.equal(r.kind, 'episode');
    assert.equal(r.episode.value, 2);
    assert.equal(r.title.value, 'Сериал Ссылки');
    assert.equal(r.seriesUrl.value, `${BASE}/s/links/`);
    /* the strip of numbers at the bottom is the episode list here */
    assert.deepEqual(r.episodes.items.map(e => e.number), [1, 3]);
    assert.deepEqual(r.players.map(p => [p.id, p.dubLabel]), [['embed/alpha', 'AniLibria'], ['embed/alpha', 'AniDub']]);
    assert.equal(r.switches.length, 1);
    assert.equal(r.switches[0].kind, 'dubs');
    assert.ok(r.steps.some(s => s.key === 'foundDubs' && s.n === 2), JSON.stringify(r.steps));
  });

  test('an episode page with two players, dubs on the page for one and inside for the other', () => {
    const r = episodePage('select', 1);
    assert.equal(r.kind, 'episode');
    assert.equal(r.episode.value, 1);
    const kinds = r.switches.map(w => w.kind).sort();
    assert.deepEqual(kinds, ['dubs', 'players']);
    const dubs = r.switches.find(w => w.kind === 'dubs');
    assert.equal(dubs.scope, 'alpha');
    assert.deepEqual(dubs.items.map(i => i.label), ['AniLibria', 'Dream Cast']);
    const beta = r.players.find(p => p.id === 'embed/beta');
    assert.ok(beta, 'beta embed found');
    assert.equal(beta.dubLabel, null);
    assert.equal(beta.playerLabel, 'Плеер 2');
    assert.ok(r.steps.some(s => s.key === 'pending' && s.n === 1), JSON.stringify(r.steps));
  });

  test('an episode page with a video tag and an HLS source', () => {
    const r = episodePage('video', 1);
    assert.equal(r.kind, 'episode');
    assert.equal(r.players.length, 1);
    assert.equal(r.players[0].stream, 'hls');
    assert.equal(r.players[0].kind, 'video');
  });
});

describe('seasons', () => {
  test('the season in a title', async () => {
    const { seasonFromText } = await import('../core/discover/series.mjs');
    for (const [t, n] of [['Ван-Пис 2 сезон', 2], ['Re:Zero Season 3', 3], ['Bleach 2nd season', 2], ['Наруто', null], ['Сериал Сезоны 2 сезон', 2], ['S2 · Финал', 2], ['Богиня благословляет этот прекрасный мир 2', 2], ['Этот Замечательный Мир! 3 (OVA)', 3], ['Стальной алхимик 2003', null], ['Ван-Пис 1080p', null], ['Дни Сакамото [ТВ-1]', 1], ['One Piece TV-2', 2], ['Сверхъестественное (сериал, 1-13,14,15 сезон)', null]])
      assert.equal(seasonFromText(t), n, t);
  });
  test('a series in two seasons: each page names the other, and knows which one it is', () => {
    const c = caseById('seasons');
    const one = discover({ html: renderSeries(c, 1), url: `${BASE}/s/seasons/` });
    const two = discover({ html: renderSeries(c, 2), url: `${BASE}/s/seasons/season-2/` });
    assert.equal(one.kind, 'series');
    assert.deepEqual(one.franchise.map(f => [f.order, f.url, f.self]), [[1, `${BASE}/s/seasons/`, true], [2, `${BASE}/s/seasons/season-2/`, false]]);
    assert.equal(one.season, 1);
    assert.equal(two.season, 2);
    assert.equal(two.title.value, 'Сериал Сезоны 2 сезон');
    const c2 = toContribution(two);
    assert.equal(c2.series.season, 2);
    assert.equal(c2.series.franchise.length, 2);
    /* a page with a single season link is not a franchise */
    assert.deepEqual(seriesPage('links').franchise, []);
  });
});

describe('the page\'s own word', () => {
  test('a franchise block with the year inside each link outranks season links; the window title and a labelled year name the page', () => {
    const html = `<html><head><meta property="og:type" content="movie"><title>Герой: Фильм смотреть аниме фильм онлайн</title></head><body>
      <h1>Герой: Фильм</h1>
      <ul class="info"><li><span>Год выхода:</span> <a href="/catalog/2024/">2024</a></li><li><span>Время:</span> 90 мин.</li></ul>
      <div class="section"><div class="section__title"><span>Порядок</span> просмотра:</div><div class="items">
        <div class="item"><a href="/1-geroj.html"><img alt="Герой"><div class="label">2016</div><div class="t">Герой</div></a></div>
        <div class="item"><a href="/2-geroj-2.html"><img alt="Герой 2 сезон"><div class="label">2017</div><div class="t">Герой 2 сезон</div></a></div>
        <div class="item"><a href="/3-geroj-ova.html"><img alt="Герой OVA"><div class="label">2018</div><div class="t">Герой OVA</div></a></div>
      </div></div>
      <div class="also"><a href="/77-drugoe-3-sezon.html">Другое 3 сезон</a></div>
    </body></html>`;
    const r = discover({ html, url: 'https://site.test/9-geroj-film.html' });
    assert.equal(r.year, 2024);
    assert.equal(r.kind_, 'movie');
    assert.equal(r.season, null, 'a place in a block ordered by year is not a season');
    /* og:type says movie on every page of such sites: the title's own word decides */
    const tv = discover({ html: html.replace('<title>Герой: Фильм смотреть аниме фильм онлайн</title>', '<title>Герой 2 сезон смотреть аниме сериал онлайн</title>').replace('<h1>Герой: Фильм</h1>', '<h1>Герой 2 сезон</h1>'), url: 'https://site.test/2-geroj-2.html' });
    assert.equal(tv.kind_, 'tv');
    assert.equal(tv.season, 2);
    /* the years written as dates beside each link, in a plain list under the heading */
    const dated = `<html><head><title>Герой 2 сезон смотреть аниме сериал онлайн</title></head><body><h1>Герой 2 сезон</h1>
      <h2>Франшиза аниме Герой 2 сезон 👇</h2><a href="/franchise/geroj/">Полный порядок просмотра: 3 части</a>
      <ul><li><a href="/1-geroj.html">Герой</a><time datetime="21 декабря 2015"> — <i>5 октября 2015</i></time></li>
      <li><a href="/2-geroj-2.html">Герой 2 сезон</a><time> — <i>10 апреля 2019</i></time></li>
      <li><a href="/3-geroj-ova.html">Герой OVA</a><time> — <i>2020-03-27</i></time></li></ul></body></html>`;
    const d = discover({ html: dated, url: 'https://site.test/2-geroj-2.html' });
    assert.deepEqual(d.franchise.map(f => [f.order, f.title, f.year, f.self]), [[1, 'Герой', 2015, false], [2, 'Герой 2 сезон', 2019, true], [3, 'Герой OVA', 2020, false]]);
    assert.deepEqual(r.franchise.map(f => [f.order, f.title, f.year, f.kind, f.self]), [
      [1, 'Герой', 2016, 'tv', false], [2, 'Герой 2 сезон', 2017, 'tv', false], [3, 'Герой OVA', 2018, 'ova', false], [4, 'Герой: Фильм', 2024, 'movie', true],
    ]);
    const c = toContribution(r);
    assert.equal(c.series.year, 2024);
    assert.equal(c.series.kind, 'movie');
  });
});

describe('into the catalog', () => {
  test('series page then episode page: episodes with dubs and sources', () => {
    const s = createSeries({ sourceUrl: `${BASE}/s/links/` });
    merge(s, toContribution(seriesPage('links')));
    merge(s, toContribution(episodePage('links', 2)));
    assert.equal(s.title, 'Сериал Ссылки');
    assert.deepEqual(s.episodes.map(e => e.number), [1, 2, 3]);
    assert.deepEqual(s.episodes[0].dubs, []);
    assert.deepEqual(s.episodes[1].dubs.map(d => d.name), ['AniLibria', 'AniDub']);
    assert.equal(s.episodes[1].dubs[0].sources[0].player, 'embed/alpha');
    assert.equal(s.episodes[1].dubs[0].sources[0].embedUrl, `${BASE}/embed/alpha/links-2-anilibria`);
    assert.deepEqual(s.episodes[1].dubs[0].sources[0].streams, []);
  });

  test('an unnamed player is not guessed at', () => {
    const c = toContribution(episodePage('select', 1));
    const ep = c.episodes.find(e => e.number === 1);
    assert.deepEqual(ep.dubs.map(d => d.name), ['AniLibria', 'Dream Cast']);
    assert.ok(ep.dubs.every(d => d.sources.every(x => x.player === 'embed/alpha')));
  });

  test('a stream on the page itself becomes the one unnamed dub, with the stream', () => {
    const c = toContribution(episodePage('video', 1));
    const ep = c.episodes.find(e => e.number === 1);
    assert.equal(ep.dubs.length, 1);
    assert.equal(ep.dubs[0].name, UNNAMED_DUB);
    assert.equal(ep.dubs[0].sources[0].player, 'page');
    assert.deepEqual(ep.dubs[0].sources[0].streams, [{ kind: 'hls', url: `${BASE}/media/hls/index.m3u8`, quality: null }]);
  });
});

/* A page the way a real site builds one: title with the site name,
   a breadcrumb, "Серия 5" rather than "5 серия", a player on another
   host, a list of other series that also has numbers in it. */
const WILD = `<!doctype html><html><head>
<title>Ван-Пис Серия 5 смотреть онлайн — AnimeSite</title>
<meta property="og:title" content="Ван-Пис Серия 5">
<meta property="og:image" content="/upload/one-piece.jpg">
</head><body>
<div class="breadcrumb"><a href="/">Главная</a> › <a href="/anime/">Аниме</a> › <a href="/anime/one-piece/">Ван-Пис</a></div>
<h1>Ван-Пис Серия 5</h1>
<div class="translations">
  <div class="translations__item active" data-media-id="1" data-url="//embed.example/seria/1001/abc/720p">AniLibria</div>
  <div class="translations__item" data-media-id="2" data-url="//embed.example/seria/1002/def/720p">Дримкаст</div>
</div>
<iframe src="//embed.example/seria/1001/abc/720p" allowfullscreen></iframe>
<ul class="episodes">
  <li><a href="/anime/one-piece/1-seriya">Серия 1</a></li>
  <li><a href="/anime/one-piece/2-seriya">Серия 2</a></li>
  <li><a href="/anime/one-piece/3-seriya">Серия 3</a></li>
  <li><a href="/anime/one-piece/4-seriya">Серия 4</a></li>
  <li class="active">Серия 5</li>
  <li><a href="/anime/one-piece/6-seriya">Серия 6</a></li>
</ul>
<aside><h3>Похожее</h3>
  <a href="/anime/bleach/">Блич (366 серий)</a>
  <a href="/anime/naruto/">Наруто (220 серий)</a>
  <a href="/anime/top-100/">Топ 100</a>
</aside>
</body></html>`;

describe('a page from the wild', () => {
  const r = discover({ html: WILD, url: 'https://animesite.example/anime/one-piece/5-seriya' });
  test('the series, the episode, the way up', () => {
    assert.equal(r.kind, 'episode');
    assert.equal(r.title.value, 'Ван-Пис');
    assert.equal(r.episode.value, 5);
    assert.equal(r.seriesUrl.value, 'https://animesite.example/anime/one-piece/');
    assert.equal(r.cover.value, 'https://animesite.example/upload/one-piece.jpg');
  });
  test('the episode list, not the sidebar', () => {
    assert.deepEqual(r.episodes.items.map(e => e.number), [1, 2, 3, 4, 6]);
  });
  test('an external player named by its host, two dubs', () => {
    assert.deepEqual(r.players.map(p => [p.id, p.dubLabel]), [['embed.example', 'AniLibria'], ['embed.example', 'Дримкаст']]);
    const c = toContribution(r);
    const ep = c.episodes.find(e => e.number === 5);
    assert.deepEqual(ep.dubs.map(d => d.name), ['AniLibria', 'Дримкаст']);
    const s = merge(createSeries({ sourceUrl: r.seriesUrl.value }), c);
    assert.deepEqual(s.episodes.find(e => e.number === 5).dubs.map(d => d.key), ['anilibria', 'dreamcast']);
  });
});

/* Built to fool the heuristics: the "related" list is longer and more
   regular than the real episode list. A profile says which is which. */
const TRICKY = `<html><head><title>Сериал</title></head><body><h1>Сериал</h1>
<div class="eps"><a href="/watch/77/1">1</a> <a href="/watch/77/2">2</a> <a href="/watch/77/3">3</a></div>
<div class="also"><a href="/title/101">1 серия</a><a href="/title/102">2 серия</a><a href="/title/103">3 серия</a><a href="/title/104">4 серия</a><a href="/title/105">5 серия</a></div>
</body></html>`;

describe('a profile as a hint', () => {
  test('without it the heuristics are fooled, with it they are not', () => {
    const fooled = discover({ html: TRICKY, url: 'https://tricky.example/title/77' });
    assert.equal(fooled.episodes.items.length, 5);
    const profile = { match: 'tricky.example', episodes: { list: '.eps a' } };
    const fixed = discover({ html: TRICKY, url: 'https://tricky.example/title/77', profile });
    assert.deepEqual(fixed.episodes.items.map(e => [e.number, e.url]), [[1, 'https://tricky.example/watch/77/1'], [2, 'https://tricky.example/watch/77/2'], [3, 'https://tricky.example/watch/77/3']]);
    assert.equal(fixed.episodes.by, 'profile');
    assert.equal(fixed.profile, 'tricky.example');
  });
});
