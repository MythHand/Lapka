/* ═══════════════════════════════════════════════════════════
   The player, in a real browser, against the synthetic site.

   The page is served by Lapka from a staged copy, the site is the
   synthetic one, and everything the page does goes through the real
   routes. Guarded: the start screen asks for a link; a link fills the
   queue with the episodes and starts the one the link pointed at; the
   audio menu lists the dubs of the episode and choosing one switches
   the stream; the position and the dub reach the server; the series
   comes back after a reload; the interface holds together in every
   language and at a narrow width.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, haveFfmpeg } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { openLapka, findChrome, stalledAt } from './browser.mjs';

const ffmpeg = await haveFfmpeg();
const chrome = !!findChrome();
const skip = (!ffmpeg && 'ffmpeg not installed') || (!chrome && 'no Chrome found');
let site;

before(async () => {
  if (skip) return;
  const fx = await build();
  site = await startSite({ media: fx.show });
});
after(async () => { if (site) await site.close(); });

/* Waits for a condition on the page, in turns of the page clock with
   real pauses between them (see __tick in the harness). */
const WAIT = `
const until = async (what, fn, turns = 80) => {
  __step(what);
  for (let i = 0; i < turns; i++) { if (fn()) return true; await __tick(); }
  return false;
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const visible = el => el && !el.hidden && getComputedStyle(el).display !== 'none' && !el.classList.contains('hide');
`;

const ok = (r, name) => assert.ok(r && !r.fatal && !r.stalled, name + ': ' + (r && (r.fatal || stalledAt(r))));

describe('the start screen', { skip }, () => {
  let r;
  before(async () => {
    r = await openLapka('start', WAIT + `
      await until('boot', () => document.querySelector('#empty') && !$('#empty').classList.contains('hide'));
      __report({
        errors: window.__errors,
        emptyShown: visible($('#empty')),
        linkInput: visible($('#linkInput')), placeholder: $('#linkInput').placeholder,
        openBtn: $('#btnOpen').textContent.trim(),
        title: document.title,
        queueTitle: $('.queue__title').textContent.trim(),
        aboutShown: !!$('.queue__about'),
        fileButtons: $$('#btnAddFiles, #btnAddFolder, #btnDisk, #filePick').length,
        lang: document.documentElement.lang,
      });
    `, { budget: 8000 });
  });
  test('nothing throws on the way up', () => { ok(r, 'start'); assert.deepEqual(r.errors, []); });
  test('it asks for a link, not for files', () => {
    assert.equal(r.emptyShown, true);
    assert.equal(r.linkInput, true);
    assert.ok(r.placeholder.length > 5);
    assert.equal(r.fileButtons, 0);
    assert.equal(r.title, 'Lapka');
  });
  test('the empty queue carries the description', () => {
    assert.equal(r.aboutShown, true);
  });
});

describe('a link to an episode', { skip }, () => {
  let r;
  before(async () => {
    r = await openLapka('link', WAIT + `
      await until('boot', () => !$('#empty').classList.contains('hide'));
      $('#linkInput').value = site + '/s/select/ep-2';
      $('#linkForm').requestSubmit();
      await until('queue', () => $$('#queueList .item').length === 4);
      await until('source', () => $('#video').getAttribute('src'));
      await until('meta', () => $('#video').readyState >= 1, 120);
      await until('session', () => localStorage.getItem('lapka.session'));
      const rows = $$('#queueList .item').map(li => ({ name: li.querySelector('.item__name').textContent, active: li.classList.contains('active'), meta: li.querySelector('.item__meta').textContent }));
      $('#btnAudio').click();
      await __settled();
      const menu = $$('#audioMenu .menu__item').map(b => ({ main: b.querySelector('.menu__main').textContent, sel: b.classList.contains('sel') }));
      __report({
        errors: window.__errors, rows,
        titleName: $('#titleName').textContent, titlePath: $('#titlePath').textContent,
        docTitle: document.title,
        src: $('#video').getAttribute('src'), readyState: $('#video').readyState,
        audioHidden: $('#btnAudio').hidden, audioLabel: $('#audioLabel').textContent, menu,
        session: localStorage.getItem('lapka.session'),
        emptyHidden: $('#empty').classList.contains('hide'),
      });
    `, { site: site.base, budget: 20000 });
  });
  test('nothing throws', () => { ok(r, 'link'); assert.deepEqual(r.errors, []); });
  test('the queue is the episodes of the series, the linked one current', () => {
    assert.equal(r.rows.length, 4);
    assert.deepEqual(r.rows.map(x => x.active), [false, true, false, false]);
    assert.match(r.rows[1].name, /\b2\b/);
    assert.equal(r.emptyHidden, true);
  });
  test('the title names the episode and the series', () => {
    assert.match(r.titleName, /\b2\b/);
    assert.equal(r.titlePath, 'Сериал Селект');
    assert.match(r.docTitle, /Lapka$/);
  });
  test('a stream reached the video element', () => {
    assert.ok(r.src, 'video has a source');
    assert.ok(r.readyState >= 1, `readyState ${r.readyState}`);
  });
  test('the audio menu lists the dubs of the episode, one of them marked', () => {
    assert.equal(r.audioHidden, false);
    const names = r.menu.map(m => m.main);
    assert.deepEqual(names.sort(), ['AniDub', 'AniLibria', 'Dream Cast', 'JAM']);
    assert.equal(r.menu.filter(m => m.sel).length, 1);
    assert.equal(r.audioLabel, r.menu.find(m => m.sel).main);
  });
  test('the series is written down for next time', () => {
    const ses = JSON.parse(r.session);
    assert.equal(ses.url, site.base + '/s/select/');
    assert.equal(ses.current.number, 2);
  });
});

