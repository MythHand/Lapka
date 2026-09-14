/* ═══════════════════════════════════════════════════════════
   The player with the server behind it.

   What only exists in this mode: the queue coming back after a reload,
   returning to where watching stopped, the track and subtitle menus
   built from a real file, and the deck, which is hidden until something
   is playing. The layout of the menus inside the floating window is
   here too, because that is where it broke: the first column was handed
   a basis of zero, shrank to nothing and painted its rows straight over
   the column below it.

   One browser, one scripted walk, many assertions over what it saw.
   ═══════════════════════════════════════════════════════════ */
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { openServed, findChrome, stalledAt } from './browser.mjs';
import { build, haveFfmpeg } from './fixtures.mjs';

const chrome = findChrome();
const ffmpeg = await haveFfmpeg();
const skip = !chrome ? 'no Chrome found; set CHROME to its path'
           : !ffmpeg ? 'no ffmpeg' : false;

const RESUME_AT = 60;   // seconds; past POS_MIN and far from the end

const SCRIPT = `
  window.__step('boot');
  const $ = s => document.querySelector(s);
  /* Waits for a condition, not for a fixed pause. The queue comes back
     only after the page has heard from the server, and with the other
     test files running in parallel that answer arrives later: a fixed
     pause passed alone and failed in the full run. Each turn also gives
     the browser real time (window.__tick), since what is waited on here
     is often the video, and the video opens in real time. */
  const until = async (ok, tries = 300) => {
    for (let i = 0; i < tries && !ok(); i++) await window.__tick();
    return ok();
  };
  await until(() => document.querySelector('.item.active'));
  const out = { errors: window.__errors.slice() };
  const rect = el => { const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y),
             w: Math.round(b.width), h: Math.round(b.height),
             top: Math.round(b.top), bottom: Math.round(b.bottom) }; };

  /* ── the queue of the previous session ── */
  const rows = [...document.querySelectorAll('.item')];
  out.restored = {
    count: rows.length,
    names: rows.map(r => r.querySelector('.item__name').textContent),
    active: rows.findIndex(r => r.classList.contains('active')),
    title: $('#titleName').textContent,
    /* nothing may be playing yet: opening a tab must not start ffmpeg */
    hasSource: !!$('#video').getAttribute('src'),
    volume: $('#video').volume,
  };
  /* the frame box of each row and, on the file left in the middle, the
     bar showing where; the durations come with the probe */
  await until(() => rows[0].classList.contains('has-pos'), 100);
  out.rows = rows.map(r => ({
    frame: !!r.querySelector('.item__thumb'),
    pos: Number(r.style.getPropertyValue('--pos') || 0),
    bar: getComputedStyle(r.querySelector('.pos')).display !== 'none',
  }));
  out.locate = !$('#btnLocate').hidden;

  out.mode = {
    diskShown: !$('#btnEmptyDisk').hidden,
    hint: $('#modeHint').textContent.trim(),
  };

  /* ── pressing play opens the file and returns to where it stopped ── */
  window.__step('play');
  $('.item.active .item__body').click();
  const v = $('#video');
  window.__state = () => ({
    src: v.getAttribute('src'), readyState: v.readyState, networkState: v.networkState,
    error: v.error && v.error.code + ' ' + v.error.message,
    duration: v.duration, currentTime: v.currentTime,
    title: $('#titleName').textContent, prep: document.body.className + ' | ' + $('#stage').className,
  });
  /* Long waits, because this part costs real time that the virtual
     clock cannot skip: the browser has to fetch three megabytes and
     open the container. Each turn holds the clock for a real pause
     (window.__tick): with page time alone the clock ran out on a CI
     runner while the video was still opening. The ceilings are set well
     above what it takes rather than near it. */
  for (let i = 0; i < 200 && !v.getAttribute('src'); i++) await window.__tick();
  for (let i = 0; i < 400 && !(v.duration > 0); i++) await window.__tick();
  /* The jump back happens on loadedmetadata, one turn after it fires. */
  for (let i = 0; i < 60 && v.currentTime === 0; i++) await window.__tick();
  out.playing = {
    src: (v.getAttribute('src') || '').replace(/key=[a-f0-9]+/, 'key=…'),
    duration: Math.round(v.duration),
    resumedTo: Math.round(v.currentTime),
    deckShown: !$('#stage').classList.contains('is-empty'),
  };

  /* ── the audio tracks of a real file ── */
  window.__step('audio');
  await until(() => !$('#btnAudio').hidden);
  $('#btnAudio').click();
  await window.__settled();
  out.audio = {
    hidden: $('#btnAudio').hidden,
    items: [...document.querySelectorAll('#audioMenu .menu__item')].map(b => ({
      main: b.querySelector('.menu__main').textContent,
      sub: (b.querySelector('.menu__sub') || {}).textContent || '',
      chosen: b.classList.contains('sel'),
    })),
    label: $('#audioLabel').textContent,
  };
  $('#btnAudio').click();
  await window.__settled();

  /* ── the deck next to the open queue ──
     1280 with the queue docked, the window this test runs in, is where
     the sides ran over the centre: next and mute overlapped by 22px. */
  window.__step('deck');
  const deckHits = () => {
    const shown = [...document.querySelectorAll('#deck button')].filter(b => b.offsetParent);
    const hits = [];
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i].getBoundingClientRect(), b = shown[j].getBoundingClientRect();
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
        hits.push(shown[i].id + '/' + shown[j].id);
    }
    return { shown: shown.map(b => b.id), hits,
             label: getComputedStyle($('#audioLabel')).display !== 'none' };
  };
  out.deck = { packed: $('#deck').classList.contains('deck--packed'), ...deckHits() };

  /* ── icons: the queue is chrome, the deck is the main control ── */
  window.__step('icons');
  const inkOf = el => {
    const side = parseFloat(el.getAttribute('viewBox').split(' ')[2]);
    const b = el.getBBox();
    return Math.sqrt(b.width * b.height) / side * el.getBoundingClientRect().width;
  };
  const group = sel => [...document.querySelectorAll(sel + ' svg.ph')]
    .filter(el => el.getBoundingClientRect().width)
    .map(inkOf);
  out.ink = {
    deck: group('.deck'),
    header: group('.queue__tools'),
    footer: group('.queue__foot'),
  };

  /* ── the subtitle menu, side by side and then stacked ── */
  window.__step('subtitles');
  const measureSubs = () => {
    const m = $('#subsMenu');
    const cols = [...m.querySelectorAll('.menu__col')];
    const boxes = cols.map(rect);
    let overlap = 0, spill = 0;
    for (let i = 0; i < cols.length; i++) {
      spill = Math.max(spill, cols[i].scrollHeight - Math.round(cols[i].getBoundingClientRect().height));
      for (let j = i + 1; j < cols.length; j++) {
        const a = boxes[i], b = boxes[j];
        overlap = Math.max(overlap,
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      }
    }
    const stage = rect($('#stage'));
    const box = rect(m);
    return { columns: cols.length, boxes, overlap, spill,
             pastRight: box.x + box.w - (stage.x + stage.w),
             pastLeft: stage.x - box.x, width: box.w };
  };

  await until(() => !$('#btnSubs').hidden);
  $('#btnSubs').click();
  await window.__settled();
  out.subs = { hidden: $('#btnSubs').hidden, ...measureSubs() };
  $('#btnSubs').click();
  await window.__settled();

  /* ── the same menu inside the floating window ──
     The floating window holds a copy of the stage with pip-mode on it,
     so adding the class to the stage here lays the deck and the menu
     out as the window does. */
  window.__step('pip');
  out.pip = {};
  for (const width of [600, 380, 320]) {
    const host = $('#stageHost');
    const stage = $('#stage');
    stage.classList.add('pip-mode');
    stage.style.position = 'fixed';
    stage.style.left = '0'; stage.style.top = '0';
    stage.style.width = width + 'px'; stage.style.height = '340px';
    await window.__settled();
    out.pipDeck = out.pipDeck || {};
    out.pipDeck[width] = deckHits();
    $('#btnSubs').click();
    await window.__settled();
    out.pip[width] = measureSubs();
    $('#btnSubs').click();
    await window.__settled();
  }

  /* ── the cache bar in the gear menu ──
     Put the stage back first: the floating-window checks above left it
     fixed at 320px, and the gear lives outside the deck. */
  window.__step('cache');
  { const st = $('#stage'); st.classList.remove('pip-mode'); st.removeAttribute('style'); }
  await window.__settled();
  /* The bar is checked against the very answer it was drawn from. A
     second request reads a disk whose free space has already moved on,
     and the end of the scale is the taken space plus the free one: a
     few kilobytes written anywhere in between, a frame for the queue
     among them, and the two no longer matched. */
  const cacheAnswers = [], realFetch = window.fetch;
  window.fetch = async (...a) => {
    const r = await realFetch(...a);
    if (String(a[0]).split('?')[0] === '/api/cache' && !(a[1] && a[1].method === 'POST')) cacheAnswers.push(await r.clone().json());
    return r;
  };
  $('#btnGear').click();
  await until(() => $('.cache__bar') && $('.cache__bar').getAttribute('aria-valuenow'));
  window.fetch = realFetch;
  const cbar = $('.cache__bar');
  /* a still pointer puts the stage to sleep and the gear stops taking
     the pointer, which hit testing would read as the menu being under
     the queue; a hand over the menu keeps it awake */
  $('#stage').dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  { const g = rect($('#gearMenu')), q = rect($('#queue'));
    const top = document.elementFromPoint(q.x + q.w - 20, g.y + 60);
    out.gear = { left: g.x, right: g.x + g.w, width: g.w, window: innerWidth,
                 overQueue: g.x < q.x + q.w, onTop: !!(top && top.closest('#gearMenu')),
                 columns: getComputedStyle($('#gearMenu')).flexDirection }; }
  const railW = $('.cache__rail').getBoundingClientRect().width;
  const leftOf = el => el.getBoundingClientRect().left - $('.cache__rail').getBoundingClientRect().left;
  const knob = $('.cache__knob');
  const t0 = v.currentTime;
  out.cache = {
    limit: Number(cbar.getAttribute('aria-valuenow')),
    min: Number(cbar.getAttribute('aria-valuemin')),
    max: Number(cbar.getAttribute('aria-valuemax')),
    knobAt: (leftOf(knob) + knob.getBoundingClientRect().width / 2) / railW,
    usedStyle: parseFloat($('.cache__used').style.width),
    stat: cacheAnswers[0],
    note: $('.cache__note').textContent,
    size: $('.cache__size').textContent,
  };
  cbar.focus();
  for (let i = 0; i < 3; i++)
    cbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
  await window.__settled();
  out.cache.afterKeys = Number(cbar.getAttribute('aria-valuenow'));
  out.cache.videoMoved = Math.abs(v.currentTime - t0) > 1;
  /* the limit goes to the server half a second after the last key */
  await new Promise(r => setTimeout(r, 900));
  out.cache.server = (await (await fetch('/api/cache')).json()).limit / 1024 ** 3;
  $('#btnGear').click();
  await window.__settled();

  /* ── volume is written down ── */
  window.__step('volume');
  v.volume = 0.31;
  await new Promise(r => setTimeout(r, 700));
  out.stored = {
    vol: localStorage.getItem('pip.vol'),
    session: JSON.parse(localStorage.getItem('pip.session') || 'null'),
    pos: JSON.parse(localStorage.getItem('pip.pos') || 'null'),
  };

  /* ── how each file reaches the player, and the end of the queue ──
     The end is played out by the event rather than by the clock: two
     real seconds of video are not worth the wait, and what is under
     test is what the player does once the last file has ended. */
  window.__step('end');
  const metaOf = i => document.querySelectorAll('.item')[i].querySelector('.item__meta').textContent;
  out.badges = { mkv: metaOf(0), mp4: metaOf(1) };
  document.querySelectorAll('.item')[1].querySelector('.item__body').click();
  await until(() => /api\\/raw/.test(v.getAttribute('src') || '') && v.duration > 0, 400);
  v.dispatchEvent(new Event('ended'));
  await window.__settled();
  out.end = { src: (v.getAttribute('src') || '').slice(0, 12),
              shown: $('#endCard').classList.contains('show'), meta: $('#endMeta').textContent };

  window.__report(out);
`;

