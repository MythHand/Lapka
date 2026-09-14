/* ═══════════════════════════════════════════════════════════
   The interface, opened straight from a file.

   Pure file:// is one of the two modes the player has to work in, so
   these run with no server at all. One browser is started, it walks
   through a scripted sequence and records what it sees; the assertions
   below read that record. Starting a browser per assertion would turn a
   two second suite into a minute.
   ═══════════════════════════════════════════════════════════ */
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openFile, findChrome, stalledAt } from './browser.mjs';

const chrome = findChrome();
const P0 = 204.81;      // the normalisation constant of the icon set

/* Runs inside the page. Everything it returns has to survive JSON, so
   only numbers, strings and plain objects. */
const SCRIPT = `
  await window.__settled();
  window.__step('boot');
  const out = { errors: window.__errors.slice() };
  const $ = s => document.querySelector(s);
  const text = s => ($(s) || {}).textContent || '';

  /* ── what the empty screen shows ── */
  out.boot = {
    lang: document.documentElement.lang,
    title: text('.empty h1').trim(),
    hint: text('#modeHint').trim(),
    emptyShown: !$('#empty').classList.contains('hide'),
    diskHidden: $('#btnEmptyDisk').hidden,
    /* the attribute alone proves nothing: a class with its own display
       overrides it, so what is checked is whether it is drawn */
    footerDiskDrawn: getComputedStyle($('#btnDisk')).display !== 'none',
    /* by id: the end of queue card on the stage has a filled button of
       its own, and only the start screen's one is asked about */
    primary: [...document.querySelectorAll('#empty .btn--solid')].map(b => b.id),
    docTitle: document.title,
    /* with no files the header names the panel instead of offering
       controls with nothing to act on, and there is no cross to shut it */
    header: {
      title: getComputedStyle($('.queue__title')).display !== 'none' ? text('.queue__title').trim() : '',
      controls: [...document.querySelectorAll('.queue__tools .toolgrp')].some(g => getComputedStyle(g).display !== 'none'),
      close: !$('#btnQueueClose').hidden,
      info: getComputedStyle($('.info')).display !== 'none',
    },
  };

  /* ── settings arrived from the table, not from the markup ── */
  out.settings = {
    docked: $('#workspace').classList.contains('queue-docked'),
    font: document.documentElement.dataset.font,
    dragOn: !$('#queueList').classList.contains('no-drag'),
  };

  /* The queue has to be open for anything inside it to have a size.
     It already is at boot, so this only covers the case where that
     default changes: clicking blindly would close it instead. */
  if (!$('#workspace').classList.contains('queue-open')) {
    $('#btnList').click();
    await window.__settled();
  }

  /* ── every icon on the page ── */
  const box = el => el.getBoundingClientRect();
  const area = el => {
    const vb = parseFloat(el.getAttribute('viewBox').split(' ')[2]);
    const b = el.getBBox();
    return { side: vb, ink: Math.sqrt(b.width * b.height), px: box(el).width };
  };
  window.__step('icons');
  /* The header is measured as it is with files in the queue: empty, it
     hides its controls and its cross, and there would be nothing to
     compare the footer with. */
  $('#queue').classList.remove('queue--empty');
  $('#btnQueueClose').hidden = false;
  $('#btnLocate').hidden = false;
  out.icons = [];
  for (const el of document.querySelectorAll('svg.ph')) {
    if (!box(el).width) continue;
    const a = area(el);
    const btn = el.closest('button');
    out.icons.push({
      id: btn && btn.id || '',
      where: el.closest('.queue__tools') ? 'header'
           : el.closest('.queue__foot') ? 'footer'
           : el.closest('.deck') ? 'deck' : 'other',
      p0: 256 * 256 * a.ink / (a.side * a.side),
      inkPx: a.ink / a.side * a.px,
      fill: getComputedStyle(el).fill,
    });
  }
  $('#queue').classList.add('queue--empty');
  $('#btnQueueClose').hidden = true;
  $('#btnLocate').hidden = true;

  /* ── the gear menu ── */
  window.__step('gear');
  $('#btnGear').click();
  await window.__settled();
  const gear = $('#gearMenu');
  out.gear = {
    open: gear.classList.contains('open'),
    columns: gear.querySelectorAll('.menu__col').length,
    keyRows: gear.querySelectorAll('.keys__row').length,
    languages: gear.querySelectorAll('.menu__col--side .menu__item').length,
    settingRows: gear.querySelectorAll('.menu__row').length,
    /* the menu must sit under the gear, not against the window edge */
    rightGap: Math.round(window.innerWidth - box(gear).right),
    topGap: Math.round(box(gear).top - box($('#btnGear')).bottom),
  };
  /* with nothing in the queue: the stage carried the start screen's class
     and its z-index 7, and the menu opened under the queue */
  { const q = box($('#queue')), g = box(gear);
    const hit = document.elementFromPoint(Math.round((g.left + q.right) / 2), Math.round(g.top + 80));
    out.gear.overQueue = g.left < q.right;
    out.gear.onTop = !!(hit && hit.closest('#gearMenu')); }

  /* ── switching language repaints everything at once ── */
  window.__step('language');
  const ru = [...gear.querySelectorAll('.menu__col--side .menu__item')]
    .find(b => b.textContent.trim() === 'Русский');
  ru.click();
  await window.__settled();
  out.ru = {
    lang: document.documentElement.lang,
    title: text('.empty h1').trim(),
    hint: text('#modeHint').trim(),
    queueCount: text('#queueFiles').trim(),
    tooltip: $('#btnPlay').title,
  };

  /* ── the dictionaries themselves ── */
  window.__step('dictionaries');
  const D = window.I18N.dict, list = window.I18N.list;
  const base = Object.keys(D.en).sort();
  out.i18n = {
    languages: list.length,
    keys: base.length,
    mismatched: list.map(([c]) => c).filter(c => {
      const k = Object.keys(D[c] || {}).sort();
      return k.length !== base.length || k.some((x, i) => x !== base[i]);
    }),
    /* plural shapes: Russian needs one/few/many, English only one/other */
    ruPlural: Object.keys(D.ru['queue.count']).sort().join(','),
    enPlural: Object.keys(D.en['queue.count']).sort().join(','),
  };

  /* ── typography: one letter words are glued to the next one ── */
  out.nbsp = {
    hintHasNbsp: /\\u00A0/.test(text('#modeHint')),
    hintDangling: / [авиксоуяжб] /i.test(text('#modeHint')),
  };

  /* ── hotkeys follow the physical key, not the character ── */
  window.__step('keyboard');
  const fired = [];
  document.addEventListener('keydown', e => fired.push(e.code), true);
  const before = $('#workspace').classList.contains('queue-open');
  /* AZERTY: pressing the physical Q key produces the letter "a" */
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'a', bubbles: true }));
  await window.__settled();
  out.keys = { fired, before, after: $('#workspace').classList.contains('queue-open') };

  window.__report(out);
`;