describe('a series in seasons', { skip }, () => {
  let r;
  before(async () => {
    r = await openLapka('seasons', WAIT + `
      await until('boot', () => !$('#empty').classList.contains('hide'));
      $('#linkInput').value = site + '/s/seasons/season-2/ep-2';
      $('#linkForm').requestSubmit();
      await until('queue', () => $$('#queueList .item').length === 4);
      await until('source', () => $('#video').getAttribute('src'));
      const rows = $$('#queueList > li').map(li => li.classList.contains('queue__group')
        ? 'group: ' + li.querySelector('.queue__group-label').textContent
        : li.querySelector('.item__num').textContent + ' · ' + li.querySelector('.item__name').textContent + (li.classList.contains('active') ? ' *' : ''));
      __report({ errors: window.__errors, rows, titlePath: $('#titlePath').textContent, grouped: $('#queue').classList.contains('queue--grouped'), sortHidden: getComputedStyle($('#btnSort')).display === 'none' });
    `, { site: site.base, budget: 20000 });
  });
  test('both seasons are in the queue, each under its own line, the linked one current', () => {
    ok(r, 'seasons'); assert.deepEqual(r.errors, []);
    assert.deepEqual(r.rows, ['group: Season 1', '1 · Episode 1', '2 · Episode 2', 'group: Season 2', '1 · Episode 1', '2 · Episode 2 *']);
    assert.equal(r.grouped, true);
    assert.equal(r.sortHidden, true);
    assert.match(r.titlePath, /Season 2$/);
  });
});

describe('the Lapka folder', { skip }, () => {
  let r, home, other;
  before(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-home-'));
    other = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-other-')), 'Lapka');
    r = await openLapka('home', WAIT + `
      await until('boot', () => !$('#empty').classList.contains('hide'));
      $('#btnGear').click(); await __settled();
      await until('home', () => $('.home__path') && $('.home__path').textContent.length > 1);
      const before = $('.home__path').textContent;
      $('.home__in').value = ${JSON.stringify(other)};
      $('.home__form').requestSubmit();
      await until('switched', () => $('.home__path') && $('.home__path').textContent === ${JSON.stringify(other)});
      const ping = await (await fetch('/api/ping')).json();
      __report({ errors: window.__errors, before, after: $('.home__path').textContent, ping: ping.home });
    `, { budget: 10000, home });
  });
  after(async () => {
    if (home) await fsp.rm(home, { recursive: true, force: true });
    if (other) await fsp.rm(path.dirname(other), { recursive: true, force: true });
  });
  test('is shown, and a new path is created and taken into use', async () => {
    ok(r, 'home'); assert.deepEqual(r.errors, []);
    assert.equal(r.before, home);
    assert.equal(r.after, other);
    assert.equal(r.ping, other);
    await fsp.access(path.join(other, '.lapka', 'cache'));
  });
});

describe('choosing a dub', { skip }, () => {
  let r, home;
  before(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-home-'));
    r = await openLapka('dub', WAIT + `
      await until('boot', () => !$('#empty').classList.contains('hide'));
      $('#linkInput').value = site + '/s/select/ep-1';
      $('#linkForm').requestSubmit();
      await until('source', () => $('#video').getAttribute('src'));
      const before = $('#audioLabel').textContent;
      $('#btnAudio').click(); await __settled();
      const jam = $$('#audioMenu .menu__item').find(b => b.querySelector('.menu__main').textContent === 'JAM');
      jam.click();
      await until('switched', () => $('#audioLabel').textContent === 'JAM');
      await until('meta', () => $('#video').readyState >= 1, 120);
      const meta = $$('#queueList .item')[0].querySelector('.item__meta').textContent;
      const st = await (await fetch('/api/state')).json();
      __report({ errors: window.__errors, before, after: $('#audioLabel').textContent, meta, dubs: st.dubs });
    `, { site: site.base, budget: 20000, home });
  });
  after(async () => { if (home) await fsp.rm(home, { recursive: true, force: true }); });
  test('the label follows the choice and the server remembers it', () => {
    ok(r, 'dub'); assert.deepEqual(r.errors, []);
    assert.notEqual(r.before, 'JAM');
    assert.equal(r.after, 'JAM');
    assert.match(r.meta, /embed\/beta/);
    assert.deepEqual(Object.values(r.dubs), ['jam']);
  });
});