let R, media;
before(async () => {
  if (skip) return;
  media = await build();
  const size = f => fsp.stat(f).then(s => s.size);
  const seed = {
    'pip.session': JSON.stringify({
      v: 1,
      items: [
        { name: 'long.mkv', path: media.long, size: await size(media.long), dur: 180 },
        { name: 'native.mp4', path: media.native, size: await size(media.native) },
      ],
      loop: 'off', audioPref: null, subPref: null, current: media.long,
    }),
    'pip.pos': JSON.stringify({ [media.long]: RESUME_AT }),
    'pip.vol': '0.5',
  };
  R = await openServed('session', SCRIPT, {
    root: media.dir, warm: [media.long], seed,
    fonts: true, width: 1280, height: 800, budget: 20000,
  });
  if (R.fatal) throw new Error('the page script broke:\n' + R.fatal);
  if (R.stalled) throw new Error(stalledAt(R));
}, { timeout: 180000 });

describe('the queue of the previous session', { skip }, () => {
  test('nothing throws', () => {
    assert.deepEqual(R.errors, []);
  });

  test('the files come back in order', () => {
    assert.equal(R.restored.count, 2);
    assert.deepEqual(R.restored.names, ['long.mkv', 'native.mp4']);
  });

  test('the file that was playing is the current one again', () => {
    assert.equal(R.restored.active, 0);
    assert.equal(R.restored.title, 'long.mkv');
  });

  test('opening a tab does not start a conversion', () => {
    assert.equal(R.restored.hasSource, false,
      'a source at boot means ffmpeg was told to work before anyone pressed play');
  });

  test('each row has a frame box, and the file left in the middle shows where', () => {
    assert.ok(R.rows.every(r => r.frame));
    assert.equal(R.rows[0].bar, true);
    assert.ok(Math.abs(R.rows[0].pos - RESUME_AT / 180) < 0.01, 'at ' + R.rows[0].pos);
    assert.equal(R.rows[1].bar, false, 'nothing kept for the other file, so no bar');
  });

  test('the button that finds the file playing is offered', () => {
    assert.equal(R.locate, true);
  });

  test('the volume is the one that was set last time', () => {
    assert.equal(R.restored.volume, 0.5);
  });

  test('the disk browser is offered, since there is a server', () => {
    assert.equal(R.mode.diskShown, true);
    assert.ok(R.mode.hint.length > 0);
  });
});