let R;
before(async () => {
  if (!chrome) return;
  R = await openFile('ui', SCRIPT, { fonts: true, width: 1280, height: 800 });
  if (R.fatal) throw new Error('the page script broke:\n' + R.fatal);
  if (R.stalled) throw new Error(stalledAt(R));
}, { timeout: 120000 });

const skip = !chrome && 'no Chrome found; set CHROME to its path';

describe('the queue header with no files', { skip }, () => {
  test('names the panel instead of showing the view and order controls', () => {
    assert.equal(R.boot.header.title, 'About');
    assert.equal(R.boot.header.controls, false);
  });

  test('has no cross, there would be no way back', () => {
    assert.equal(R.boot.header.close, false);
    assert.equal(R.boot.header.info, false, 'the info button is for a shut panel');
  });
});

describe('opening the page', { skip }, () => {
  test('nothing throws on the way up', () => {
    assert.deepEqual(R.errors, []);
  });

  test('the static text is translated in place', () => {
    assert.ok(R.boot.title.length > 0, 'the heading is not left as a key');
    assert.ok(!R.boot.title.includes('.'), 'a heading with a dot in it is an untranslated key');
    assert.equal(R.boot.docTitle, 'PIP Player');
  });

  test('without a server the disk browser is not offered', () => {
    assert.equal(R.boot.diskHidden, true);
    assert.equal(R.boot.footerDiskDrawn, false, 'the button in the queue footer is still drawn');
    assert.deepEqual(R.boot.primary, ['btnEmptyFiles'],
      'choosing files is the main action when there is no server');
  });

  test('the empty screen is shown only once the mode is known', () => {
    assert.equal(R.boot.emptyShown, true);
    assert.ok(R.boot.hint.length > 0, 'the mode hint is filled in');
  });
});

describe('settings reach the player, not just the menu', { skip }, () => {
  test('the queue starts docked', () => {
    assert.equal(R.settings.docked, true);
  });
  test('the typeface is applied at boot', () => {
    assert.equal(R.settings.font, 'fixel');
  });
  test('rows are draggable by default', () => {
    assert.equal(R.settings.dragOn, true);
  });
});

describe('icons', { skip }, () => {
  test('there are icons on the page at all', () => {
    /* The deck is not on screen here: with no file loaded the stage is
       empty and hides it, which is what it is supposed to do. What is
       measurable at this point is the queue and the gear. */
    assert.ok(R.icons.length >= 10, 'found ' + R.icons.length);
    assert.ok(R.icons.some(i => i.where === 'header'));
    assert.ok(R.icons.some(i => i.where === 'footer'));
  });

  test('every icon is filled, none is left as an outline', () => {
    const hollow = R.icons.filter(i => i.fill === 'none');
    assert.deepEqual(hollow.map(i => i.id), [],
      'a rule for svg somewhere is killing the fill of svg.ph');
  });

  test('every icon is normalised to the same perceived size', () => {
    /* The chevron of the PiP button is deliberately smaller and is the
       one exception; everything else must land on the constant. */
    const off = R.icons
      .filter(i => i.id !== 'btnPipMode')
      .filter(i => Math.abs(i.p0 - P0) / P0 > 0.02);
    assert.deepEqual(off.map(i => i.id + ':' + i.p0.toFixed(1)), [],
      'these icons were added without normalising the viewBox');
  });

  test('the header and the footer of the queue read as one panel', () => {
    /* The step down from the deck is checked in the served suite, where
       a file is playing and the deck is actually on screen. */
    const ink = w => R.icons.filter(i => i.where === w).map(i => i.inkPx);
    const header = Math.max(...ink('header'));
    const footer = Math.max(...ink('footer'));
    assert.ok(Math.abs(header - footer) < 2,
      `header ${header.toFixed(1)} and footer ${footer.toFixed(1)} belong to the same panel`);
  });
});

