/* ═══════════════════════════════════════════════════════════
   anidubonline.ru, read with no knowledge of it at all: a DLE page
   with a Kodik serial embed, episodes as links, and the other
   seasons only as picture links in a "similar" strip, named by
   nothing but their addresses. Snapshot: test/snapshots/anidubonline.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../core/discover/index.mjs';
import { seasonFromText, seasonFromUrl, tidyTitle } from '../core/discover/series.mjs';

const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'anidubonline', 'page.html'), 'utf8');
const URL_ = 'https://anidubonline.ru/neobjatnyj-okean-sezon-3';

describe('a title the way a site writes it', () => {
  test('the year in brackets and the watch-words go', () => {
    assert.deepEqual(tidyTitle('Необъятный океан, Сезон 3 (2026) все серии онлайн'), { title: 'Необъятный океан, Сезон 3', year: 2026 });
    assert.deepEqual(tidyTitle('Клинок, рассекающий демонов смотреть аниме все серии подряд'), { title: 'Клинок, рассекающий демонов', year: null });
    assert.deepEqual(tidyTitle('Ван-Пис'), { title: 'Ван-Пис', year: null });
    assert.deepEqual(tidyTitle('Сериал Сезоны 2 сезон'), { title: 'Сериал Сезоны 2 сезон', year: null });
  });
  test('the season in "Сезон 3" and in an address', () => {
    assert.equal(seasonFromText('Необъятный океан, Сезон 3 (2026) все серии онлайн'), 3);
    assert.equal(seasonFromUrl('https://anidubonline.ru/neobjatnyj-okean-sezon-3'), 3);
    assert.equal(seasonFromUrl('https://anidubonline.ru/online/neobjatnyj_okean_sezon_1_2018_720_hd/10-1-0-834'), 1);
    assert.equal(seasonFromUrl('https://x.example/anime/one-piece/'), null);
  });
});

describe('the page', () => {
  const r = discover({ html: page, url: URL_ });
  test('the name, the year, the season, the episodes, the Kodik serial embed', () => {
    assert.equal(r.title.value, 'Необъятный океан, Сезон 3');
    assert.equal(r.year, 2026);
    assert.equal(r.season, 3);
    assert.equal(r.episodes.items.length, 12);
    assert.ok(r.players.some(p => /kodikplayer\.com\/serial\//.test(p.url)));
  });
  test('the other seasons out of the picture links: by address, this page the third', () => {
    assert.deepEqual(r.franchise.map(f => [f.order, f.self, f.url]), [
      [1, false, 'https://anidubonline.ru/online/neobjatnyj_okean_sezon_1_2018_720_hd/10-1-0-834'],
      [2, false, 'https://anidubonline.ru/neobjatnyj-okean-sezon-2'],
      [3, true, URL_],
    ]);
  });
});