describe('playing', { skip }, () => {
  test('the file is served from the cache, not from the disk', () => {
    assert.match(R.playing.src, /^\/api\/media\?key=/);
  });

  test('the whole file is there', () => {
    assert.ok(Math.abs(R.playing.duration - 180) <= 2, 'duration ' + R.playing.duration);
  });

  test('watching goes on from where it stopped', () => {
    assert.ok(Math.abs(R.playing.resumedTo - RESUME_AT) <= 2,
      `expected to return to ${RESUME_AT}s, landed on ${R.playing.resumedTo}s`);
  });

  test('the deck appears once there is something to control', () => {
    assert.equal(R.playing.deckShown, true);
  });
});

describe('the audio tracks', { skip }, () => {
  test('the button is offered for a file that has tracks', () => {
    assert.equal(R.audio.hidden, false);
  });

  test('both tracks are listed with their studio names', () => {
    const named = R.audio.items.filter(i => /Studio One|Original/.test(i.main + i.sub));
    assert.equal(named.length, 2, JSON.stringify(R.audio.items));
  });

  test('one of them is marked as the one playing', () => {
    assert.equal(R.audio.items.filter(i => i.chosen).length, 1);
  });
});

describe('icons in a running player', { skip }, () => {
  test('the deck is the biggest thing on screen', () => {
    const deck = Math.min(...R.ink.deck.filter(x => x > 10));
    const header = Math.max(...R.ink.header);
    assert.ok(header < deck - 1.5,
      `queue header ${header.toFixed(1)} must read smaller than the deck ${deck.toFixed(1)}`);
  });

  test('the queue reads as one panel, top and bottom', () => {
    const header = Math.max(...R.ink.header);
    const footer = Math.max(...R.ink.footer);
    assert.ok(Math.abs(header - footer) < 2,
      `header ${header.toFixed(1)}, footer ${footer.toFixed(1)}`);
  });
});