describe('the gear menu', { skip }, () => {
  test('with an empty queue it still opens over the queue, not under it', () => {
    assert.ok(R.gear.overQueue, 'at 1280 it reaches over the queue');
    assert.ok(R.gear.onTop, 'the queue covers the menu');
  });

  test('opens with all three columns', () => {
    assert.equal(R.gear.open, true);
    assert.equal(R.gear.columns, 3);
  });
  test('the shortcut list is there', () => {
    assert.ok(R.gear.keyRows >= 12, 'rows: ' + R.gear.keyRows);
  });
  test('every language is offered', () => {
    assert.equal(R.gear.languages, R.i18n.languages);
  });
  test('the settings rows are built from the table', () => {
    assert.ok(R.gear.settingRows >= 4, 'rows: ' + R.gear.settingRows);
  });
  test('it hangs under the gear rather than off the window edge', () => {
    assert.ok(R.gear.rightGap >= 0 && R.gear.rightGap < 80,
      'right gap ' + R.gear.rightGap);
    assert.ok(R.gear.topGap >= 0 && R.gear.topGap < 40, 'top gap ' + R.gear.topGap);
  });
});

describe('translations', { skip }, () => {
  test('ten languages, all with the same keys', () => {
    assert.equal(R.i18n.languages, 10);
    assert.deepEqual(R.i18n.mismatched, []);
  });

  test('Russian carries the plural forms Russian needs', () => {
    assert.equal(R.i18n.ruPlural, 'few,many,one,other');
    assert.equal(R.i18n.enPlural, 'one,other');
  });

  test('changing the language repaints the whole interface at once', () => {
    assert.equal(R.ru.lang, 'ru');
    assert.notEqual(R.ru.title, R.boot.title);
    assert.notEqual(R.ru.hint, R.boot.hint);
    assert.match(R.ru.queueCount, /файл/, 'built by code, not by the markup');
    assert.match(R.ru.tooltip, /[А-Яа-я]/, 'tooltips are translated too');
  });

  test('one letter words do not end up alone at the end of a line', () => {
    assert.equal(R.nbsp.hintHasNbsp, true, 'no non-breaking space was inserted');
    assert.equal(R.nbsp.hintDangling, false, 'a one letter word was left loose');
  });
});

describe('the keyboard', { skip }, () => {
  test('a shortcut follows the physical key, not the letter printed on it', () => {
    assert.deepEqual(R.keys.fired, ['KeyQ']);
    assert.notEqual(R.keys.after, R.keys.before,
      'the physical Q must toggle the queue even though the key produced "a"');
  });
});

/* A narrow window. The queue takes the whole width there, and docked
   beside the video, the default, it squeezed the frame to nothing: the
   stage came out 0px wide. In a narrow window it always lies over the
   video instead. */
const NARROW = `
  await window.__settled();
  const $ = s => document.querySelector(s);
  const out = { errors: window.__errors.slice() };
  out.start = {
    queueOpen: $('#workspace').classList.contains('queue-open'),
    info: getComputedStyle($('.info')).display !== 'none',
  };
  $('#btnInfo').click();
  await window.__settled();
  out.opened = {
    queueOpen: $('#workspace').classList.contains('queue-open'),
    docked: $('#workspace').classList.contains('queue-docked'),
    close: !$('#btnQueueClose').hidden,
    stage: Math.round($('#stageHost').getBoundingClientRect().width),
    startScreen: Math.round($('.empty__box').getBoundingClientRect().width),
    window: innerWidth,
  };
  window.__report(out);
`;
let N;
describe('a narrow window', { skip }, () => {
  before(async () => {
    N = await openFile('narrow', NARROW, { width: 800, height: 600 });
  }, { timeout: 60000 });

  test('it starts with the panel shut and the info button in its place', () => {
    assert.deepEqual(N.errors, []);
    assert.equal(N.start.queueOpen, false, 'the panel would cover the start screen whole');
    assert.equal(N.start.info, true);
  });

  test('opened, the queue lies over the video instead of squeezing it to nothing', () => {
    assert.equal(N.opened.queueOpen, true);
    assert.equal(N.opened.docked, false, 'docked is the setting, but not in a narrow window');
    assert.equal(N.opened.stage, N.opened.window, 'the frame keeps the whole width under the queue');
    assert.ok(N.opened.startScreen > 300, `the start screen under it shrank to ${N.opened.startScreen}px`);
    assert.equal(N.opened.close, true, 'covering everything, the panel keeps its cross as the way back');
  });
});