describe('after a reload', { skip }, () => {
  let r, home;
  before(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-home-'));
    const first = await openLapka('reload-a', WAIT + `
      await until('boot', () => !$('#empty').classList.contains('hide'));
      $('#linkInput').value = site + '/s/links/ep-3';
      $('#linkForm').requestSubmit();
      await until('source', () => $('#video').getAttribute('src'));
      await until('session', () => localStorage.getItem('lapka.session'));
      __report({ errors: window.__errors, session: localStorage.getItem('lapka.session') });
    `, { site: site.base, budget: 15000, home });
    ok(first, 'reload-a');
    const seed = { 'lapka.session': first.session };
    r = await openLapka('reload-b', WAIT + `
      await until('queue', () => $$('#queueList .item').length === 3);
      await __settled();
      __report({
        errors: window.__errors,
        rows: $$('#queueList .item').map(li => li.classList.contains('active')),
        src: $('#video').getAttribute('src'),
        title: $('#titleName').textContent,
      });
    `, { site: site.base, budget: 15000, home, seed });
  });
  after(async () => { if (home) await fsp.rm(home, { recursive: true, force: true }); });
  test('the series and the episode come back, not started', () => {
    ok(r, 'reload-b'); assert.deepEqual(r.errors, []);
    assert.deepEqual(r.rows, [false, false, true]);
    assert.match(r.title, /\b3\b/);
    assert.equal(r.src, null);
  });
});

describe('the interface holds together', { skip }, () => {
  let r;
  before(async () => {
    r = await openLapka('ui', WAIT + `
      await until('boot', () => !$('#empty').classList.contains('hide'));
      /* every language: the same keys, the page repainted whole */
      const dict = window.I18N.dict, en = Object.keys(dict.en).sort();
      const uneven = Object.entries(dict).filter(([, d]) => JSON.stringify(Object.keys(d).sort()) !== JSON.stringify(en)).map(([c]) => c);
      $('#btnGear').click(); await __settled();
      const cols = $$('#gearMenu .menu__col').length;
      const langs = $$('#gearMenu .menu__col--side .menu__item').length;
      const ruBtn = $$('#gearMenu .menu__col--side .menu__item').find(b => b.textContent.includes('Русский'));
      ruBtn.click(); await __settled();
      const ruTitle = $('#empty h1').textContent, ruOpen = $('#btnOpen').textContent, ruPlaceholder = $('#linkInput').placeholder;
      /* icons: filled, none left as an outline */
      const icons = $$('svg.ph');
      const outlined = icons.filter(s => getComputedStyle(s).fill === 'none').length;
      __report({ errors: window.__errors, uneven, cols, langs, ruTitle, ruOpen, ruPlaceholder, icons: icons.length, outlined, lang: document.documentElement.lang });
    `, { budget: 8000, fonts: true });
  });
  test('ten languages, all with the same keys, and switching repaints the link screen', () => {
    ok(r, 'ui'); assert.deepEqual(r.errors, []);
    assert.deepEqual(r.uneven, []);
    assert.equal(r.langs, 10);
    assert.equal(r.cols, 3);
    assert.equal(r.lang, 'ru');
    assert.equal(r.ruTitle, 'Вставьте ссылку');
    assert.equal(r.ruOpen, 'Открыть');
    assert.match(r.ruPlaceholder, /Ссылка/);
  });
  test('icons are there and filled', () => {
    assert.ok(r.icons > 20, String(r.icons));
    assert.equal(r.outlined, 0);
  });
});

describe('a narrow window', { skip }, () => {
  let r;
  before(async () => {
    r = await openLapka('narrow', WAIT + `
      await until('boot', () => !$('#empty').classList.contains('hide'));
      __report({ errors: window.__errors, queueOpen: $('#workspace').classList.contains('queue-open'), info: visible($('#btnInfo')), link: visible($('#linkInput')) });
    `, { budget: 6000, width: 420, height: 800 });
  });
  test('starts with the panel shut and the link in view', () => {
    ok(r, 'narrow'); assert.deepEqual(r.errors, []);
    assert.equal(r.queueOpen, false);
    assert.equal(r.link, true);
  });
});