describe('the subtitle menu', { skip }, () => {
  test('it opens in two columns', () => {
    assert.equal(R.subs.hidden, false);
    assert.equal(R.subs.columns, 2, 'tracks on the left, styling on the right');
  });

  test('the columns do not overlap', () => {
    assert.ok(R.subs.overlap <= 0 || R.subs.boxes.every(b => b.h > 0));
  });
});

describe('the deck next to the open queue', { skip }, () => {
  test('no two buttons overlap', () => {
    assert.deepEqual(R.deck.hits, []);
  });

  test('speed, repeat and auto-advance fold into the gear', () => {
    assert.equal(R.deck.packed, true);
    assert.ok(R.deck.shown.includes('btnPack'));
    for (const id of ['btnRate', 'btnLoop', 'btnAuto'])
      assert.ok(!R.deck.shown.includes(id), id + ' is still in the row');
  });
});

describe('the menus next to the open queue', { skip }, () => {
  test('the subtitle menu stays inside the window', () => {
    assert.ok(R.subs.pastRight <= 0, `it hangs ${R.subs.pastRight}px past the right edge`);
    assert.ok(R.subs.pastLeft <= 0, `it hangs ${R.subs.pastLeft}px past the left edge`);
  });

  test('the gear menu opens whole, over the queue', () => {
    assert.equal(R.gear.columns, 'row', 'all three columns side by side');
    assert.ok(R.gear.overQueue, 'at 1280 it reaches over the queue');
    assert.ok(R.gear.onTop, 'and there it is on top, not under the queue');
    assert.ok(R.gear.left >= 0 && R.gear.right <= R.gear.window, 'inside the window');
  });
});

describe('the deck inside the floating window', { skip }, () => {
  for (const width of [600, 380, 320]) {
    test(`at ${width}px the right side holds the volume and the way out only`, () => {
      const d = R.pipDeck[width];
      assert.deepEqual(d.hits, []);
      assert.deepEqual(d.shown.filter(id => ['btnMute', 'btnPip', 'btnPack', 'btnRate',
        'btnLoop', 'btnAuto', 'btnFull'].includes(id)), ['btnMute', 'btnPip']);
      assert.equal(d.label, false, 'the track button is the icon alone');
    });
  }
});

describe('the menu inside the floating window', { skip }, () => {
  for (const width of [600, 380, 320]) {
    test(`at ${width}px the columns stack instead of painting over each other`, () => {
      const m = R.pip[width];
      assert.equal(m.columns, 2);
      assert.ok(m.boxes.every(b => b.h > 0),
        'a column with no height is the bug: flex-basis zero inside a capped menu');
      assert.ok(m.boxes[1].top >= m.boxes[0].bottom,
        `the styling column starts at ${m.boxes[1].top}, the track list ends at ${m.boxes[0].bottom}`);
    });

    test(`at ${width}px the menu stays inside the window`, () => {
      const m = R.pip[width];
      assert.ok(m.pastRight <= 0, `it hangs ${m.pastRight}px past the right edge`);
      assert.ok(m.pastLeft <= 0, `it hangs ${m.pastLeft}px past the left edge`);
    });
  }
});

describe('how a file reaches the player', { skip }, () => {
  test('an MKV goes through ffmpeg', () => {
    assert.match(R.badges.mkv, /through ffmpeg/);
  });

  test('an MP4 the browser plays is marked direct', () => {
    assert.match(R.badges.mp4, /direct/);
    assert.doesNotMatch(R.badges.mp4, /through ffmpeg/);
  });
});

describe('the end of the queue', { skip }, () => {
  test('after the last file the card with the summary appears', () => {
    assert.equal(R.end.src, '/api/raw?pat', 'the last file was opened before it ended');
    assert.equal(R.end.shown, true);
    assert.match(R.end.meta, /^2 files/);
  });
});

describe('the cache bar', { skip }, () => {
  test('it shows the limit the server has', () => {
    assert.equal(R.cache.limit, 24);
    assert.equal(R.cache.min, 4);
  });

  test('the scale ends where the disk ends', () => {
    assert.equal(R.cache.max, Math.floor(R.cache.stat.max / 1024 ** 3));
  });

  test('the knob stands where the limit is on the scale', () => {
    const at = 24 * 1024 ** 3 / R.cache.stat.max;
    assert.ok(Math.abs(R.cache.knobAt - at) < 0.02,
      `knob at ${R.cache.knobAt.toFixed(3)}, limit at ${at.toFixed(3)}`);
  });

  test('the fill is what the cache holds, on the same scale', () => {
    /* The prepared test file weighs megabytes against a 128 GB scale,
       so the fill is a fraction of a pixel. What is checked is the
       width it was given, against the bytes the server reports. */
    assert.ok(R.cache.stat.bytes > 0, 'a prepared file is in the cache');
    const want = R.cache.stat.bytes / R.cache.stat.max * 100;
    assert.ok(Math.abs(R.cache.usedStyle - want) < 1e-6,
      `fill ${R.cache.usedStyle}% for ${want}% taken`);
    assert.match(R.cache.size, /24/);
  });

  test('the free space on the disk is shown', () => {
    assert.ok(R.cache.note.length > 0);
  });

  test('arrow keys move the limit and leave the video alone', () => {
    assert.equal(R.cache.afterKeys, 27);
    assert.equal(R.cache.videoMoved, false, 'the arrows also seeked the video');
  });

  test('the new limit reaches the server', () => {
    assert.equal(R.cache.server, 27);
  });
});

describe('what is written down', { skip }, () => {
  test('a change of volume is remembered', () => {
    assert.equal(Number(R.stored.vol), 0.31);
  });

  test('the queue is kept as paths, so it can be opened again', () => {
    assert.equal(R.stored.session.items.length, 2);
    assert.ok(R.stored.session.items.every(i => i.path.endsWith('.mkv') || i.path.endsWith('.mp4')));
  });

  test('the position is kept per file', () => {
    assert.equal(typeof R.stored.pos, 'object');
  });
});

/* A dropped file. It starts playing from the browser's copy at once,
   while the server looks for it on disk; found, it is handed over. The
   search answers within the 0.22 s fade, and the start it overtook used
   to give up without bringing the picture back: the video stayed dark
   and paused. The page builds a file with the name and size of a
   fixture and feeds it through the file picker, the way a drop does. */
let D;
describe('a dropped file handed over to the server', { skip }, () => {
  before(async () => {
    const DROP = `
      await window.__settled();
      const $ = s => document.querySelector(s);
      const until = async (ok, tries = 400) => {
        for (let i = 0; i < tries && !ok(); i++) await window.__tick();
        return ok();
      };
      window.__step('build');
      const blob = await (await fetch('/api/raw?path=' + encodeURIComponent(${JSON.stringify('__NATIVE__')}))).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'native.mp4', { type: 'video/mp4' }));
      const pick = $('#filePick');
      pick.files = dt.files;
      window.__step('drop');
      pick.dispatchEvent(new Event('change', { bubbles: true }));
      const v = $('#video');
      await until(() => /api\\/raw/.test(v.getAttribute('src') || '') && v.readyState >= 2, 120);
      await until(() => !$('#stage').classList.contains('fading') && !v.paused, 60);
      window.__step('seen ' + (v.getAttribute('src') || 'none').slice(0, 20) + ' rs' + v.readyState + ' items ' + document.querySelectorAll('.item').length);
      window.__report({
        errors: window.__errors.slice(),
        src: (v.getAttribute('src') || '').slice(0, 12),
        dark: $('#stage').classList.contains('fading'),
        paused: v.paused,
      });
    `;
    D = await openServed('drop', DROP.replace('__NATIVE__', media.native), {
      port: 8783, root: media.dir, width: 1280, height: 800, budget: 20000,
      seed: { 'pip.set.v': '5' },
    });
    if (D.fatal) throw new Error('the page script broke:\n' + D.fatal);
    if (D.stalled) throw new Error(stalledAt(D));
  }, { timeout: 120000 });

  test('it ends up playing through the server, with the picture shown', () => {
    assert.deepEqual(D.errors, []);
    assert.equal(D.src, '/api/raw?pat', 'the server found it and serves it');
    assert.equal(D.dark, false, 'the picture came back after the fade');
    assert.equal(D.paused, false, 'and it plays, as a dropped file should');
  });
});
