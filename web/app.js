/* ═══════════════════════════════════════════════════════════
   Lapka, the player itself.
   One link in, a series with its episodes and dubs out, played
   through the local server.
   ═══════════════════════════════════════════════════════════ */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);

/* ═══════════════ interface language ═══════════════
   The dictionaries live in i18n.js and load through a plain script tag:
   the player has to work when opened straight from a file, and the
   browser forbids fetch over file://, so JSON on demand is out.

   The names of audio track languages are not kept here.
   Intl.DisplayNames returns them, three letter ffprobe codes included
   (rus, jpn). */
const LANG_LIST = (window.I18N && window.I18N.list) || [['en', 'English']];
const LANG_DICT = (window.I18N && window.I18N.dict) || { en: {} };

function pickLang() {
  let saved = null;
  try { saved = localStorage.getItem('lapka.lang'); } catch (_) {}
  if (saved && LANG_DICT[saved]) return saved;
  const want = navigator.languages && navigator.languages.length
    ? navigator.languages : [navigator.language || 'en'];
  for (const w of want) {
    const low = String(w).toLowerCase();
    const exact = LANG_LIST.find(([c]) => c.toLowerCase() === low);
    if (exact) return exact[0];
    const near = LANG_LIST.find(([c]) => c.toLowerCase().split('-')[0] === low.split('-')[0]);
    if (near) return near[0];
  }
  return 'en';
}

let lang = pickLang();
let pluralRules = new Intl.PluralRules(lang);
let langNames = new Intl.DisplayNames([lang], { type: 'language' });

/* A key with no translation falls back to English: another language
   beats a raw key. An object value holds plural forms, and
   Intl.PluralRules picks between them. */
function t(key, vars) {
  let v = LANG_DICT[lang][key];
  if (v === undefined) v = LANG_DICT.en[key];
  if (v === undefined) return key;
  if (typeof v === 'object') {
    const n = Number(vars && vars.n) || 0;
    v = v[pluralRules.select(n)] ?? v.other ?? v.one ?? '';
  }
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m);
  return typeset(v);
}

/* ── typography by the rules of each language ─────────────────
   One letter prepositions and conjunctions must not be left at the end
   of a line: they are glued to the next word with a non-breaking space.
   The rule belongs to Russian and Polish practice; French instead wants
   a non-breaking space before a colon, semicolon, question mark and
   exclamation mark, and inside guillemets. English, German, Spanish,
   Italian, Portuguese and Turkish know no such requirement, and Chinese
   puts no spaces between words at all.

   This happens on output rather than in the dictionary: that way the
   rule also covers strings added later, and the dictionaries stay
   readable without invisible characters. */
const NB = '\u00A0';
const ORPHANS = {
  ru: /(^|[\s(«„"'>])([авиксоуяжбАВИКСОУЯЖБ]) /g,
  pl: /(^|[\s(„"'>])([aiouwzAIOUWZ]) /g,
};

function typeset(v) {
  const re = ORPHANS[lang];
  if (re) return v.replace(re, (m, pre, w) => pre + w + NB);
  if (lang === 'fr') {
    return v.replace(/ ([;:!?»])/g, NB + '$1').replace(/« /g, '«' + NB);
  }
  return v;
}

/* The markup keeps its keys in data attributes: one pass and all the
   static text is in place. Everything dynamic is repainted by
   repaintUi. */
function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

function setLang(code) {
  if (!LANG_DICT[code] || code === lang) return;
  lang = code;
  pluralRules = new Intl.PluralRules(lang);
  langNames = new Intl.DisplayNames([lang], { type: 'language' });
  try { localStorage.setItem('lapka.lang', code); } catch (_) {}
  document.documentElement.lang = code;
  if (state.pipWin) state.pipWin.document.documentElement.lang = code;
  repaintUi();
}

/* The one place where the interface is repainted whole. Some captions
   live in the code rather than in the markup, and after a language
   change they all have to be rebuilt at once, otherwise half the
   interface stays in the old language. */
function repaintUi() {
  applyI18n();
  if (state.pipWin) applyI18n(state.pipWin.document);
  applySettings();
  paintPlay(); paintLoop(); paintAuto(); paintSeek(); paintVolume(); paintView();
  paintTitle(); paintEndMeta(); paintModeHint();
  if (skipNow) btnSkip.textContent = t('skip.' + skipNow.name);
  syncAudioButton(); syncSubsButton(); syncQualityButton(); syncStatus();
  render();
  closeMenus();
  fitFoot();         // the captions have changed length
}

/* ── dom ─────────────────────────────────────────────────── */
const workspace = $('#workspace'), stageHost = $('#stageHost'), stage = $('#stage');
const video = $('#video');
const titleName = $('#titleName'), titlePath = $('#titlePath');
const pulseEl = $('#pulse'), pulseIcon = $('#pulseIcon'), flashEl = $('#flash');
const notice = $('#notice'), noticeText = $('#noticeText');
const endCard = $('#endCard'), endMeta = $('#endMeta');
const emptyEl = $('#empty'), modeHint = $('#modeHint');
const prep = $('#prep'), prepName = $('#prepName'), prepTrack = $('#prepTrack'), prepHead = $('#prepHead');
const prepSteps = $('#prepSteps'), prepCmd = $('#prepCmd');
const deck = $('#deck'), seek = $('#seek'), seekFill = $('#seekFill');
const seekBuffer = $('#seekBuffer'), seekKnob = $('#seekKnob'), seekTip = $('#seekTip');
const tCur = $('#tCur'), tDur = $('#tDur');
const btnPlay = $('#btnPlay'), playIcon = $('#playIcon');
const btnMute = $('#btnMute'), volIcon = $('#volIcon'), volBar = $('#volBar'), volFill = $('#volFill');
const btnRate = $('#btnRate'), btnLoop = $('#btnLoop'), btnList = $('#btnList');
const btnAuto = $('#btnAuto');
const btnPip = $('#btnPip'), btnFull = $('#btnFull');
const btnPipMode = $('#btnPipMode'), pipMenu = $('#pipMenu'), pipSeg = $('#pipSeg');
const rateMenu = $('#rateMenu');
const btnAudio = $('#btnAudio'), audioLabel = $('#audioLabel'), audioMenu = $('#audioMenu');
const btnSubs = $('#btnSubs'), subsMenu = $('#subsMenu');
const btnQuality = $('#btnQuality'), qualityLabel = $('#qualityLabel'), qualityMenu = $('#qualityMenu');
const btnSaveAll = $('#btnSaveAll'), saveCount = $('#saveCount'), savePop = $('#savePop');
const tipEl = $('#tip');
const btnGear = $('#btnGear'), gearMenu = $('#gearMenu');
const queueList = $('#queueList'), queueFiles = $('#queueFiles'), queueTotal = $('#queueTotal');
const btnViewRows = $('#btnViewRows'), btnViewGrid = $('#btnViewGrid');
const ghostName = $('#ghostName'), pipGhost = $('#pipGhost');
const favicon = $('#favicon');
const dropveil = $('#dropveil'), toastEl = $('#toast');
const deckPack = $('#deckPack'), btnPack = $('#btnPack'), queueAdd = $('.queue__add');
const queueEl = $('#queue'), btnLocate = $('#btnLocate');
const linkForm = $('#linkForm'), linkInput = $('#linkInput');
const skipEl = $('#skip'), btnSkip = $('#btnSkip'), btnSkipHide = $('#btnSkipHide');
const queueLinkForm = $('#queueLinkForm'), queueLinkInput = $('#queueLinkInput');
const btnHistory = $('#btnHistory'), histPop = $('#histPop');
const MENUS = [audioMenu, pipMenu, rateMenu, subsMenu, qualityMenu, gearMenu];

/* ── fitting into narrow places ───────────────────────────────
   The layout was drawn for a wide window. Next to an open queue the
   stage is much narrower than the browser window, and so is the PiP
   window, and three things broke there: the deck, the menus and the
   queue footer. Each is fitted here after the fact. The rules for what
   gives way are in styles.css, next to the classes set below. */

/* The deck: speed, loop and autoplay fold into a gear, then the studio
   name loses letters, then goes and leaves the icon, then the buttons
   take their smaller size, and last the centre leaves the exact middle.
   Each side gets half of what the centre leaves, and a side that needs
   more takes the next step. */
const deckRow = deck.querySelector('.deck__ctrls'), deckCenter = deck.querySelector('.deck__center');
const deckLeft = deck.querySelector('.deck__side--left'), deckRight = deck.querySelector('.deck__side--right');
const textMeter = document.createElement('canvas').getContext('2d');
/* how wide the studio name is with four letters and an ellipsis:
   anything shorter names nothing, and the icon alone is better */
function fourLetters() {
  const cs = getComputedStyle(audioLabel), chars = [...audioLabel.textContent];
  textMeter.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  textMeter.letterSpacing = cs.letterSpacing;   // the interface tracking, or four letters came out three
  return Math.ceil(textMeter.measureText(chars.length > 4 ? chars.slice(0, 4).join('') + '…' : chars.join('')).width) + 1;
}
/* The width a side of the deck needs: its groups laid side by side,
   each holding its buttons. Not scrollWidth: an open menu is an
   absolute box inside a group, and scrollWidth counts it, so with a
   wide menu open the side seemed not to fit and the deck folded up.
   Only what is in the flow and shown counts. */
function sideWidth(side) {
  const shown = el => [...el.children].filter(c => c.offsetWidth > 0 && !/^(absolute|fixed)$/.test(getComputedStyle(c).position));
  const gapOf = el => parseFloat(getComputedStyle(el).columnGap) || 0;
  const sum = (el, w) => { const cs = shown(el); return cs.reduce((a, c) => a + w(c), 0) + gapOf(el) * Math.max(0, cs.length - 1); };
  return sum(side, g => g.classList.contains('deck__grp') ? sum(g, c => c.offsetWidth) : g.offsetWidth);
}
function fitDeck() {
  if (!deckRow.clientWidth) return;               // hidden, nothing to measure
  deck.classList.remove('deck--packed', 'deck--compact', 'deck--offcentre');
  /* pip-mode is the class of the copy in the extended PiP window, which
     is sized by its own rules in styles.css and not fitted at all. The
     tab's stage carries it only in the tests, to lay the deck out as the
     window does. */
  if (stage.classList.contains('pip-mode')) { fitLabel(Infinity); return; }
  const gap = parseFloat(getComputedStyle(deckRow).columnGap) || 0;
  /* measured afresh each time: the compact step changes the padding
     and the size of the centre */
  const room = () => (deckRow.clientWidth - deckCenter.offsetWidth) / 2 - gap;
  if (sideWidth(deckRight) > room()) deck.classList.add('deck--packed');
  if (!fitLabel(room()) || sideWidth(deckRight) > room()) {
    deck.classList.add('deck--compact');
    /* the last step: the centre leaves the exact middle, and the sides
       share the row by what they hold rather than half and half */
    if (!fitLabel(room()) || sideWidth(deckRight) > room()) deck.classList.add('deck--offcentre');
  }
  if (!deck.classList.contains('deck--packed')) closePack();   // unfolded, the tray is gone with its state
}
/* Shortens the studio name to the room its side has. False when even
   the icon alone leaves the side too wide. */
const LABEL_MAX = 180;
function fitLabel(room) {
  btnAudio.classList.remove('rb--icon');
  audioLabel.style.maxWidth = LABEL_MAX + 'px';   // a steady width: the name does not grow and shrink with every change around it
  const over = sideWidth(deckLeft) - room;
  if (over <= 0) return true;
  if (btnAudio.hidden) return false;
  const left = Math.min(LABEL_MAX, audioLabel.getBoundingClientRect().width) - over;
  if (left >= fourLetters()) { audioLabel.style.maxWidth = Math.floor(left) + 'px'; return true; }
  btnAudio.classList.add('rb--icon');
  return sideWidth(deckLeft) <= room;
}
new ResizeObserver(fitDeck).observe(deckRow);

/* The tray shows while the pointer is over the gear or the tray, and
   goes 2.4 s after the pointer leaves; a click inside does not pin it.
   It waits while the speed menu in it is open. A touch screen has no
   hover, so a tap on the gear shows it as well, and it goes the same way
   once the finger is lifted. A click anywhere else closes it at once. */
const PACK_LINGER = 2400;
let packT = 0;
function showPack() {
  if (!deck.classList.contains('deck--packed')) return;   // unfolded, there is no tray to show
  clearTimeout(packT);
  deckPack.classList.add('open');
  btnPack.setAttribute('aria-expanded', 'true');
}
function lingerPack() {
  clearTimeout(packT);
  packT = setTimeout(() => rateMenu.classList.contains('open') ? lingerPack() : closePack(), PACK_LINGER);
}
deckPack.addEventListener('pointerenter', showPack);
deckPack.addEventListener('pointerleave', lingerPack);
btnPack.onclick = e => { e.stopPropagation(); showPack(); };
function closePack() {
  clearTimeout(packT);
  deckPack.classList.remove('open');
  btnPack.setAttribute('aria-expanded', 'false');
}

/* A menu opens from its button, and a wide one can run past the edge of
   the window: at 1024 the subtitle menu hung 261px beyond the right one.
   An open menu is moved back inside the window it is in, the main one or
   the PiP one. The queue is no border for it: a menu lies over everything.
   Watched rather than called: menus are opened and rebuilt in half a
   dozen places. */
function fitMenu(m) {
  m.style.translate = '';
  if (!m.classList.contains('open')) return;
  const right = m.ownerDocument.documentElement.clientWidth, pad = 12;
  /* measured without the slide of the opening, which is still in its
     first frame here: taken for an overflow, it moved the settings 60px
     off their place */
  const r = m.getBoundingClientRect(), tx = new DOMMatrixReadOnly(getComputedStyle(m).transform).m41;
  const left = r.left - tx, rightEdge = r.right - tx;
  const dx = rightEdge > right - pad ? right - pad - rightEdge
           : left < pad ? pad - left : 0;
  if (dx) m.style.translate = Math.round(dx) + 'px 0';
}
const fitMenus = () => MENUS.forEach(fitMenu);
const menuWatch = new MutationObserver(recs => {
  for (const m of new Set(recs.map(r => r.target))) fitMenu(m);
});
for (const m of MENUS) menuWatch.observe(m, { attributes: true, attributeFilter: ['class'], childList: true });

/* The queue footer: once the buttons stop fitting on one line they stand
   two by two. The panel is watched rather than the footer, whose height
   is what this changes. */
function fitFoot() {
  queueAdd.classList.remove('queue__add--grid');
  const tags = [...queueAdd.children].filter(b => !b.hidden);
  /* on a second line, not merely a few pixels lower: the field and the
     button differ in height, and a strict comparison folded the row */
  if (tags.length > 1 && tags[tags.length - 1].offsetTop > tags[0].offsetTop + tags[0].offsetHeight / 2)
    queueAdd.classList.add('queue__add--grid');
}
new ResizeObserver(fitFoot).observe($('#queue'));

addEventListener('resize', fitMenus);
document.fonts.ready.then(() => { fitDeck(); fitFoot(); });

/* ── player settings ──────────────────────────────────────────
   The list below is the single source of truth: the starting values,
   the captions in the gear menu and the set of allowed options all come
   from here. The defaults used to be written in one place, the captions
   in another, and the layout was never applied at startup at all, so
   the menu showed one thing while the player behaved differently.

   From localStorage we accept only a value that really is in the list
   of options: anything foreign, outdated or corrupted is quietly
   replaced by the default. The version key resets a set left over from
   an earlier arrangement of the settings. */
const SETTINGS = [
  { key: 'queueMode', def: 'docked', label: 'set.queueMode',
    opts: [['overlay', 'set.queueMode.overlay'], ['docked', 'set.queueMode.docked']] },
  { key: 'drag', def: 'off', label: 'set.drag',
    opts: [['on', 'common.on'], ['off', 'common.off']] },
  { key: 'follow', def: 'on', label: 'set.follow',
    opts: [['on', 'common.on'], ['off', 'common.off']] },
  { key: 'hideUi', def: 'off', label: 'set.hideUi',
    opts: [['on', 'common.on'], ['off', 'common.off']] },
  { key: 'autoSkip', def: 'off', label: 'set.autoSkip',
    opts: [['on', 'common.on'], ['off', 'common.off']] },
  { key: 'font', def: 'fixel', label: 'set.font',
    opts: [['fixel', 'set.font.fixel'], ['inter', 'set.font.inter']] },
];
const SETTINGS_V = '6';   // the defaults changed, so what was saved is dropped

function loadSettings() {
  try {
    if (localStorage.getItem('lapka.set.v') !== SETTINGS_V) {
      for (const s of SETTINGS) localStorage.removeItem('lapka.' + s.key);
      localStorage.removeItem('lapka.autoUi');          // keys from earlier versions
      localStorage.removeItem('lapka.pipMode');
      localStorage.setItem('lapka.set.v', SETTINGS_V);
    }
  } catch (_) { /* private mode, so just take the defaults */ }

  const out = {};
  for (const s of SETTINGS) {
    let v = null;
    try { v = localStorage.getItem('lapka.' + s.key); } catch (_) {}
    out[s.key] = s.opts.some(([val]) => val === v) ? v : s.def;
  }
  return out;
}

/* ── what survives a reload ───────────────────────────────────
   Nothing but the settings used to survive: close the tab in the middle
   of an episode and the queue was empty, the position was gone, and
   which file had been playing was anyone's guess.

   Two things are stored separately, because they live differently. The
   queue is a list of paths, it changes rarely and as a whole. Watch
   positions are a separate map of path to seconds, it grows by one
   entry per file watched and outlives any rebuild of the queue.

   Local files are not restored: a File has no path on disk and a blob:
   URL dies with the tab. Only what the server can open again by path
   comes back. */
/* what the browser kept under the old prefix is carried over once, then the old keys go */
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('pip.')) continue;
    const nk = 'lapka.' + k.slice(4);
    if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
  localStorage.removeItem('nocturne.pipMode');
} catch (_) { /* private mode */ }

function numFromStore(key, def, lo, hi) {
  let v;
  try { v = Number(localStorage.getItem(key)); } catch (_) { return def; }
  return isFinite(v) && v >= lo && v <= hi ? v : def;
}
function readStore(key, def) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch (_) { return def; }
}
function writeStore(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* private mode */ }
}
/* Plain strings, through the same guard. Reading storage throws when the
   browser blocks site data, and a few bare reads in the state below were
   enough to stop the player before it drew anything. */
function strFromStore(key, def) {
  try { return localStorage.getItem(key) ?? def; } catch (_) { return def; }
}
function saveStr(key, val) {
  try { localStorage.setItem(key, val); } catch (_) { /* private mode */ }
}

const SESSION_V = 2;
const POS_MIN = 30;        // before the thirtieth second there is nowhere to return to
const POS_TAIL = 60;       // and not to the very end either: the episode is finished

/* Where an episode was left is kept on the server, keyed by the
   series and the episode, whatever the dub it was watched in: a place
   is one, and nothing here is a path. The copy in state.positions is
   what the rows are painted from. */
const posKey = it => it && it.seriesId ? `${it.seriesId}/${it.number}` : null;
/* The item whose media the video holds. A position belongs to it and
   to nothing else: the row chosen runs ahead of the video while a start
   is on, and the video's time is nobody's from the moment the media
   before is let go until the next one has its metadata.

   The row is painted on every tick, so its bar keeps step with the
   player's; the server is told every few seconds and on a stop. */
let loaded = null;
const posTimers = {};
function markPos(it, sec, send = true) {
  const k = posKey(it);
  if (!k || it !== loaded || !isFinite(sec)) return;
  const d = duration();
  const gone = sec < POS_MIN || (d && sec > d - POS_TAIL);
  if (gone) delete state.positions[k]; else state.positions[k] = { t: Math.round(sec), d: Math.round(d) || 0 };
  if (d > POS_TAIL && sec > d - POS_TAIL) markWatched(it);   // the last minute: the episode is finished
  if (send) {
    clearTimeout(posTimers[k]);
    const [series, episode] = k.split('/');
    const path = `/api/state/position?series=${series}&episode=${episode}${gone ? '' : '&t=' + Math.round(sec) + '&d=' + (Math.round(d) || 0)}`;
    /* at once when the page is leaving (a timer would never fire), with the request kept alive past the page; else a moment later, the ticks of one second folded into one request */
    if (send === 'now') fetch(path, { method: 'POST', headers: { 'x-lapka': '1' }, keepalive: true }).catch(() => {});
    else posTimers[k] = setTimeout(() => post(path).catch(() => {}), 800);
  }
  for (const li of queueList.children) {
    const x = byId(li.dataset.id);
    if (x === it) paintPos(li, x);
  }
}

/* An episode watched to its end is remembered by the series and the
   number, whatever the dub, and for good: watching it again does not
   take the mark away. */
const watchKey = it => it && it.seriesId ? `${it.seriesId}/${it.number}` : null;
function markWatched(it) {
  const k = watchKey(it);
  if (!k || state.watched[k]) return;
  state.watched[k] = true;
  const [series, episode] = k.split('/');
  post(`/api/state/watched?series=${series}&episode=${episode}`).catch(() => {});
  for (const li of queueList.children) if (byId(li.dataset.id) === it) paintPos(li, it);
}

/* Where watching stopped, drawn as a bar on the episode's frame, in the
   rows and in the tiles alike, from the first paint: the duration was
   written down with the position, so the row needs nothing from the
   media. Only what the player would return to is drawn: the first half
   minute and the last minute are not kept. A watched episode keeps a
   full bar and a veiled frame; left in the middle again, its bar shows
   the middle. */
function paintPos(li, it) {
  const k = posKey(it);
  const p = k ? state.positions[k] : null, d = it.dur || (p && p.d);
  const f = p && d ? Math.min(1, p.t / d) : 0;
  li.classList.toggle('has-pos', f > 0);
  li.classList.toggle('is-watched', !!state.watched[watchKey(it)]);
  li.style.setProperty('--pos', f.toFixed(4));
}

/* A row's frame takes the proportions of the picture once it has
   loaded. Until then the box is 16:9, the common case. */
function paintShape(li, it) {
  const box = li.querySelector('.item__thumb');
  if (box && it.aspect) box.style.aspectRatio = String(it.aspect);
}

let saveT = null;
let sessionReady = false;   // nothing is written until boot ends
function saveSession() {
  if (!sessionReady) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    if (!state.series) { try { localStorage.removeItem('lapka.session'); } catch (_) {} return; }
    writeStore('lapka.session', { v: SESSION_V, url: state.series.sourceUrl, current: cur() ? { seriesId: cur().seriesId, number: cur().number } : null, loop: state.loop });
  }, 500);
}

/* The series comes back, playback does not: the browser would block
   autoplay without a click anyway. */
async function restoreSession() {
  const ses = readStore('lapka.session', null);
  if (!ses || ses.v !== SESSION_V || !ses.url) return false;
  if (ses.loop === 'queue' || ses.loop === 'one') state.loop = ses.loop;
  return openLink(ses.url, { autoplay: false, at: ses.current, quiet: true });
}

/* ── state ─────────────────────────────────────────────────── */
const state = {
  list: [], current: null,
  series: null,      // the series the link named
  seasons: [],       // every series of its franchise that was opened, in viewing order: [{ series, entry }]
  dubKey: null,      // the dub chosen, carried to every episode and every season
  quality: strFromStore('lapka.quality', 'auto'),   // '1080p', '720p', … or 'auto' for the best there is
  saved: new Map(),  // 'seriesId/number' → what the library holds of it: [{ dub, size, path }]
  positions: {},     // series/episode → { t: seconds, d: duration }, mirrored from the server
  watched: {},       // series/episode → true, mirrored from the server
  remote: {},        // the server's state as it was at boot
  loop: 'off', queueOpen: true,
  autoplay: strFromStore('lapka.autoplay', '1') !== '0',
  subPref: null,     // the subtitle track chosen by hand; null means off
  set: loadSettings(),   // the player settings, see SETTINGS
  cue: {             // subtitle styling, all within what ::cue can do
    size: strFromStore('lapka.cue.size', 'm'),
    bg:   ['none', 'std'].includes(strFromStore('lapka.cue.bg', 'shadow')) ? 'browser' : strFromStore('lapka.cue.bg', 'shadow'),   // 'none' of old is the browser's look now
    pos:  strFromStore('lapka.cue.pos', 'auto'),
  },
  pipWin: null, errStreak: 0, seq: 0,
  vol: numFromStore('lapka.vol', 1, 0, 1),   // volume survives a reload
  busy: false,             // a page is being read, the favicon shows it
  seekPreview: null,       // the position shown while seeking
  view: strFromStore('lapka.view', 'rows') === 'grid' ? 'grid' : 'rows',
  /* the browser one by default: it has no address bar on top */
  pipMode: strFromStore('lapka.pipMode', 'native'),
};

/* A link to the source in the empty queue. An empty string hides it,
   which is better than a broken address. */
const REPO = 'https://github.com/MythHand/Lapka';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* Codes arrive from ffprobe as they are, two letters or three. */
function langName(code) {
  if (!code || code === 'und') return '';
  try {
    const n = langNames.of(code);
    return n && n !== code ? n : code.toUpperCase();
  } catch (_) { return code.toUpperCase(); }
}
const channelsLabel = (n, layout) => n === 1 ? t('ch.mono') : n === 2 ? t('ch.stereo')
  : n === 6 ? '5.1' : n === 8 ? '7.1' : n ? t('ch.n', { n }) : (layout || '');

/* ── small things ──────────────────────────────────────────── */
function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}
function fmtLong(s) {
  s = Math.floor(isFinite(s) ? s : 0);
  const p = n => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
}
const fmtSize = b => b >= 1073741824 ? t('units.gb', { n: (b / 1073741824).toFixed(1) })
                   : b >= 1048576 ? t('units.mb', { n: Math.round(b / 1048576) })
                   : t('units.kb', { n: Math.round(b / 1024) });

let toastT;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 3000);
}
const idxOf = it => state.list.indexOf(it);
const byId = id => state.list.find(x => String(x.id) === String(id));
const cur = () => state.current;
const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;

/* Icons are Phosphor (@phosphor-icons/core, MIT). Filled in the centre
   of the deck, bold outline at the edges: regular read as thin.

   On sizes. In the native 256 grid the ink spans from 96 to 232 units,
   and at one CSS width the icons look wildly uneven. The measure of
   size is sqrt(w*h), the perceived one: by the larger side, wide and
   low glyphs such as subtitles were squeezed vertically and fell out of
   the row. But matching size exactly ruins something else: compact
   glyphs scale up more and their stroke thickens, and the spread of
   weight reached 43 %. So the box is taken as the geometric mean
   between the native one and the fully matched one: both errors drop to
   roughly 20 % instead of one going to zero and the other doubling.

   The centre of the box stays at the centre of the native grid.
   Phosphor draws its glyphs with an optical offset of its own: the play
   triangle sits deliberately right of centre so that it looks centred
   inside a round button, and recomputing from the bounding box
   destroyed that offset. */
const PH = {
  play: { vb: '4.3 4.3 247.4 247.4', d: '<path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z"/>' },
  pause: { vb: '6.7 6.7 242.5 242.5', d: '<path d="M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z"/>' },
  repeat: { vb: '-1.0 -1.0 257.9 257.9', d: '<path d="M20,128A76.08,76.08,0,0,1,96,52h99l-3.52-3.51a12,12,0,1,1,17-17l24,24a12,12,0,0,1,0,17l-24,24a12,12,0,0,1-17-17L195,76H96a52.06,52.06,0,0,0-52,52,12,12,0,0,1-24,0Zm204-12a12,12,0,0,0-12,12,52.06,52.06,0,0,1-52,52H61l3.52-3.51a12,12,0,1,0-17-17l-24,24a12,12,0,0,0,0,17l24,24a12,12,0,1,0,17-17L61,204h99a76.08,76.08,0,0,0,76-76A12,12,0,0,0,224,116Z"/>' },
  repeatOnce: { vb: '-1.0 -1.0 257.9 257.9', d: '<path d="M20,128A76.08,76.08,0,0,1,96,52h99l-3.52-3.51a12,12,0,1,1,17-17l24,24a12,12,0,0,1,0,17l-24,24a12,12,0,0,1-17-17L195,76H96a52.06,52.06,0,0,0-52,52,12,12,0,0,1-24,0Zm204-12a12,12,0,0,0-12,12,52.06,52.06,0,0,1-52,52H61l3.52-3.51a12,12,0,1,0-17-17l-24,24a12,12,0,0,0,0,17l24,24a12,12,0,1,0,17-17L61,204h99a76.08,76.08,0,0,0,76-76A12,12,0,0,0,224,116Zm-88,48a12,12,0,0,0,12-12V104a12,12,0,0,0-17.36-10.74l-16,8a12,12,0,0,0,9.36,22V152A12,12,0,0,0,136,164Z"/>' },
  volX: { vb: '-7.0 -7.0 269.9 269.9', d: '<path d="M165.27,21.22a12,12,0,0,0-12.64,1.31L83.88,76H40A20,20,0,0,0,20,96v64a20,20,0,0,0,20,20H83.88l68.75,53.47A12,12,0,0,0,172,224V32A12,12,0,0,0,165.27,21.22ZM148,199.47,95.37,158.53A12,12,0,0,0,88,156H44V100H88a12,12,0,0,0,7.37-2.53L148,56.54Zm108.49-55.95a12,12,0,0,1-17,17L224,145l-15.51,15.52a12,12,0,0,1-17-17L207,128l-15.52-15.51a12,12,0,0,1,17-17L224,111l15.51-15.51a12,12,0,0,1,17,17L241,128Z"/>' },
  volLow: { vb: '0.4 0.4 255.3 255.3', d: '<path d="M165.27,21.22a12,12,0,0,0-12.64,1.31L83.88,76H40A20,20,0,0,0,20,96v64a20,20,0,0,0,20,20H83.88l68.75,53.47A12,12,0,0,0,172,224V32A12,12,0,0,0,165.27,21.22ZM148,199.46,95.37,158.53A12,12,0,0,0,88,156H44V100H88a12,12,0,0,0,7.37-2.53L148,56.54ZM212,104v48a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Z"/>' },
  volHigh: { vb: '-5.2 -5.2 266.5 266.5', d: '<path d="M165.27,21.22a12,12,0,0,0-12.64,1.31L83.88,76H40A20,20,0,0,0,20,96v64a20,20,0,0,0,20,20H83.88l68.75,53.47A12,12,0,0,0,172,224V32A12,12,0,0,0,165.27,21.22ZM148,199.47,95.37,158.53A12,12,0,0,0,88,156H44V100H88a12,12,0,0,0,7.37-2.53L148,56.54ZM212,104v48a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Zm36-16v80a12,12,0,0,1-24,0V88a12,12,0,0,1,24,0Z"/>' },
  cornersOut: { vb: '6.7 6.7 242.7 242.7', d: '<path d="M220,48V88a12,12,0,0,1-24,0V60H168a12,12,0,0,1,0-24h40A12,12,0,0,1,220,48ZM88,196H60V168a12,12,0,0,0-24,0v40a12,12,0,0,0,12,12H88a12,12,0,0,0,0-24Zm120-40a12,12,0,0,0-12,12v28H168a12,12,0,0,0,0,24h40a12,12,0,0,0,12-12V168A12,12,0,0,0,208,156ZM88,36H48A12,12,0,0,0,36,48V88a12,12,0,0,0,24,0V60H88a12,12,0,0,0,0-24Z"/>' },
  cornersIn: { vb: '6.7 6.7 242.7 242.7', d: '<path d="M148,96V48a12,12,0,0,1,24,0V84h36a12,12,0,0,1,0,24H160A12,12,0,0,1,148,96ZM96,148H48a12,12,0,0,0,0,24H84v36a12,12,0,0,0,24,0V160A12,12,0,0,0,96,148Zm112,0H160a12,12,0,0,0-12,12v48a12,12,0,0,0,24,0V172h36a12,12,0,0,0,0-24ZM96,36A12,12,0,0,0,84,48V84H48a12,12,0,0,0,0,24H96a12,12,0,0,0,12-12V48A12,12,0,0,0,96,36Z"/>' },
  /* Queue, disk browser and dialogs. Same normalisation as above:
     the box is 256*sqrt(p/204.81) around (128,128), where p is
     sqrt(w*h) of the ink. Bold weight, because these sit at the
     edges of the interface rather than in the centre. */
  check: { vb: '8.7 8.7 238.6 238.6', d: '<path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/>' },   // menu tick
  x: { vb: '12.0 12.0 231.9 231.9', d: '<path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/>' },   // close, remove from queue
  grip: { vb: '25.2 25.2 205.7 205.7', d: '<path d="M108,60A16,16,0,1,1,92,44,16,16,0,0,1,108,60Zm56,16a16,16,0,1,0-16-16A16,16,0,0,0,164,76ZM92,112a16,16,0,1,0,16,16A16,16,0,0,0,92,112Zm72,0a16,16,0,1,0,16,16A16,16,0,0,0,164,112ZM92,180a16,16,0,1,0,16,16A16,16,0,0,0,92,180Zm72,0a16,16,0,1,0,16,16A16,16,0,0,0,164,180Z"/>' },   // drag handle of a queue row
  linkOut: { vb: '17.7 17.7 220.6 220.6', d: '<path d="M204,64V168a12,12,0,0,1-24,0V93L72.49,200.49a12,12,0,0,1-17-17L163,76H88a12,12,0,0,1,0-24H192A12,12,0,0,1,204,64Z"/>' },   // link to the source
  folder: { vb: '1.0 1.0 253.9 253.9', d: '<path d="M216,68H133.39l-26-29.29a20,20,0,0,0-15-6.71H40A20,20,0,0,0,20,52V200.62A19.41,19.41,0,0,0,39.38,220H216.89A19.13,19.13,0,0,0,236,200.89V88A20,20,0,0,0,216,68ZM44,56H90.61l10.67,12H44ZM212,196H44V92H212Z"/>' },   // directory in the disk browser
  caretRight: { vb: '22.8 22.8 210.4 210.4', d: '<path d="M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z"/>' },   // step into a directory
  fileVideo: { vb: '0.4 0.4 255.3 255.3', d: '<path d="M216.49,79.51l-56-56A12,12,0,0,0,152,20H56A20,20,0,0,0,36,40v68a12,12,0,0,0,24,0V44h76V92a12,12,0,0,0,12,12h48V212a12,12,0,0,0,0,24h4a20,20,0,0,0,20-20V88A12,12,0,0,0,216.49,79.51ZM160,57l23,23H160Zm-1.91,84.69a12,12,0,0,0-11.92-.15L126.5,152.44A20,20,0,0,0,108,140H48a20,20,0,0,0-20,20v48a20,20,0,0,0,20,20h60a20,20,0,0,0,18.5-12.44l19.67,10.93A12,12,0,0,0,164,216V152A12,12,0,0,0,158.09,141.66ZM104,204H52V164h52Zm36-8.39-12-6.67v-9.88l12-6.67Z"/>' },   // media file in the disk browser
  warn: { vb: '-3.5 -3.5 262.9 262.9', d: '<path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm-12-80V80a12,12,0,0,1,24,0v52a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,172Z"/>' },   // the notice about sound
  arrowRight: { vb: '6.9 6.9 242.2 242.2', d: '<path d="M224.49,136.49l-72,72a12,12,0,0,1-17-17L187,140H40a12,12,0,0,1,0-24H187L135.51,64.48a12,12,0,0,1,17-17l72,72A12,12,0,0,1,224.49,136.49Z"/>' },   // end of queue card
  arrowUp: { vb: '6.9 6.9 242.2 242.2', d: '<path d="M208.49,120.49a12,12,0,0,1-17,0L140,69V216a12,12,0,0,1-24,0V69L64.49,120.49a12,12,0,0,1-17-17l72-72a12,12,0,0,1,17,0l72,72A12,12,0,0,1,208.49,120.49Z"/>' },   // one level up in the browser
  filePlus: { vb: '1.7 1.7 252.6 252.6', d: '<path d="M216.49,79.51l-56-56A12,12,0,0,0,152,20H56A20,20,0,0,0,36,40V216a20,20,0,0,0,20,20H200a20,20,0,0,0,20-20V88A12,12,0,0,0,216.49,79.51ZM160,57l23,23H160ZM60,212V44h76V92a12,12,0,0,0,12,12h48V212Zm104-60a12,12,0,0,1-12,12H140v12a12,12,0,0,1-24,0V164H104a12,12,0,0,1,0-24h12V128a12,12,0,0,1,24,0v12h12A12,12,0,0,1,164,152Z"/>' },   // add files
  folderPlus: { vb: '1.0 1.0 253.9 253.9', d: '<path d="M216,68H133.39l-26-29.29a20,20,0,0,0-15-6.71H40A20,20,0,0,0,20,52V200.62A19.41,19.41,0,0,0,39.38,220H216.89A19.13,19.13,0,0,0,236,200.89V88A20,20,0,0,0,216,68ZM90.61,56l10.67,12H44V56ZM212,196H44V92H212Zm-72-76v12h12a12,12,0,0,1,0,24H140v12a12,12,0,0,1-24,0V156H104a12,12,0,0,1,0-24h12V120a12,12,0,0,1,24,0Z"/>' },   // add a folder
  download: { vb: '4.1 4.1 247.8 247.8', d: '<path d="M224,152v56a20,20,0,0,1-20,20H52a20,20,0,0,1-20-20V152a12,12,0,0,1,24,0v52H200V152a12,12,0,0,1,24,0Zm-104.49,8.49a12,12,0,0,0,17,0l40-40a12,12,0,0,0-17-17L140,123V40a12,12,0,0,0-24,0v83L96.49,103.51a12,12,0,0,0-17,17Z"/>' },   // save an episode
  disks: { vb: '4.1 4.1 247.8 247.8', d: '<path d="M208,36H48A20,20,0,0,0,28,56V200a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V56A20,20,0,0,0,208,36Zm-4,24v56H52V60ZM52,196V140H204v56ZM160,88a16,16,0,1,1,16,16A16,16,0,0,1,160,88Zm32,80a16,16,0,1,1-16-16A16,16,0,0,1,192,168Z"/>' },   // browse the disk
};


const phSvg = i => `<svg class="ph" viewBox="${i.vb}">${i.d}</svg>`;
/* play/pause and the volume levels have different boxes, so the box changes with the path */
const setIcon = (el, i) => { el.setAttribute('viewBox', i.vb); el.innerHTML = i.d; };

/* ── time ─────────────────────────────────────────────────────
   The file is prepared whole and served with Range support, so the
   position and the duration come straight from video. No offsets. */
const position = () => state.seekPreview != null ? state.seekPreview : video.currentTime;
function duration() {
  if (isFinite(video.duration) && video.duration > 0) return video.duration;
  const it = cur();
  return it && it.dur ? it.dur : 0;
}
function seekTo(t) {
  const d = duration();
  if (!d) return;
  state.seekPreview = null;
  video.currentTime = Math.max(0, Math.min(d - 0.3, t));
  paintSeek();
}

/* ── talking to the server ───────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, opts) {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || String(r.status));
  return d;
}
/* the look of a page told as it goes: every step to onStep, the answer at the end */
function lookLive(url, onStep) {
  return new Promise((resolve, reject) => {
    const es = new EventSource('/api/look/live?url=' + encodeURIComponent(url));
    const close = () => es.close();
    es.addEventListener('step', e => { try { onStep(JSON.parse(e.data)); } catch (_) {} });
    es.addEventListener('done', e => { close(); resolve(JSON.parse(e.data)); });
    es.addEventListener('fail', e => { close(); let d = {}; try { d = JSON.parse(e.data); } catch (_) {} reject(new Error(d.error || 'look failed')); });
    es.onerror = () => { close(); reject(new Error(t('set.cacheFail'))); };
  });
}
const post = path => api(path, { method: 'POST', headers: { 'x-lapka': '1' } });

/* stop playback completely: not only pause but also dropping the
   source, otherwise the previous episode is heard behind the overlay */
let hls = null;
function stopPlayback() {
  if (loaded) markPos(loaded, video.currentTime);   // where it was left
  loaded = null;
  if (hls) { hls.destroy(); hls = null; }
  if (!video.getAttribute('src')) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

/* The overlay while the server reads a page and opens its players.
   One step at a time, named; no percentages, a page answers when it
   answers. */
function showProgress(it, key) {
  closeMenus();
  prep.classList.remove('prep--link');
  prepHead.textContent = t('prep.head');
  prepName.textContent = it.name;
  prepName.classList.remove('prep__name--url');
  prepTrack.textContent = state.series ? state.series.title : '';
  prepSteps.replaceChildren();
  prepCmd.replaceChildren();
  const li = document.createElement('li');
  li.className = 'step step--active';
  li.innerHTML = '<span class="step__mark"></span><span class="step__text"></span><span class="step__aux"></span>';
  li.querySelector('.step__text').textContent = t(key);
  prepSteps.append(li);
  prep.classList.add('show');
  state.busy = true;
  paintFavicon();
}

/* The wait for a link, composed whole before anything is known, so it
   holds its shape while the work goes on: the address on one line, the
   three phases there are (the page, its players, the parts of the
   franchise), each waiting, working or done, and under them a log of
   fixed height where what is being done arrives line by line, the
   newest at the bottom like a terminal. */
const LINK_PHASES = ['page', 'players', 'parts'];
function showLinkWait(url) {
  closeMenus();
  prep.classList.add('prep--link');
  prepHead.textContent = t('prep.link');
  prepName.textContent = url;
  prepName.classList.add('prep__name--url');
  prepTrack.textContent = '';
  prepSteps.replaceChildren();
  for (const phase of LINK_PHASES) {
    const li = document.createElement('li');
    li.className = 'step step--wait';
    li.dataset.phase = phase;
    li.innerHTML = '<span class="step__mark"></span><span class="step__text"></span><span class="step__aux"></span>';
    li.querySelector('.step__text').textContent = t('prep.' + phase);
    prepSteps.append(li);
  }
  prepCmd.replaceChildren();
  prep.classList.add('show');
  state.busy = true;
  paintFavicon();
}
/* a phase: waiting, working (with what is known of its progress), done, or passed over ("—") */
function prepPhase(phase, mode, aux = '') {
  const li = prepSteps.querySelector(`[data-phase="${phase}"]`);
  if (!li) return;
  li.className = 'step step--' + mode;
  li.querySelector('.step__mark').textContent = mode === 'done' ? '✓' : '';
  li.querySelector('.step__aux').textContent = mode === 'skip' ? '—' : aux;
}
/* a step from the server: a phase change, or a line for the log */
function prepStep(step) {
  if (step && typeof step === 'object' && step.phase) {
    if (step.phase === 'players') prepPhase('page', 'done');
    prepPhase(step.phase, 'active', step.n ? `0 / ${step.n}` : '');
    return;
  }
  prepLog(stepText(step));
}
/* The server says what it does as a key with its parts, never in words
   of one language: the words are the page's, in the language chosen
   here. A reason a player gave is worded when it is one Lapka knows,
   else passed on as the player reader said it. A plain string passes
   as it is. */
function stepText(step) {
  if (!step || typeof step !== 'object') return String(step ?? '');
  const v = { ...step };
  if (v.key === 'opened') return t(v.ok === v.asked ? 'log.openedAll' : 'log.openedSome', { n: v.asked, ok: v.ok }) + (v.same ? t('log.same', { n: v.same }) : '');
  if (v.key === 'playerUnfolded') { v.episodes = t('log.nEpisodes', { n: v.episodes }); v.dubs = t('log.nDubs', { n: v.dubs }); }
  if (v.why) v.why = whyText(v.why);
  return t('log.' + v.key, v);
}
function whyText(error) {
  if (error === 'no extractor') return t('log.noExtractor');
  if (error === 'closed door') return t('log.closedDoor');
  return error;
}
const PREP_LINES = 10;
function prepLog(text) {
  const line = document.createElement('div');
  line.className = 'cmd__line';
  line.textContent = text;
  prepCmd.append(line);
  while (prepCmd.children.length > PREP_LINES) prepCmd.firstElementChild.remove();
}
function hideProgress() {
  prep.classList.remove('show');
  state.busy = false;
  paintFavicon();
}

/* ═══════════════ the mark ═══════════════
   The paw is a few frames of block characters: it presses down and
   lets go, the way a cat's does, every few seconds. Frame by frame,
   textContent only: nothing moves by pixels. Under
   prefers-reduced-motion it stands still on the first frame. The
   name is drawn with the same blocks, five rows tall and wide, set
   to the paw's middle: one seal, one language. */
const PAW_FRAMES = [
`      ▄▄  ▄▄      
    ████  ████    
 ▄▄   ▀▀  ▀▀   ▄▄ 
████          ████
 ▀▀   ▄████▄   ▀▀ 
     ████████     
      ▀████▀      `,
`                  
      ▄▄  ▄▄      
 ▄▄ ████  ████ ▄▄ 
████  ▀▀  ▀▀  ████
 ▀▀   ▄████▄   ▀▀ 
     ████████     
      ▀████▀      `,
`                  
                  
 ▄▄   ▄▄  ▄▄   ▄▄ 
███ ████  ████ ███
 ▀▀  ▄██████▄  ▀▀ 
     ████████     
      ▀████▀      `,
`                  
                  
                  
 ▄▄▄  ▄▄▄▄▄▄  ▄▄▄ 
▀▀▀▀▄████████▄▀▀▀▀
     ████████     
      ▀████▀      `,
];
const BANNER = `██         ▄████▄   ██████▄   ██   ▄█▀   ▄████▄ 
██        ██    ██  ██    ██  ██ ▄█▀    ██    ██
██        ████████  ██████▀   ████      ████████
██        ██    ██  ██        ██ ▀█▄    ██    ██
███████   ██    ██  ██        ██   ▀█▄  ██    ██`;
const bannerEl = $('#banner');
if (bannerEl) bannerEl.textContent = BANNER;
/* A frame of the seal as rectangles, for the places that cannot hold
   text: the favicon and the settings button. A cell is a square of
   two half-blocks; the paw is 18 cells wide and 7 tall, centred in a
   32-unit box. */
const stillPaw = matchMedia('(prefers-reduced-motion: reduce)');
function pawPath(frame, box = 32) {
  const rows = frame.split('\n'), cols = Math.max(...rows.map(r => r.length));
  const u = box / (cols + 5), x0 = (box - cols * u) / 2, y0 = (box - rows.length * 2 * u) / 2;
  const f = n => n.toFixed(2);
  let d = '';
  rows.forEach((row, r) => [...row].forEach((c, k) => {
    if (c === ' ') return;
    const x = x0 + k * u, y = y0 + r * 2 * u;
    if (c === '█') d += `M${f(x)} ${f(y)}h${f(u)}v${f(2 * u)}h-${f(u)}z `;
    else if (c === '▄') d += `M${f(x)} ${f(y + u)}h${f(u)}v${f(u)}h-${f(u)}z `;
    else if (c === '▀') d += `M${f(x)} ${f(y)}h${f(u)}v${f(u)}h-${f(u)}z `;
  }));
  return d.trim();
}
const PAW_PATHS = PAW_FRAMES.map(f => pawPath(f));
const PAW_ORDER = [...PAW_FRAMES.keys(), ...[...PAW_FRAMES.keys()].reverse().slice(1)];
/* the settings button presses like the seal: through the frames and back, once */
const pawIcon = btnGear.querySelector('.ico-paw path');
if (pawIcon) pawIcon.setAttribute('d', PAW_PATHS[0]);
let pawPressT = null;
function pressGearPaw() {
  if (!pawIcon || stillPaw.matches) return;
  clearTimeout(pawPressT);
  let i = 0;
  const tick = () => { pawIcon.setAttribute('d', PAW_PATHS[PAW_ORDER[i]]); if (++i < PAW_ORDER.length) pawPressT = setTimeout(tick, i === PAW_FRAMES.length ? 260 : 90); };
  tick();
}

/* every paw on the page (the mark, the queue's about) presses together */
const paws = () => [...document.querySelectorAll('.paw')].filter(el => el.offsetParent !== null);
function pressPaws() {
  const els = paws();
  if (stillPaw.matches || !els.length) return;
  const order = [...PAW_FRAMES.keys(), ...[...PAW_FRAMES.keys()].reverse().slice(1)];
  let i = 0;
  const tick = () => { for (const el of els) el.textContent = PAW_FRAMES[order[i]]; if (++i < order.length) setTimeout(tick, i === PAW_FRAMES.length ? 260 : 90); };
  tick();
}
for (const el of document.querySelectorAll('.paw')) el.textContent = PAW_FRAMES[0];
setTimeout(pressPaws, 700);
setInterval(pressPaws, 4200);

/* the Open button waits for a link in the field */
const btnOpen = $('#btnOpen');
function syncOpenButton() { if (btnOpen) btnOpen.disabled = !linkInput.value.trim(); }
linkInput.addEventListener('input', syncOpenButton);
syncOpenButton();

/* ═══════════════ opening a link ═══════════════
   One address in. The server reads the page, finds the series and
   its episodes, and the queue is those episodes. Each episode is
   opened on the server only when it is about to play. */
/* "3 · Название", "3 серия", or for a part that is one episode (a
   film) its title alone: a lone number would mean nothing */
const nameFor = (ep, series = null) => {
  const alone = series && series.episodes.length === 1;
  if (alone) return ep.title || series.title;
  return ep.title ? `${ep.number} · ${ep.title}` : t('queue.episodeN', { n: ep.number });
};

function itemFor(ep, series) {
  return {
    id: ++state.seq, number: ep.number, title: ep.title || '', name: nameFor(ep, series),
    seriesId: series.id, seriesTitle: series.title, season: series.season, kind: series.kind,
    group: series.id,
    dur: null, err: false, aspect: null,
    dubs: null,       // what the episode offers, once its page was opened
    dub: null,        // the dub playing
    source: null,     // the player it comes from
    stream: null,     // the stream, with its address on the server
    opening: null, loadedSrc: null, avoid: null,
    save: null,       // { phase: 'fetch' | 'assemble', done, total } while saving; { error } when it failed
    marks: null,      // opening and ending, if the source says where they are
    skipHidden: {},   // the marks whose button was dismissed for this episode
  };
}

/* what the server already knows about an episode, onto its row */
function takeEpisode(it, ep) {
  if (!ep || !ep.dubs || !ep.dubs.length) return;
  it.dubs = ep.dubs.map(d => ({ key: d.key, name: d.name, sources: d.sources.length,
    alive: d.sources.filter(x => x.health.ok !== false).length }));
}

/* What a part of a franchise is: a film, an OVA, a spin-off; a plain
   season says nothing, its place in the order says it all */
function kindLabel(series) {
  if (series.kind === 'movie') return t('queue.movie');
  if (series.kind === 'ova') return t('queue.ova');
  if (series.kind === 'special') return t('queue.special');
  if (series.kind === 'spinoff') return t('queue.spinoff');
  return '';
}
/* the parts in the order they came out: by year, then as the site lists them */
function orderSeasons(list) {
  return list.map((s, i) => ({ ...s, i })).sort((a, b) => (a.series.year || 0) - (b.series.year || 0) || (a.entry?.order ?? a.i) - (b.entry?.order ?? b.i) || a.i - b.i)
    .map(({ i, ...s }, n) => ({ ...s, ordinal: n + 1 }));
}
const seasonOf = it => state.seasons.find(s => s.series.id === it.seriesId) || null;

/* The other seasons of the franchise, each a series of its own,
   opened at once. A site may name only the neighbours of a part on
   its page, so what each opened part names is gathered too, round
   after round, until nothing new comes. One that fails is left out
   and said so. */
async function openSeasons(main, { onStart = () => {}, onPart = () => {} } = {}) {
  /* an address, and the season it names when a page holds every season in one player: "…/show.html?season=3" */
  const norm = u => { try { const x = new URL(u); const s = x.searchParams.get('season'); return x.origin + x.pathname.replace(/\/+$/, '') + (s ? '?season=' + s : ''); } catch { return String(u || '').replace(/[#?].*$/, '').replace(/\/+$/, ''); } };
  const me = norm(main.sourceUrl);
  const known = new Map();   // url → { entry, series }
  /* the series already opened at this address in this season: the page itself, seen from another part with its season spelled out */
  const opened = k => [...known.values()].find(x => x.series && norm(x.series.sourceUrl).replace(/\?season=\d+$/, '') === k.replace(/\?season=\d+$/, '') && (norm(x.series.sourceUrl) === k || (x.series.season && k.endsWith('?season=' + x.series.season))));
  const add = e => { const k = norm(e.url); if (!k || known.has(k) || opened(k)) return; known.set(k, { entry: { ...e, self: k === me }, series: k === me ? main : null }); };
  for (const e of main.franchise || []) add(e);
  if (known.size < 2) return [{ series: main, entry: (main.franchise || []).find(e => e.self) || null }];
  onStart(known.size);                 // the phase line says how many; no toast over it
  let done = 0;
  for (let round = 0; round < 12; round++) {   // a long chain of neighbours takes a round per link
    const todo = [...known.values()].filter(x => !x.series && !x.failed);
    if (!todo.length) break;
    /* each part is told as it comes, not when the round is over */
    const got = await Promise.allSettled(todo.map(x => api('/api/look?url=' + encodeURIComponent(x.entry.url)).then(r => {
      const ok = r && r.series.episodes.length > 0;
      if (ok) { x.series = r.series; for (const e of r.series.franchise || []) add(e); }
      else x.failed = true;
      onPart({ title: x.entry.title || (ok ? r.series.title : x.entry.url), episodes: ok ? r.series.episodes.length : 0, ok, done: ++done, total: known.size });
      return r;
    }, e => { x.failed = true; onPart({ title: x.entry.title || x.entry.url, episodes: 0, ok: false, done: ++done, total: known.size }); throw e; })));
    todo.forEach((x, i) => { if (got[i].status !== 'fulfilled' || x.failed) toast(t('toast.seasonFail', { title: x.entry.title || x.entry.url })); });
  }
  /* one part per series: an episode's address and its series' address name the same series */
  const seen = new Set();
  return orderSeasons([...known.values()].filter(x => x.series && !seen.has(x.series.id) && seen.add(x.series.id)).map(x => ({ series: x.series, entry: x.entry })));
}

async function openLink(url, { autoplay = true, at = null, quiet = false } = {}) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) { toast(t('toast.badLink')); return false; }
  video.pause();                       // a new link is a new intent: what plays stops at once, the wait is shown over it
  showLinkWait(url);
  let got;
  let players = 0;
  try { got = await lookLive(url, step => { if (step && step.phase === 'players') players = step.n; prepStep(step); }); }
  catch (e) { hideProgress(); toast(t('toast.lookFail', { why: e.message })); return false; }
  if (!got.series.episodes.length) { hideProgress(); toast(t('toast.noEpisodes')); return false; }
  prepPhase('page', 'done');
  prepPhase('players', players ? 'done' : 'skip', players ? String(players) : '');

  stopPlayback(); playToken++;
  state.series = got.series;
  state.current = null;
  let parts = 0;
  state.seasons = await openSeasons(got.series, {
    onStart: n => { parts = n; prepPhase('parts', 'active', `0 / ${n}`); },
    onPart: p => { prepPhase('parts', 'active', `${p.done} / ${p.total}`); prepLog(p.ok ? t('prep.part', { title: p.title, n: p.episodes }) : t('prep.partFail', { title: p.title })); },
  });
  prepPhase('parts', parts ? 'done' : 'skip', parts ? String(parts) : '');
  hideProgress();
  state.list = [];
  for (const { series } of state.seasons) {
    for (const ep of series.episodes) {
      const it = itemFor(ep, series);
      takeEpisode(it, ep);
      state.list.push(it);
    }
  }
  state.dubKey = (state.remote.dubs || {})[got.series.id] || null;
  linkInput.value = '';
  render(); paintTitle();
  loadLibrary(); watchSaves();
  if (!quiet) { toast(t('toast.opened', { n: state.list.length })); rememberLink(url, got.series); }

  /* the episode to start with: the one asked for, the one the link pointed at, or the first of the linked series */
  const wantedNumber = at && at.number != null ? at.number : at != null && typeof at !== 'object' ? at : got.start ? got.start.episode : null;
  const wantedSeries = at && at.seriesId ? at.seriesId : got.series.id;
  const first = state.list.find(i => i.seriesId === wantedSeries && i.number === wantedNumber)
    || state.list.find(i => i.seriesId === got.series.id) || state.list[0];
  if (autoplay) playItem(first);
  else {
    /* the series is back but not started: the stage shows the episode it stopped on, not the start screen */
    state.current = first;
    emptyEl.classList.add('hide'); stage.classList.remove('is-empty');
    paintTitle(); paintActive(); syncStatus();
  }
  return true;
}

/* ── the links pasted ─────────────────────────────────────────
   Every link a person pastes is written down on the server with what
   it opened: the series' title, its cover kept as a file, kind, year,
   season, how many episodes. A session restored on reload is not a
   paste and is not written. The list stands beside the history button
   in the queue's footer: as tall as the window allows, the newest at
   the bottom, nearest the button; a row opens its link again. */
function rememberLink(url, series) {
  const q = new URLSearchParams({ url, series: series.id, title: series.title || '', episodes: String(series.episodes.length) });
  if (series.cover) q.set('cover', series.cover);
  if (series.kind) q.set('kind', series.kind);
  if (series.year) q.set('year', String(series.year));
  if (series.season) q.set('season', String(series.season));
  /* the parts the link opened: where watching stops is looked for across them */
  q.set('parts', JSON.stringify(state.seasons.map(s => ({ id: s.series.id, ordinal: s.ordinal || null, title: s.series.title || '' }))));
  post('/api/history?' + q).then(() => { if (!histPop.hidden) loadHistory(); }).catch(() => {});
}
let histList = [];
async function loadHistory() {
  try { histList = (await api('/api/history')).history || []; } catch (_) { histList = []; }
  if (!histPop.hidden) buildHistory();
}
function whenWords(at) {
  try { return new Date(at).toLocaleString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
}
function buildHistory() {
  histPop.replaceChildren();
  const head = document.createElement('div'); head.className = 'histpop__head'; head.textContent = t('queue.history'); histPop.append(head);
  if (!histList.length) { const e = document.createElement('div'); e.className = 'histpop__empty'; e.textContent = t('hist.empty'); histPop.append(e); }
  for (const h of histList) {
    const row = document.createElement('button');
    row.className = 'histpop__row';
    row.type = 'button';
    const cover = h.cover ? document.createElement('img') : document.createElement('span');
    cover.className = 'histpop__cover' + (h.cover ? '' : ' histpop__cover--none');
    if (h.cover) { cover.src = h.cover; cover.alt = ''; cover.loading = 'lazy'; } else cover.innerHTML = phSvg(PH.fileVideo);
    const body = document.createElement('div'); body.className = 'histpop__body';
    const title = document.createElement('div'); title.className = 'histpop__title'; title.textContent = h.title || h.url;
    /* what the series is on the left, when it was pasted on the right */
    const meta = document.createElement('div'); meta.className = 'histpop__meta';
    const about = document.createElement('span'); about.textContent = [h.year, h.season ? t('queue.season', { n: h.season }) : null, h.episodes ? t('pop.episodes', { n: h.episodes }) : null].filter(Boolean).join(' · ');
    const when = document.createElement('span'); when.className = 'histpop__when'; when.textContent = whenWords(h.at);
    meta.append(about, when);
    body.append(title, meta);
    /* where watching stopped, across the parts the link opened; a part other than the link's is named */
    const last = h.last;
    if (last) {
      const stop = document.createElement('div'); stop.className = 'histpop__stop';
      const part = (h.parts || []).find(x => x.id === last.seriesId);
      const where = part && last.seriesId !== h.seriesId ? `${part.ordinal ? part.ordinal + ' · ' : ''}${part.title} · ` : '';
      stop.textContent = where + (last.done ? t('hist.finished', { n: last.episode }) : t('hist.stopped', { n: last.episode, time: fmt(last.t) }));
      body.append(stop);
    }
    const link = document.createElement('div'); link.className = 'histpop__url'; link.textContent = h.url;
    body.append(link);
    row.append(cover, body);
    /* the link opens where it was left: the episode stopped in, or the one after the last finished */
    row.onclick = ev => { ev.stopPropagation(); closeHistory(); queueLinkInput.value = ''; openLink(h.url, last ? { at: { seriesId: last.seriesId, number: last.done ? last.episode + 1 : last.episode } } : {}); };
    histPop.append(row);
  }
  placeHistory();
  histPop.scrollTop = histPop.scrollHeight;
}
/* to the right of the footer's buttons, so neither is covered, its bottom at the button's; kept inside the window */
function placeHistory() {
  const r = btnHistory.getBoundingClientRect(), edge = queueAdd.getBoundingClientRect().right, w = histPop.offsetWidth, h = histPop.offsetHeight;
  histPop.style.left = Math.max(12, Math.min(edge + 8, window.innerWidth - w - 12)) + 'px';
  histPop.style.top = Math.max(12, Math.min(r.bottom - h, window.innerHeight - h - 12)) + 'px';
}
function openHistory() { histPop.hidden = false; buildHistory(); loadHistory(); }
function closeHistory() { histPop.hidden = true; }
btnHistory.onclick = ev => { ev.stopPropagation(); if (histPop.hidden) openHistory(); else closeHistory(); };
histPop.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', e => {
  if (histPop.hidden || e.target.closest('#histPop')) return;
  /* the click closes the list and does nothing else; the button toggles it itself */
  if (!e.target.closest('#btnHistory')) { e.stopPropagation(); e.preventDefault(); }
  closeHistory();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !histPop.hidden) closeHistory(); });
addEventListener('resize', () => { if (!histPop.hidden) placeHistory(); });

/* ── which dub and which stream play ─────────────────────────
   The server opens the episode's page if it has not, takes the dub
   chosen for the series or the nearest thing to it, a live source,
   its best stream. A stream that just failed is passed in so that its
   source is marked dead and another one is picked. */
async function resolveItem(it, { avoid = null } = {}) {
  if (it.opening) return it.opening;
  it.opening = (async () => {
    const q = new URLSearchParams({ series: it.seriesId, episode: String(it.number) });
    if (state.dubKey) q.set('dub', state.dubKey);
    if (avoid) q.set('avoid', avoid);
    const r = await api('/api/resolve?' + q);
    it.dubs = r.dubs; it.dub = r.dub; it.source = r.source;
    it.streams = r.streams || [];
    it.stream = pickStream(it.streams, r.stream) || r.stream;
    if (it.stream && it.stream.player) it.source = { ...(it.source || {}), player: it.stream.player };
    it.marks = r.episode.marks || null;
    /* the subtitle tracks the source offers, in the shape the menu
       reads; off unless a track like the one chosen before is here */
    it.subs = (r.subs || []).map((sb, i) => ({ index: 'w' + sb.id, order: i, lang: sb.lang || '', title: sb.label || '', codec: sb.format || 'vtt', forced: false, default: !!sb.default, text: true, url: sb.play }));
    if (!it.subPicked) it.subIndex = preferredSub(it);
    if (r.episode.duration && !it.dur) it.dur = r.episode.duration;
    if (r.episode.title && !it.title) { it.title = r.episode.title; it.name = nameFor(r.episode, state.seasons.find(s => s.series.id === it.seriesId)?.series); }
    return r;
  })();
  try { return await it.opening; } finally { it.opening = null; }
}

/* ── which quality plays ─────────────────────────────────────
   The wanted quality when the source has it, else the best it has.
   Qualities are read as numbers: "1080p" beats "720p". */
/* an HLS stream with no quality named is adaptive: it counts as the best */
const qualityNum = (q, kind) => Number((/(\d{3,4})/.exec(String(q || '')) || [])[1]) || (kind === 'hls' && !q ? 9999 : 0);
const streamRank = s => qualityNum(s.quality, s.kind);
/* The stream to play, out of every live source of the dub. The wanted
   quality when any source has it, the current source first among
   equals; else what the server picked, else the best there is. */
function pickStream(streams, chosen = null) {
  if (!streams || !streams.length) return chosen;
  const current = chosen ? chosen.player : null;
  const sorted = [...streams].sort((a, b) => streamRank(b) - streamRank(a) || (b.player === current) - (a.player === current));
  if (state.quality !== 'auto') {
    const same = sorted.filter(s => s.quality === state.quality);
    if (same.length) return same.find(s => s.player === current) || same[0];
  }
  if (chosen && streams.some(s => s.id === chosen.id)) return streams.find(s => s.id === chosen.id);
  return sorted[0];
}

/* The qualities on offer: the source's streams when there are several,
   else the levels of an HLS master playlist that hls.js found. */
function qualityOptions() {
  const it = cur();
  if (!it) return [];
  const out = [];
  const seen = new Set();
  /* every quality any live source offers; the players that offer it, as a note */
  for (const s of [...(it.streams || [])].sort((a, b) => streamRank(b) - streamRank(a))) {
    if (!s.quality || seen.has(s.quality)) continue;
    seen.add(s.quality);
    const players = [...new Set((it.streams || []).filter(x => x.quality === s.quality).map(x => x.player).filter(Boolean))];
    out.push({ id: s.quality, main: s.quality, sub: players.length > 1 || (players[0] && players[0] !== (it.source && it.source.player)) ? players.join(' · ') : '', sel: state.quality === s.quality, stream: s });
  }
  if (out.length < 2 && hls && hls.levels && hls.levels.length > 1) {
    return [{ id: 'auto', main: t('quality.auto'), sel: hls.autoLevelEnabled, level: -1 },
      ...hls.levels.map((l, i) => ({ id: 'L' + i, main: (l.height ? l.height + 'p' : Math.round(l.bitrate / 1000) + 'k'), sel: !hls.autoLevelEnabled && hls.currentLevel === i, level: i }))
        .sort((a, b) => qualityNum(b.main) - qualityNum(a.main))];
  }
  if (out.length >= 2) out.unshift({ id: 'auto', main: t('quality.auto'), sel: state.quality === 'auto' });
  return out;
}

function syncQualityButton() {
  const opts = qualityOptions();
  const it = cur();
  btnQuality.hidden = opts.length < 2;   // nothing to choose from: no button; the dub's name keeps its width on its own
  const now = it && it.stream && it.stream.quality ? it.stream.quality : (hls && hls.levels && hls.levels[hls.currentLevel] ? hls.levels[hls.currentLevel].height + 'p' : '');
  qualityLabel.textContent = now || (it && it.stream && it.stream.kind === 'hls' ? t('quality.auto') : t('quality.short'));
  btnQuality.title = now ? t('quality.current', { name: now }) : t('quality.title');
  if (opts.length < 2) qualityMenu.classList.remove('open');
  fitDeck();
}

function buildQualityMenu() {
  const opts = qualityOptions();
  qualityMenu.replaceChildren();
  menuTitle(qualityMenu, t('quality.title'));
  for (const o of opts) {
    const b = document.createElement('button');
    b.className = 'menu__item' + (o.sel ? ' sel' : '');
    b.innerHTML = `<span class="menu__tick">${phSvg(PH.check)}</span><span class="menu__body"><span class="menu__main"></span>${o.sub ? '<span class="menu__sub"></span>' : ''}</span>`;
    b.querySelector('.menu__main').textContent = o.main;
    if (o.sub) b.querySelector('.menu__sub').textContent = o.sub;
    b.onclick = () => { pickQuality(o); markPicked(b); };
    qualityMenu.append(b);
  }
}

function pickQuality(opt) {
  const it = cur();
  if (!it) return;
  if (opt.level !== undefined) {           // a level inside one HLS stream
    if (hls) hls.currentLevel = opt.level;
    toast(t('quality.current', { name: opt.main }));
    setTimeout(syncQualityButton, 300);
    return;
  }
  state.quality = opt.id;
  saveStr('lapka.quality', opt.id);
  const next = pickStream(it.streams, it.stream);
  if (!next || (it.stream && next.id === it.stream.id)) { syncQualityButton(); return; }
  toast(t('quality.current', { name: opt.main + (next.player && next.player !== (it.source && it.source.player) ? ' · ' + next.player : '') }));
  switchTrack(it);
}
btnQuality.onclick = e => {
  e.stopPropagation();
  buildQualityMenu();
  closeMenus(qualityMenu);
  qualityMenu.classList.toggle('open');
};

async function sourceFor(it) {
  const avoid = it.avoid; it.avoid = null;
  const slow = setTimeout(() => showProgress(it, 'prep.players'), 400);
  let r;
  try { r = await resolveItem(it, { avoid }); }
  catch (e) {
    clearTimeout(slow); hideProgress();
    it.err = true; it.why = e.message; render();
    toast(t('toast.openFail', { name: it.name, why: e.message }));
    return null;
  }
  clearTimeout(slow); hideProgress();
  if (it !== cur()) return null;
  if (!r.stream) {
    /* no live source: the reason stands on the stage, a closed player named as such */
    const why = (r.dead || []).map(d => d.error === 'no extractor' ? t('why.closedPlayer', { player: d.player }) : d.error === 'closed door' ? t('why.closedDoor', { player: d.player }) : `${d.player}: ${d.error}`).join('; ');
    it.err = true; it.why = why; render();
    showNotice(t('notice.noOpen', { name: it.name, why }), { mid: true });
    return null;
  }
  it.err = false;
  /* the dub the server settled on is the one carried on */
  if (state.dubKey && r.dub && r.dub.key !== state.dubKey) toast(t('toast.carried', { name: r.dub.name }));
  if (r.dub) state.dubKey = r.dub.key;
  /* mid-switch: the line now names the source being tried */
  if (it.switching && r.source) showNotice(t('notice.switchingTo', { from: it.switching.from || '?', to: r.source.player, n: it.switching.n, total: 3 }), { kind: 'switching', busy: true });
  paintMeta();
  /* the stream this page chose for the wanted quality, not the server's best: the server does not know the quality wanted */
  return it.stream || r.stream;
}

/* The next episode is opened while the current one plays, so that
   its streams are ready when it is its turn. */
function prefetchNext() {
  const nx = state.list[idxOf(cur()) + 1];
  if (nx && !nx.stream && !nx.err && !nx.opening) resolveItem(nx).then(() => paintMeta()).catch(() => {});
}

/* ── changing the picture ─────────────────────────────────────
   Fade to black takes 0.22 s, the new frame appears over 0.32 s. It is
   revealed not on a timer but when the first frame is actually there:
   preparing a file can take a minute, and a guessed delay is no use. */
let fadeTok = 0;

function fadeOut() {
  fadeTok++;
  stage.classList.add('fading');
  return sleep(220);
}

function fadeIn() {
  const tok = fadeTok;
  return () => { if (tok === fadeTok) stage.classList.remove('fading'); };
}

/* ═══════════════ playback ═══════════════ */
/* the empty screen stays hidden until boot ends: it is not yet decided
   which button is the primary one, or whether there is a server */
let booted = false;
let playToken = 0;

/* glide is false for a file picked in the queue: its row is already
   under the pointer, and scrolling would move it away from there */
async function playItem(it, autoplay = true, glide = true) {
  if (!it) return;
  if (loaded) markPos(loaded, video.currentTime);   // where the episode before was left
  loaded = null;
  state.current = it;
  state.seekPreview = null;
  if (dubsInfo && (dubsInfo.seriesId !== it.seriesId || dubsInfo.episode !== it.number)) dubsInfo = null;
  skipNow = null; skipEl.hidden = true;
  if (!it.switching) hideNotice();   // the notice of a source being switched stays until the picture is back
  endCard.classList.remove('show');
  emptyEl.classList.add('hide');
  stage.classList.remove('is-empty');

  paintTitle();
  ghostName.textContent = it.name;
  if (state.pipWin) state.pipWin.document.title = it.name;
  paintActive(); syncAudioButton(); syncStatus(); mediaMeta(it);
  if (glide && state.set.follow === 'on') revealCurrent();
  deckShow(false);

  const token = ++playToken;
  const faded = fadeOut();
  video.pause();                      // the episode before stops at once: a new one was asked for
  const src = await sourceFor(it);
  const reveal = fadeIn();
  if (token !== playToken || it !== cur()) { autoSwitch = false; reveal(); return; }
  if (!src) {
    /* the episode asked for did not open: the one before it must not
       go on as if nothing was clicked; the stage says what happened */
    autoSwitch = false;
    stopPlayback();
    reveal();
    paintPlay(); deckShow(true);
    showNotice(t('notice.noOpen', { name: it.name, why: it.why || '' }), { action: t('notice.retry'), onAction: () => { it.err = false; it.retries = 0; playItem(it); } });
    return;
  }
  if (!it.switching) hideNotice();

  await faded;                       // let the fade finish
  if (token !== playToken || it !== cur()) return;

  /* returning to the last position: only if the episode was left in
     the middle, and only once per start, after that it is ordinary
     watching */
  const back = (state.positions[posKey(it)] || {}).t;
  loadSource(it, src, token, () => {
  syncSubsButton(); applySubs(it);   // the tracks of this source, when there are any
    const d = duration();
    if (back == null || back < POS_MIN || (d && back > d - POS_TAIL)) return;
    video.currentTime = back;
    toast(t('toast.resume', { time: fmt(back) }));
  }, autoplay);
  syncAudioButton(); syncSubsButton(); syncQualityButton(); applySubs(it);
  prefetchNext();
}

/* Puts a source into the video: the one place where a start ends, for a
   new file and for a new track alike. Both used to do it on their own,
   and they differed where it hurt. The track change never brought the
   picture back, so overtaking a file mid-fade left it dark. And the jump
   to a saved position was a bare listener: set for one file and left
   waiting when the next file came in before its metadata, it moved that
   next file to the first one's position. Now the jump answers to the
   start it belongs to, and the picture is shown for whichever start
   comes last. A refused play() is not reported: it also fails on every
   interrupted start, and the play button shows the state anyway. */
function loadSource(it, src, token, onMeta, play) {
  it.loadedSrc = src.play;
  loaded = null;
  attachSource(src);
  sayLoading(it);
  const reveal = fadeIn();
  video.addEventListener('loadeddata', reveal, { once: true });
  setTimeout(reveal, 4000);          // a fallback in case the frame never arrives
  video.addEventListener('loadedmetadata', () => { if (token === playToken) { loaded = it; onMeta(); } }, { once: true });
  if (play) video.play().catch(() => {});
}

/* The quality the user wants, applied inside an adaptive stream: the
   level of that height, else the tallest below it; "auto" gives the
   choice back to hls.js. A stream of one quality is left alone. */
function applyLevelPref() {
  const it = cur();
  if (!hls || !hls.levels || hls.levels.length < 2 || (it && it.stream && it.stream.quality)) return;
  if (state.quality === 'auto') { if (!hls.autoLevelEnabled) hls.currentLevel = -1; return; }
  const want = qualityNum(state.quality);
  let best = -1, bestH = 0;
  hls.levels.forEach((l, i) => { const h = l.height || 0; if (h <= want && h > bestH) { bestH = h; best = i; } });
  if (best < 0) hls.levels.forEach((l, i) => { const h = l.height || 0; if (!bestH || h < bestH) { bestH = h; best = i; } });
  if (best >= 0 && hls.currentLevel !== best) hls.currentLevel = best;
}

/* The stream carries several audio renditions, one per dub: the one
   this dub is, by its index among the renditions of the group in
   play, is switched to inside hls.js; no other stream is loaded. */
function pickAudioTrack(stream) {
  if (!hls || !stream || !stream.audio) return;
  const all = hls.audioTracks || [];
  if (!all.length) return;
  const group = all[hls.audioTrack >= 0 ? hls.audioTrack : 0]?.groupId;
  const mine = all.filter(t => !group || t.groupId === group);
  const want = mine[stream.audio.index] || all[stream.audio.index];
  if (want && hls.audioTrack !== want.id) hls.audioTrack = want.id;
}

/* An HLS stream goes through hls.js, anything else straight into the
   element. A fatal error inside hls.js is reported the way the
   element reports its own, so one handler deals with both. */
function attachSource(stream) {
  if (hls) { hls.destroy(); hls = null; }
  if (stream.kind === 'hls' && window.Hls && Hls.isSupported()) {
    /* fewer silent retries than the defaults: a source that does not
       answer is given up on in seconds, not in a minute, and its
       trouble is said on the stage as soon as it starts */
    hls = new Hls({ enableWorker: true, manifestLoadingTimeOut: 8000, manifestLoadingMaxRetry: 1, levelLoadingTimeOut: 8000, levelLoadingMaxRetry: 1, fragLoadingTimeOut: 12000, fragLoadingMaxRetry: 2 });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) { video.dispatchEvent(new Event('error')); return; }
      const it = cur();
      /* a network error while the picture still moves is nothing to say; stalled, it is said at once */
      if (it && !it.switching && d.type === Hls.ErrorTypes.NETWORK_ERROR) { if (video.readyState < 3) showNotice(t('notice.slow', { player: (it.source && it.source.player) || '' }), { kind: 'busy', busy: true }); else sayStalled(it); }
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { applyLevelPref(); syncQualityButton(); pickAudioTrack(stream); });
    hls.on(Hls.Events.LEVEL_SWITCHED, () => { syncQualityButton(); if (audioMenu.classList.contains('open')) buildAudioMenu(); });
    hls.loadSource(stream.play);
    hls.attachMedia(video);
    return;
  }
  video.src = stream.play;
  video.load();
}

/* changing the dub: another stream, the same position */
async function switchTrack(it) {
  /* a file still starting counts as playing: the start meant to play it */
  const at = video.currentTime, playing = !video.paused || !it.loadedSrc;
  const token = ++playToken;
  const src = await sourceFor(it);
  if (token !== playToken || it !== cur() || !src) return;
  /* the same stream, another rendition of its sound: switched inside, without a reload */
  if (src.audio && it.loadedSrc === src.play && hls) { pickAudioTrack(src); syncAudioButton(); syncSubsButton(); applySubs(it); return; }
  loadSource(it, src, token, () => { video.currentTime = at; }, playing);
  syncAudioButton(); syncSubsButton(); applySubs(it);
  if (audioMenu.classList.contains('open')) buildAudioMenu();   // the mark on the quality follows the stream now playing
  prefetchNext();          // the next episode is opened with the new choice
}

function next(auto = false) {
  const i = idxOf(cur());
  if (i < 0) { if (state.list.length) playItem(state.list[0]); return; }
  /* looping one file applies only on its own: pressing next means the
     user is leaving for the next file anyway */
  if (auto && state.loop === 'one') { video.currentTime = 0; video.play().catch(() => {}); return; }
  if (i + 1 < state.list.length) return playItem(state.list[i + 1]);
  if (state.loop === 'queue' && state.list.length) return playItem(state.list[0]);
  if (auto) endOfQueue(); else toast(t('toast.lastFile'));
}
function prev() {
  const i = idxOf(cur());
  if (position() > 3) return seekTo(0);
  if (i > 0) playItem(state.list[i - 1]);
  else if (state.loop === 'queue' && state.list.length) playItem(state.list[state.list.length - 1]);
  else seekTo(0);
}
function endOfQueue() {
  video.pause();
  paintEndMeta();
  endCard.classList.add('show');
  autoSwitch = false;        // there will be no more transitions
  deckShow(true);
}
/* The queue summary is rebuilt on a language change too, hence its own function. */
function paintEndMeta() {
  const total = state.list.reduce((a, b) => a + (b.dur || 0), 0);
  endMeta.textContent = t('queue.count', { n: state.list.length }) + ' · ' + fmtLong(total);
}

function togglePlay() {
  if (!cur()) { if (state.list.length) playItem(state.list[0]); return; }
  if (endCard.classList.contains('show')) return playItem(state.list[0]);
  /* after the queue is restored a file is selected but has no source
     yet: the first press of play opens it instead of pressing an empty
     video element */
  if (!video.getAttribute('src')) return playItem(cur());
  if (video.paused) video.play().catch(() => {}); else video.pause();
}
function nudge(sec) {
  if (!duration()) return;
  seekTo(position() + sec);
  flash((sec > 0 ? '+' : '−') + t('units.sec', { n: Math.abs(sec) }));
}

let flashT;
function flash(t) {
  flashEl.textContent = t;
  flashEl.classList.add('go');
  clearTimeout(flashT);
  flashT = setTimeout(() => flashEl.classList.remove('go'), 520);
}
function pulse(playing) {
  setIcon(pulseIcon, playing ? PH.play : PH.pause);
  pulseEl.classList.remove('go'); void pulseEl.offsetWidth; pulseEl.classList.add('go');
}

/* ── visibility of the control deck ───────────────────────────
   There is one rule and it lives here. It used to be smeared across
   playItem, next, play, pause and ended, and every fix to one case
   broke the others.

   autoSwitch is raised for the duration of an automatic move between
   files: while it is raised and the setting says to hide, nothing
   inside the player unfolds the deck. Anything the user does, moving
   the mouse or pressing a key, always shows it. */
let hideT, overDeck = false, autoSwitch = false;

function poke() {
  stage.classList.remove('idle', 'cursor-hidden');
  clearTimeout(hideT);
  hideT = setTimeout(() => {
    if (video.paused || overDeck || endCard.classList.contains('show')) return;
    if (anyMenuOpen()) return;
    stage.classList.add('idle', 'cursor-hidden');
  }, 2600);
}

/* shown on the player's own initiative: during an automatic move to the
   next file it obeys the setting that hides the controls */
function deckShow(persist) {
  if (autoSwitch && state.set.hideUi === 'on') return;
  if (persist) { stage.classList.remove('idle', 'cursor-hidden'); clearTimeout(hideT); }
  else poke();
}

stage.addEventListener('pointermove', poke);
deck.addEventListener('pointerenter', () => { overDeck = true; });
deck.addEventListener('pointerleave', () => { overDeck = false; poke(); });

/* In a narrow window the queue takes the whole width, and docked beside
   the video it squeezed the frame to nothing. There it always lies over
   the video, whatever the setting says, and behaves as it does in that
   mode: a click on the picture closes it. */
const queueOverlays = () => !queueDocked();
let clickT = null, justClosed = 0;
/* a menu of the deck or of the settings, or the tray of the gear, in
   this tab or in the extended PiP window */
const panelOpen = () => anyMenuOpen()
  || (deck.classList.contains('deck--packed') && deckPack.classList.contains('open'))
  || !!(pipView && pipView.querySelector('.menu.open'));
video.addEventListener('click', e => {
  e.preventDefault();
  /* With something open over the picture, a click on the picture closes
     it and does nothing else: it neither pauses nor starts the video. */
  if (panelOpen()) {
    clearTimeout(clickT); clickT = null;
    justClosed = Date.now();
    closeMenus(); closePack(); closePipMenus();
    return;
  }
  /* A click on the picture closes the file panel only while that panel
     covers the picture. In the mode where it narrows the video there is
     no overlap, so the click does the usual thing and pauses. */
  if (state.queueOpen && !state.pipWin && queueOverlays()) {
    clearTimeout(clickT); clickT = null;
    justClosed = Date.now();
    toggleQueue(false);
    return;
  }
  if (state.pipWin) return togglePlay();
  if (clickT) return;
  clickT = setTimeout(() => { clickT = null; togglePlay(); }, 200);
});
video.addEventListener('dblclick', e => {
  e.preventDefault(); clearTimeout(clickT); clickT = null;
  if (Date.now() - justClosed < 400) return;   // the second click of a close is not a fullscreen request
  if (!state.pipWin) toggleFull();
});

/* ── sliders ───────────────────────────────────────────────── */
function bindSlider(el, { onInput, onCommit, onHover }) {
  let dragging = false;
  const ratio = e => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
  };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragging = true; el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    onInput(ratio(e)); e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (onHover) onHover(ratio(e));
    if (dragging) onInput(ratio(e));
  });
  const up = e => {
    if (!dragging) return;
    dragging = false; el.classList.remove('dragging');
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (onCommit) onCommit(ratio(e));
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/* named, the PiP window's copy of the deck binds its sliders to the same */
const seekSlider = {
  onInput: r => { state.seekPreview = r * duration(); paintSeek(); },
  onCommit: r => seekTo(r * duration()),
  onHover: r => { seekTip.textContent = fmt(r * duration()); seekTip.style.left = r * 100 + '%'; },
};
bindSlider(seek, seekSlider);
seek.addEventListener('keydown', e => {
  const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -60, PageUp: 60 }[e.key];
  if (step != null) { e.preventDefault(); e.stopPropagation(); nudge(e.shiftKey ? step / 5 : step); }
  if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); seekTo(0); }
  if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); seekTo(duration() - 2); }
});

const volSlider = {
  onInput: r => { video.volume = r; video.muted = r === 0; },
};
bindSlider(volBar, volSlider);
volBar.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); video.volume = Math.max(0, video.volume - .05); }
  if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); video.volume = Math.min(1, video.volume + .05); }
});

function paintSeek() {
  const d = duration(), p = d ? position() / d * 100 : 0;
  seekFill.style.width = p + '%';
  seekKnob.style.left = p + '%';
  seek.setAttribute('aria-valuenow', Math.round(p));
  seek.setAttribute('aria-valuetext', t('a11y.of', { cur: fmt(position()), dur: fmt(d) }));
  tCur.textContent = fmt(position());
  tDur.textContent = fmt(d);
  try {
    if (video.buffered.length && d) {
      seekBuffer.style.width = Math.min(100, video.buffered.end(video.buffered.length - 1) / d * 100) + '%';
    }
  } catch (_) {}
}
function paintVolume() {
  const v = video.muted ? 0 : video.volume;
  volFill.style.width = v * 100 + '%';
  setIcon(volIcon, v === 0 ? PH.volX : v < .5 ? PH.volLow : PH.volHigh);
}

/* ═══════════════ dubs ═══════════════
   The audio menu lists the dubs the episode offers. Choosing one is
   remembered for the series and carried to every next episode; where
   an episode lacks it, the server takes the nearest thing. */
function audioOptions() {
  const it = cur();
  if (!it || !it.dubs || !it.dubs.length) return [];
  const sel = it.dub ? it.dub.key : state.dubKey;
  return it.dubs.map(d => ({
    id: d.key, main: d.name, short: d.name,
    sub: d.alive ? t('audio.sources', { n: d.alive }) : d.sources ? t('audio.dead') : '',
    sel: d.key === sel,
  }));
}

function syncAudioButton() {
  const opts = audioOptions();
  btnAudio.hidden = opts.length < 2;
  const sel = opts.find(o => o.sel);
  audioLabel.textContent = sel ? (sel.short || sel.main) : t('audio.short');
  btnAudio.title = sel ? t('audio.current', { name: sel.main }) : t('audio.title');
  if (opts.length < 2) audioMenu.classList.remove('open');
  fitDeck();         // the name has changed, and so has the room it takes
}

let dubsInfo = null;          // what the server said each dub offers, for the episode the menu was built for
function buildAudioMenu() {
  const opts = audioOptions();
  const it = cur();
  audioMenu.replaceChildren();
  const head = document.createElement('div');
  head.className = 'menu__title';
  head.textContent = t('audio.title');
  audioMenu.append(head);

  if (!opts.length) {
    const e = document.createElement('div');
    e.className = 'menu__empty';
    e.textContent = t('audio.none');
    audioMenu.append(e);
    return;
  }

  const known = dubsInfo && it && dubsInfo.seriesId === it.seriesId && dubsInfo.episode === it.number ? dubsInfo.dubs : null;
  for (const o of opts) {
    const info = known && known.find(d => d.key === o.id);
    const b = document.createElement('button');
    b.className = 'menu__item menu__item--dub' + (o.sel ? ' sel' : '');
    b.innerHTML = `<span class="menu__tick">${phSvg(PH.check)}</span>
      <span class="menu__body"><span class="menu__main"></span>${o.sub ? '<span class="menu__sub"></span>' : ''}</span>
      <span class="menu__tags"></span>`;
    b.querySelector('.menu__main').textContent = o.main;
    if (o.sub) b.querySelector('.menu__sub').textContent = o.sub;
    const tags = b.querySelector('.menu__tags');
    if (info && info.qualities.length) {
      for (const q of info.qualities) {
        const tg = document.createElement('span');
        const nowQ = it.stream && (it.stream.quality || (hls && hls.levels && hls.currentLevel >= 0 && !hls.autoLevelEnabled && hls.levels[hls.currentLevel] ? hls.levels[hls.currentLevel].height + 'p' : null));
        const on = o.sel && it.stream && it.stream.id === q.id && (q.quality ? q.quality === nowQ : !nowQ);
        tg.className = 'qtag' + (on ? ' sel' : '');
        tg.textContent = q.quality || (q.kind === 'hls' ? t('quality.auto') : q.kind.toUpperCase());   // a file of unknown size is named by what it is, not called adaptive
        tg.title = q.player + ' · ' + q.kind.toUpperCase();
        tg.onclick = ev => {
          ev.stopPropagation();
          for (const x of audioMenu.querySelectorAll('.qtag.sel')) x.classList.remove('sel');   // the mark moves at once, the stream follows
          tg.classList.add('sel');
          pickAudio(o, q.quality || 'auto'); markPicked(b);
        };
        tags.append(tg);
      }
    } else if (info && info.unopened) { const w = document.createElement('span'); w.className = 'qtag qtag--wait'; w.textContent = '…'; tags.append(w); }
    b.onclick = () => { pickAudio(o); markPicked(b); };
    audioMenu.append(b);
  }
  /* what each dub can play in is asked once per episode; the sources
     not yet opened are opened for it, and the menu is drawn again */
  if (it && !known) {
    api(`/api/dubs?series=${it.seriesId}&episode=${it.number}`).then(d => { dubsInfo = { seriesId: it.seriesId, episode: it.number, dubs: d.dubs }; if (audioMenu.classList.contains('open')) buildAudioMenu(); }).catch(() => {});
    api(`/api/dubs?series=${it.seriesId}&episode=${it.number}&open=1`).then(d => { dubsInfo = { seriesId: it.seriesId, episode: it.number, dubs: d.dubs }; if (audioMenu.classList.contains('open')) buildAudioMenu(); }).catch(() => {});
  }
}

function pickAudio(opt, quality = null) {
  const it = cur();
  if (!it) return;
  if (quality) { state.quality = quality; saveStr('lapka.quality', quality); }
  if (it.dub && it.dub.key === opt.id) {
    if (!quality) return;
    /* the same dub: a quality inside the stream playing is a level of it; another stream is a switch */
    if (it.stream && !it.stream.quality && hls) { applyLevelPref(); setTimeout(syncQualityButton, 300); if (audioMenu.classList.contains('open')) buildAudioMenu(); return; }
    switchTrack(it);
    return;
  }
  state.dubKey = opt.id;
  post(`/api/state/dub?series=${it.seriesId}&dub=${encodeURIComponent(opt.id)}`).catch(() => {});
  hideNotice();
  toast(t('audio.current', { name: opt.main }));
  switchTrack(it);
}

/* ═══════════════ subtitles ═══════════════
   Subtitle tracks live in the file separately from the audio ones and
   are not tied to them: the dub language and the subtitle language are
   chosen independently. The browser understands WebVTT only, so the
   server converts a text track into it. Image based ones (PGS, VOBSUB)
   hold pictures, not characters, and cannot be converted. */
function subOptions() {
  const it = cur();
  if (!it || !it.subs) return [];
  return it.subs.map(tr => {
    const name = langName(tr.lang);
    const title = (tr.title || '').trim();
    const main = name && title ? `${name} · ${title}`
               : name || title || t('audio.trackN', { n: tr.order + 1 });
    const bits = [`#${tr.order + 1}`, tr.codec.toUpperCase()];
    if (tr.forced) bits.push(t('subs.forced'));
    if (tr.default) bits.push(t('subs.default'));
    if (!tr.text) bits.push(t('subs.bitmap'));
    return { id: tr.index, main, sub: bits.join(' · '), text: tr.text, sel: tr.index === it.subIndex };
  });
}

function syncSubsButton() {
  const opts = subOptions();
  btnSubs.hidden = !opts.length;
  const on = cur() && cur().subIndex != null;
  btnSubs.classList.toggle('on', !!on);
  const sel = opts.find(o => o.sel);
  btnSubs.title = sel ? t('subs.current', { name: sel.main }) : t('subs.offToast');
  if (!opts.length) subsMenu.classList.remove('open');
  fitDeck();
}

/* A menu in two columns: tracks on the left, styling on the right. The
   lists are independent, there can be many tracks while the settings are
   always three, so each column scrolls on its own. The second column
   appears only when there is something to style: image based subtitles
   take no styles. */
function buildSubsMenu() {
  const opts = subOptions();
  const styleable = opts.some(o => o.text);
  subsMenu.replaceChildren();
  subsMenu.classList.toggle('menu--split', styleable);

  if (!opts.length) {
    menuTitle(subsMenu, t('subs.title'));
    const e = document.createElement('div');
    e.className = 'menu__empty';
    e.textContent = t('subs.none');
    subsMenu.append(e);
    return;
  }

  const list = document.createElement('div');
  list.className = 'menu__col';
  menuTitle(list, t('subs.title'));

  const row = (main, sub, sel, off, disabled) => {
    const b = document.createElement('button');
    b.className = 'menu__item' + (sel ? ' sel' : '');
    b.disabled = !!disabled;
    b.innerHTML = `<span class="menu__tick">${phSvg(PH.check)}</span>
      <span class="menu__body"><span class="menu__main"></span>${sub ? '<span class="menu__sub"></span>' : ''}</span>`;
    b.querySelector('.menu__main').textContent = main;
    if (sub) b.querySelector('.menu__sub').textContent = sub;
    b.onclick = () => { if (!disabled) { pickSub(off); markPicked(b); } };
    list.append(b);
  };

  row(t('subs.off'), '', cur().subIndex == null, null, false);
  for (const o of opts) row(o.main, o.sub, o.sel, o, !o.text);
  subsMenu.append(list);

  if (!styleable) return;

  const side = document.createElement('div');
  side.className = 'menu__col menu__col--side';
  menuTitle(side, t('cue.head'));
  for (const r of CUE_UI) {
    segRow(side, t(r.label), state.cue[r.key],
           r.opts.map(([val, key]) => [val, t(key)]), val => setCue(r.key, val));
  }
  subsMenu.append(side);
}

function pickSub(opt) {
  const it = cur();
  if (!it) return;
  it.subIndex = opt ? opt.id : null;
  it.subPicked = true;            // for this file the choice was made by hand
  state.subPref = opt ? { sig: subSig(it.subs), order: (it.subs.find(x => x.index === opt.id) || {}).order,
                          lang: (it.subs.find(x => x.index === opt.id) || {}).lang,
                          title: (it.subs.find(x => x.index === opt.id) || {}).title }
                      : null;
  applySubs(it);
  syncSubsButton();
  toast(opt ? t('subs.current', { name: opt.main }) : t('subs.offToast'));
}

const subSig = ts => (ts || []).map(x => `${x.lang}|${(x.title || '').trim()}|${x.codec}`).join('/');

function preferredSub(it) {
  const p = state.subPref;
  if (!p || !it.subs || !it.subs.length) return null;
  const text = it.subs.filter(x => x.text);
  if (!text.length) return null;
  if (p.sig === subSig(it.subs) && it.subs[p.order] && it.subs[p.order].text) return it.subs[p.order].index;
  const byBoth = text.find(x => same(x.lang, p.lang) && same(x.title, p.title));
  if (byBoth) return byBoth.index;
  const byLang = text.find(x => same(x.lang, p.lang));
  return byLang ? byLang.index : null;
}

/* One track element on the video at a time, owned here. A track that is
   simply removed leaves its last cue painted on the stage, so a track is
   switched off before it goes. Calls overlap (a source starts, the dub
   changes, a choice is made), so only the latest one attaches, and a track
   already up for the same file is left alone.

   Two ways of drawing. In the browser's look the track is showing and the
   browser draws the cues itself, with the plate the system gives them (on a
   Mac the system caption style is applied with !important and cannot be
   restyled). In every other look the track is hidden, it still runs its
   cues, and the active ones are drawn on Lapka's own layer over the video. */
const cues = $('#cues');
let subEl = null, subTicket = 0;
const sameUrl = (a, b) => new URL(a, location.href).href === new URL(b, location.href).href;
const ownCueLook = () => state.cue.bg !== 'browser';

function dropSubTrack() {
  for (const el of video.querySelectorAll('track')) {
    try { if (el.track) { el.track.oncuechange = null; el.track.mode = 'disabled'; } } catch (_) {}
    el.remove();
  }
  subEl = null;
  renderCues();
}

function showSubTrack(el) {
  if (el !== subEl || !el.track) return;
  el.track.oncuechange = renderCues;
  el.track.mode = ownCueLook() ? 'hidden' : 'showing';
  applyCueLine();
  renderCues();
}

async function applySubs(it) {
  const ticket = ++subTicket;
  const url = it && it.subIndex != null && it.subs ? (it.subs.find(x => x.index === it.subIndex) || {}).url : null;
  if (!url) { dropSubTrack(); return; }
  if (subEl && subEl.isConnected && sameUrl(subEl.getAttribute('src'), url)) { showSubTrack(subEl); return; }

  /* fetched in advance so an error can be caught and shown, not swallowed */
  let ok;
  try { ok = (await fetch(url)).ok; } catch (_) { return; }
  if (ticket !== subTicket || it !== cur() || it.subIndex == null) return;
  if (!ok) { toast(t('subs.fail')); it.subIndex = null; syncSubsButton(); return; }

  dropSubTrack();
  const el = document.createElement('track');
  el.kind = 'subtitles';
  el.src = url;
  el.default = true;
  subEl = el;
  video.append(el);
  /* switched on after the browser has parsed the file */
  el.addEventListener('load', () => showSubTrack(el), { once: true });
  setTimeout(() => showSubTrack(el), 200);
}

/* the active cues, drawn on the layer; the cue's own markup (italics,
   voices) comes as the browser parsed it, nothing of the file is trusted raw */
function renderCues() {
  const tr = subEl && subEl.track;
  if (!ownCueLook() || !tr || tr.mode === 'disabled') { cues.replaceChildren(); return; }
  const out = [];
  for (const cue of tr.activeCues || []) {
    const d = document.createElement('div');
    d.className = 'cue';
    d.append(cue.getCueAsHTML ? cue.getCueAsHTML() : document.createTextNode(cue.text || ''));
    out.push(d);
  }
  cues.replaceChildren(...out);
}
video.addEventListener('emptied', renderCues);

/* What is controlled: size, backing and line height. In the browser's look
   only the size reaches the browser's cues; the backing and the position
   are the browser's. In Lapka's looks all three are classes on the layer. */
const CUE_SIZE = ['s', 'm', 'l', 'xl'];
const CUE_BG = ['browser', 'shadow', 'plate'];
const CUE_POS = { low: -1, auto: 'auto', high: -4 };

const CUE_UI = [
  /* S/M/L/XL are not translated: the letters read the same everywhere */
  { key: 'size', label: 'cue.size', opts: [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']] },
  { key: 'bg',   label: 'cue.bg',   opts: [['browser', 'cue.bg.browser'], ['shadow', 'cue.bg.shadow'], ['plate', 'cue.bg.plate']] },
  { key: 'pos',  label: 'cue.pos',  opts: [['low', 'cue.pos.low'], ['auto', 'cue.pos.auto'], ['high', 'cue.pos.high']] },
];

function applyCueStyle() {
  const c = state.cue;
  for (const k of CUE_SIZE) video.classList.toggle('cue-size-' + k, c.size === k);
  cues.className = `cues cue-size-${c.size} cue-bg-${c.bg} cue-pos-${c.pos}`;
  if (subEl) showSubTrack(subEl); else renderCues();
}

/* the line of the browser's own cues; the layer places its own by class */
function applyCueLine() {
  const v = CUE_POS[state.cue.pos];
  if (!subEl || !subEl.track || !subEl.track.cues) return;
  for (const cue of subEl.track.cues) { try { cue.line = v; } catch (_) {} }
}

function setCue(key, val) {
  state.cue[key] = val;
  saveStr('lapka.cue.' + key, val);
  applyCueStyle();
  buildSubsMenu();
}

/* Label on top, options below it across the full width: on one line
   they did not fit and overlapped each other. */
/* A setting that is only on or off is a switch, not two buttons. */
function switchRow(menu, label, on, pick) {
  const line = document.createElement('label');
  line.className = 'menu__row menu__row--switch';
  const lab = document.createElement('span');
  lab.className = 'menu__rowlabel';
  lab.textContent = label;
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'switch' + (on ? ' on' : '');
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(!!on));
  sw.innerHTML = '<i></i>';
  sw.onclick = ev => {
    ev.stopPropagation();
    on = !on;
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
    pick(on);
  };
  line.append(lab, sw);
  menu.append(line);
}

function segRow(menu, label, current, opts, pick) {
  /* exactly on and off: a switch */
  if (opts.length === 2 && opts[0][0] === 'on' && opts[1][0] === 'off') return switchRow(menu, label, current === 'on', v => pick(v ? 'on' : 'off'));
  const line = document.createElement('div');
  line.className = 'menu__row';
  const lab = document.createElement('span');
  lab.className = 'menu__rowlabel';
  lab.textContent = label;
  /* a null among the options starts a second line of buttons; the choice is one across both */
  const groups = [], all = [];
  let group = null;
  for (const opt of opts) {
    if (!opt || !group) { group = document.createElement('div'); group.className = 'seg2'; groups.push(group); if (!opt) continue; }
    const [val, text] = opt;
    const b = document.createElement('button');
    b.textContent = text;
    b.className = current === val ? 'sel' : '';
    b.onclick = ev => {
      ev.stopPropagation();
      for (const x of all) x.classList.toggle('sel', x === b);
      pick(val);
    };
    group.append(b); all.push(b);
  }
  line.append(lab, ...groups);
  menu.append(line);
}

function menuTitle(menu, text) {
  const d = document.createElement('div');
  d.className = 'menu__title';
  d.textContent = text;
  menu.append(d);
}

/* ═══════════════ settings ═══════════════
   The one place where a setting turns into behaviour. It has to be
   called at startup as well, otherwise a saved value lives only in the
   menu. */
const narrowWindow = matchMedia('(max-width:820px)');
function queueDocked() { return state.set.queueMode === 'docked' && !narrowWindow.matches; }
narrowWindow.addEventListener('change', () => applySettings());
function applySettings() {
  workspace.classList.toggle('queue-docked', queueDocked());
  queueList.classList.toggle('no-drag', state.set.drag === 'off');
  for (const li of queueList.children) li.draggable = state.set.drag === 'on';
  /* the font lives in a variable on :root, and the same one has to be
     set in the extended PiP window: the copy of the player there takes
     it from the window's own root element */
  document.documentElement.dataset.font = state.set.font;
  if (state.pipWin) state.pipWin.document.documentElement.dataset.font = state.set.font;
}

/* Key caps are not translated: they are in Latin letters on the
   keyboard anyway, and "Leertaste" instead of Space would have to be
   hunted for. */
/* three columns by meaning: moving through the episode, sound and the next one, the window */
const KEYS_UI = [
  [
    [['Space', 'K'],   'keys.play'],
    [['←', '→'],       'keys.seek5'],
    [['Shift ←', 'Shift →'], 'keys.seek1'],
    [['J', 'L'],       'keys.seek10'],
    [['0–9'],          'keys.jump'],
    [['Home', 'End'],  'keys.edges'],
  ], [
    [['↑', '↓'],       'keys.volume'],
    [['M'],            'keys.mute'],
    [['B', 'N'],       'keys.nextPrev'],
  ], [
    [['P'],            'keys.pip'],
    [['F'],            'keys.full'],
    [['Q'],            'keys.queue'],
    [['Esc'],          'keys.esc'],
  ],
];

/* ── the cache row ───────────────────────────────────────────
   One bar that is both the indicator and the control. The solid part is
   what the cache holds now, the lighter part up to the knob is the room
   left under the limit, and the knob itself is the limit: dragging it
   changes it.

   The scale is the disk. It starts at zero and ends at what the cache
   could take there: the space it already holds plus the space still
   free. The knob stops at 4 GB at the low end and at that edge at the
   high end. Free space changes without us, so a limit saved earlier can
   end up past the edge; then the knob sits on the edge as a ring and
   the line under the bar says why.

   Without disk figures (Node older than 18.15 has no statfs) the scale
   is simply twice the larger of the limit and what is taken.

   The row lives in the settings column and only in server mode, because
   without ffmpeg there is nothing to put in a cache. The file playing
   right now is left alone when clearing: the browser holds it open and
   the next seek would go nowhere. */
function playingKey() {
  return cur() && cur().stream ? cur().stream.id : '';
}

const GB = 1024 ** 3;

/* What the server said last about the cache and the folder, kept, so
   the sheet is drawn whole the moment it opens and never waits for an
   answer under the eye; each opening asks again in the background and
   repaints only when something changed. The first answers are fetched
   at boot. */
const known = { home: null, cache: null };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const askHome = () => api('/api/home').then(d => { const changed = !same(known.home, d); known.home = d; return changed; });
const askCache = () => api('/api/cache').then(d => { const changed = !same(known.cache, d); known.cache = d; return changed; });

function cacheRow(col) {
  const line = document.createElement('div');
  line.className = 'menu__row';
  line.innerHTML =
    '<div class="cache__head"><span class="menu__rowlabel"></span><span class="cache__size">…</span></div>' +
    '<div class="cache__bar" role="slider" tabindex="0">' +
      '<div class="cache__rail"><div class="cache__room"></div><div class="cache__used"></div></div>' +
      '<div class="cache__knob"></div>' +
    '</div>' +
    '<div class="cache__note"></div>' +
    '<button class="cache__clear"></button>';
  col.append(line);

  const q = s => line.querySelector(s);
  const bar = q('.cache__bar'), size = q('.cache__size'), note = q('.cache__note'), clear = q('.cache__clear');
  q('.menu__rowlabel').textContent = t('set.cache');
  clear.textContent = t('set.cacheClear');
  clear.disabled = true;
  bar.setAttribute('aria-label', t('a11y.cacheLimit'));

  let d = null;          // the last answer from the server
  let limitGb = null;    // what the knob shows, may run ahead of the server while dragging
  const scale = () => d.max != null ? d.max : 2 * Math.max(d.limit, d.bytes, d.min);
  const loGb = () => d.min / GB;
  const hiGb = () => Math.max(loGb(), Math.floor(scale() / GB));
  const pct = bytes => Math.min(100, Math.max(0, bytes / scale() * 100)) + '%';

  const paint = () => {
    if (!d) return;
    const limit = limitGb * GB;
    size.textContent = t('set.cacheOf', { used: fmtSize(d.bytes), limit: t('units.gb', { n: limitGb }) });
    q('.cache__used').style.width = pct(d.bytes);
    q('.cache__room').style.width = pct(Math.max(limit, d.bytes));
    q('.cache__knob').style.left = pct(limit);
    bar.setAttribute('aria-valuemin', String(loGb()));
    bar.setAttribute('aria-valuemax', String(hiGb()));
    bar.setAttribute('aria-valuenow', String(limitGb));
    bar.setAttribute('aria-valuetext', t('units.gb', { n: limitGb }));
    const over = d.max != null && limit > d.max;
    bar.classList.toggle('over', over);
    note.textContent = over ? t('set.cacheOver')
                     : d.free == null ? '' : t('set.cacheFree', { size: fmtSize(d.free) });
    clear.disabled = !d.files;
  };
  const take = answer => { d = answer; known.cache = answer; limitGb = Math.round(d.limit / GB); paint(); };

  if (known.cache) take(known.cache);
  askCache().then(changed => { if (changed || !d) take(known.cache); })
    .catch(() => { if (!d) size.textContent = t('set.cacheFail'); });

  const gbAt = ratio => Math.min(hiGb(), Math.max(loGb(), Math.round(ratio * scale() / GB)));
  let sent = null;
  const commit = async () => {
    if (!d || limitGb === Math.round(d.limit / GB)) return;
    const want = limitGb;
    sent = want;
    try {
      const r = await fetch('/api/cache/limit?gb=' + want, { method: 'POST', headers: { 'x-lapka': '1' } });
      const answer = await r.json();
      if (sent === want) take(answer);     // a later change wins over an earlier answer
    } catch (_) { toast(t('set.cacheFail')); }
  };

  bindSlider(bar, {
    onInput: r => { if (!d) return; limitGb = gbAt(r); paint(); },
    onCommit: () => commit(),
  });

  /* Keys stay inside the bar: the player's own shortcuts listen on the
     document, and without this the arrows would seek the video while
     the limit moves. The limit is sent once the keys stop. */
  let keyT = null;
  bar.addEventListener('keydown', e => {
    if (!d) return;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -8, PageUp: 8 }[e.key];
    if (step) limitGb = Math.min(hiGb(), Math.max(loGb(), limitGb + step));
    else if (e.key === 'Home') limitGb = loGb();
    else if (e.key === 'End') limitGb = hiGb();
    else return;
    e.preventDefault(); e.stopPropagation();
    paint();
    clearTimeout(keyT);
    keyT = setTimeout(commit, 500);
  });

  clear.onclick = async ev => {
    ev.stopPropagation();
    clear.disabled = true;
    try {
      const r = await fetch('/api/cache?keep=' + playingKey(),
        { method: 'POST', headers: { 'x-lapka': '1' } });
      const answer = await r.json();
      take(answer);
      toast(t('toast.cacheCleared', { size: fmtSize(answer.freed.bytes) }));
    } catch (_) { toast(t('set.cacheFail')); }
  };
}

/* ── the Lapka folder ───────────────────────────────────────────
   Where everything is kept, and what it weighs apart from the cache:
   the files saved and Lapka's notes. The path is shown as it is; a new
   path typed here is created if it does not exist and taken into use at
   once. Three kinds of things live in the folder and each is cleared on
   its own: the cache in its row, the saved files and the notes here,
   each by a quiet button that asks on the first click and acts on the
   second. */
function homeRow(col) {
  /* the folder: where, how much in all, the way to another one */
  const line = document.createElement('div');
  line.className = 'menu__row';
  line.innerHTML =
    '<div class="cache__head"><span class="menu__rowlabel"></span><span class="cache__size home__size"></span></div>' +
    '<div class="home__path"></div>' +
    '<div class="home__acts"><button class="cache__clear home__open"></button><button class="cache__clear home__pick"></button></div>' +
    '<button class="home__manual"></button>' +
    '<form class="home__form" hidden><input class="linkform__in home__in" spellcheck="false"><button type="submit" class="cache__clear home__go"></button></form>' +
    '<div class="cache__note home__note"></div>';
  /* the two kinds of things of Lapka's own in it, each said what it is, with its own way out */
  const part = (cls) => {
    const row = document.createElement('div');
    row.className = 'menu__row';
    row.innerHTML = `<span class="menu__rowlabel"></span><div class="home__part"><div class="home__what"><div class="cache__note home__why"></div><div class="home__count"></div></div><button class="btn btn--quiet ${cls}"></button></div>`;
    return row;
  };
  const videos = part('home__files'), notes = part('home__notes');
  col.append(line, videos, notes);
  const q = s => line.querySelector(s);
  q('.menu__rowlabel').textContent = t('set.home');
  videos.querySelector('.menu__rowlabel').textContent = t('set.homeVideos');
  notes.querySelector('.menu__rowlabel').textContent = t('set.homeNotesHead');
  q('.home__open').textContent = t('set.homeOpen');
  q('.home__pick').textContent = t('set.homePick');
  q('.home__manual').textContent = t('set.homeManual');
  q('.home__go').textContent = t('set.homeChange');
  q('.home__in').placeholder = t('set.homePlaceholder');

  let d = null;          // the last answer from the server
  const files = videos.querySelector('.home__files'), forget = notes.querySelector('.home__notes');
  const paint = answer => {
    d = answer;
    q('.home__path').textContent = d.home;
    /* the folder in all: the files, the notes and the cache together */
    q('.home__size').textContent = fmtSize((d.bytes || 0) + ((d.cache && d.cache.bytes) || 0));
    q('.home__pick').hidden = !d.canPick;
    q('.home__open').hidden = !d.canOpen;
    q('.home__note').textContent = d.canPick ? '' : t('set.homeHint');
    if (!d.canPick) { q('.home__form').hidden = false; q('.home__manual').hidden = true; }
    videos.querySelector('.home__why').textContent = t('set.homeVideosNote');
    videos.querySelector('.home__count').textContent = t('set.homeVideosCount', { n: d.files, size: fmtSize(d.filesBytes || 0) });
    notes.querySelector('.home__why').textContent = t('set.homeNotesNote');
    notes.querySelector('.home__count').textContent = t('set.homeNotesCount', { n: d.notes, size: fmtSize(d.notesBytes || 0) });
    files.disabled = !d.files; forget.disabled = !d.notes;
    paintQuiet();
  };
  const paintQuiet = () => {
    if (!d) return;
    files.textContent = files.classList.contains('is-armed') ? t('pop.deleteSure', { n: d.files }) : t('set.homeDelete');
    forget.textContent = forget.classList.contains('is-armed') ? t('set.homeNotesSure') : t('set.homeDelete');
  };
  const reload = () => askHome().then(changed => { if (changed || !d) paint(known.home); })
    .catch(() => { if (!d) { q('.home__path').textContent = '—'; q('.home__size').textContent = ''; } });
  if (known.home) paint(known.home);
  reload();

  /* the first click asks, the second acts; the question goes away on its own */
  const arm = (b, run) => async ev => {
    ev.stopPropagation();
    if (b.classList.contains('is-armed')) {
      b.classList.remove('is-armed'); b.disabled = true;
      try { await run(); } catch (e) { toast(t('toast.homeFail', { why: e.message })); }
      await reload();
      return;
    }
    b.classList.add('is-armed'); paintQuiet();
    clearTimeout(b._arm); b._arm = setTimeout(() => { b.classList.remove('is-armed'); paintQuiet(); }, 4000);
  };
  files.onclick = arm(files, async () => {
    const r = await post('/api/library/clear');
    toast(t('toast.deleted', { n: r.removed }));
    loadLibrary();                       // the rows lose their saved marks
  });
  forget.onclick = arm(forget, async () => {
    await post('/api/state/forget');
    state.positions = {}; state.watched = {};
    if (state.remote) state.remote.dubs = {};
    paintMeta();                         // the bars and the veils go
    toast(t('toast.forgot'));
  });

  const took = r => {
    toast(t(r.created ? 'toast.homeCreated' : 'toast.homeSet', { path: r.home }));
    buildGearMenu(); gearMenu.classList.add('open');
  };
  q('.home__open').onclick = ev => { ev.stopPropagation(); post('/api/home/open').catch(e => toast(t('toast.homeFail', { why: e.message }))); };
  q('.home__pick').onclick = async ev => {
    ev.stopPropagation();
    q('.home__pick').disabled = true;
    try {
      const r = await post('/api/home/pick');
      if (r.cancelled) return;
      /* the old folder holds a library: taken along, or left where it is */
      if (r.hasContent) {
        closeMenus();
        showNotice(t('notice.homeMove', { path: r.chosen }), { mid: true, action: t('notice.homeMoveGo'), onAction: async () => {
          try { const m = await post('/api/home?path=' + encodeURIComponent(r.chosen) + '&move=1'); toast(t('toast.homeMoved', { path: m.home })); loadLibrary(); }
          catch (e) { toast(t('toast.homeFail', { why: e.message })); }
        }, onClose: async () => {
          try { took(await post('/api/home?path=' + encodeURIComponent(r.chosen))); } catch (e) { toast(t('toast.homeFail', { why: e.message })); }
        } });
        return;
      }
      took(await post('/api/home?path=' + encodeURIComponent(r.chosen)));
    }
    catch (e) { toast(t('toast.homeFail', { why: e.message })); }
    finally { q('.home__pick').disabled = false; }
  };
  q('.home__manual').onclick = ev => { ev.stopPropagation(); q('.home__form').hidden = false; q('.home__manual').hidden = true; q('.home__in').focus(); };
  q('.home__form').addEventListener('submit', async ev => {
    ev.preventDefault(); ev.stopPropagation();
    const path = q('.home__in').value.trim();
    if (!path) return;
    try { took(await post('/api/home?path=' + encodeURIComponent(path))); }
    catch (e) { toast(t('toast.homeFail', { why: e.message })); }
  });
  /* typing in the field must not seek the video */
  q('.home__in').addEventListener('keydown', ev => ev.stopPropagation());
  for (const el of [line, videos, notes]) el.addEventListener('click', ev => ev.stopPropagation());
}

/* Three columns: keys, settings, languages. Languages need only a
   narrow strip, one word per row; keys need one of their own, because a
   caption next to a key reads only when both are on the same line. The
   widths live in menu--gear, this is the content alone. */
/* ── the settings ─────────────────────────────────────────────
   One sheet, three columns and a band: the state of the server with
   the way out and the interface on the left, the player in the middle,
   the storage on the right, the keys along the bottom. The server is
   asked how it is while the sheet is open. */
let serverState = 'checking';         // up | down | off | checking
let serverVersion = '';               // "1.1.0", as the package says; shown as v1.1
async function checkServer() {
  if (serverState === 'off' || serverState === 'updating') return paintStatus();
  try { const p = await api('/api/ping'); serverState = 'up'; if (p.version) serverVersion = p.version; } catch (_) { serverState = 'down'; }
  paintStatus();
}
/* "v1.1.0", as the tag on GitHub reads */
const shortVersion = v => v ? 'v' + String(v) : '';

/* ── the update ────────────────────────────────────────────────
   One row: the version as a heading, a word about the state under it,
   and one button the width of the column that does the next thing:
     idle        —                          [Check for an update]
     checking    —                          [Checking…] (disabled)
     latest      "the latest"               [Check again]
     newer       "v1.1.0 is available"      [Update to v1.1.0]
     updating    the steps, one per line    (no button: nothing to press)
     restarting  "starting again…"          (no button)
     done        "updated to v1.1.0"        [Reload the page]
     failed      what went wrong            [Check again]
   The state outlives the sheet, which is rebuilt on every opening. */
const update = { phase: 'idle', latest: null, tag: null, why: '', steps: [] };
function paintUpdate() {
  const row = gearMenu.querySelector('.upd');
  if (!row) return;
  const head = row.querySelector('.upd__head'), note = row.querySelector('.upd__note'), log = row.querySelector('.upd__log'), btn = row.querySelector('.upd__btn');
  head.textContent = t('set.version', { v: shortVersion(serverVersion) || '…' });
  const v = shortVersion(update.latest);
  const show = (noteText, btnText, { disabled = false } = {}) => { note.textContent = noteText; btn.hidden = !btnText; btn.textContent = btnText || ''; btn.disabled = disabled; };
  log.replaceChildren();
  switch (update.phase) {
    case 'checking': show('', t('upd.checking'), { disabled: true }); break;
    case 'latest': show(t('upd.latest'), t('upd.again')); break;
    case 'newer': show(t('upd.available', { v }), t('upd.to', { v })); break;
    case 'npx': show(t('upd.npx', { v }), t('upd.again')); break;
    case 'updating': show(t('upd.updating', { v }), ''); for (const s of update.steps) { const d = document.createElement('div'); d.textContent = stepText(s); log.append(d); } break;
    case 'restarting': show(t('upd.waiting'), ''); break;
    case 'done': show(t('upd.done', { v }), t('upd.reload')); break;
    case 'failed': show(t('upd.failed', { why: update.why }), t('upd.again')); break;
    default: show('', t('upd.check'));
  }
}
async function updateClick() {
  if (update.phase === 'done') { location.reload(); return; }
  if (update.phase === 'newer') return startUpdate();
  if (update.phase === 'checking' || update.phase === 'updating' || update.phase === 'restarting') return;
  update.phase = 'checking'; paintUpdate();
  try {
    const r = await post('/api/update/check');
    update.latest = r.latest; update.tag = r.tag; update.kind = r.kind;
    update.phase = r.newer ? (r.kind === 'npx' ? 'npx' : 'newer') : 'latest';
  } catch (e) { update.phase = 'failed'; update.why = e.message; }
  paintUpdate();
}
async function startUpdate() {
  update.phase = 'updating'; update.steps = []; serverState = 'updating'; paintStatus(); paintUpdate();
  let token;
  try { token = (await post('/api/update/start?tag=' + encodeURIComponent(update.tag || ''))).token; }
  catch (e) { update.phase = 'failed'; update.why = e.message; paintUpdate(); return; }
  const es = new EventSource('/api/update/live?token=' + encodeURIComponent(token));
  es.addEventListener('step', e => { try { update.steps.push(JSON.parse(e.data)); } catch (_) {} paintUpdate(); });
  es.addEventListener('fail', e => { es.close(); let d = {}; try { d = JSON.parse(e.data); } catch (_) {} update.phase = 'failed'; update.why = d.key ? t('upd.err.' + d.key) : d.error || 'update failed'; serverState = 'up'; paintStatus(); paintUpdate(); });
  es.addEventListener('done', () => { es.close(); update.phase = 'restarting'; paintUpdate(); awaitRestart(); });
  es.onerror = () => { if (update.phase === 'updating') { es.close(); update.phase = 'failed'; update.why = t('set.cacheFail'); serverState = 'up'; paintStatus(); paintUpdate(); } };
}
/* Lapka is gone and comes back: the new one answers with the new version */
function awaitRestart() {
  const began = Date.now();
  const tick = async () => {
    try {
      const p = await api('/api/ping');
      if (p.version && (!update.latest || p.version === update.latest)) { serverVersion = p.version; serverState = 'up'; update.phase = 'done'; paintStatus(); paintUpdate(); return; }
    } catch (_) { /* still away */ }
    if (Date.now() - began > 180000) { update.phase = 'failed'; update.why = t('upd.lost'); serverState = 'down'; paintStatus(); paintUpdate(); return; }
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1500);
}
function paintStatus() {
  const row = gearMenu.querySelector('.status');
  if (!row) return;
  row.querySelector('.status__dot').className = 'status__dot is-' + serverState;
  row.querySelector('.status__label').textContent = t('set.status.' + serverState);
}
setInterval(() => { if (gearMenu.classList.contains('open')) checkServer(); }, 4000);

function buildGearMenu() {
  gearMenu.replaceChildren();

  /* ─ left: how Lapka is, the way out, the interface ─ */
  const left = document.createElement('div');
  left.className = 'menu__col menu__col--left';
  const status = document.createElement('div');
  status.className = 'menu__row status';
  status.innerHTML = '<div class="status__head"><i class="status__dot"></i><span class="menu__rowlabel status__label"></span></div>';
  const quitNote = document.createElement('div');
  quitNote.className = 'cache__note quit__note';
  quitNote.textContent = t('set.quitNote');
  const quitGuide = document.createElement('a');
  quitGuide.className = 'quit__guide';
  quitGuide.target = '_blank'; quitGuide.rel = 'noopener';
  quitGuide.href = lang === 'ru' ? 'https://github.com/MythHand/Lapka/blob/main/docs/INSTALL.ru.md#как-выключить' : 'https://github.com/MythHand/Lapka/blob/main/docs/INSTALL.md#how-to-stop';
  quitGuide.textContent = t('set.quitGuide');
  quitGuide.onclick = ev => ev.stopPropagation();
  const quit = document.createElement('button');
  quit.className = 'cache__clear quit';
  quit.textContent = t('set.quit');
  quit.onclick = async ev => {
    ev.stopPropagation();
    if (!quit.classList.contains('is-armed')) {
      quit.classList.add('is-armed'); quit.textContent = t('set.quitSure');
      setTimeout(() => { quit.classList.remove('is-armed'); quit.textContent = t('set.quit'); }, 4000);
      return;
    }
    /* the place where watching is goes first, at once: the server is about to end */
    if (loaded && video.currentTime) { video.pause(); markPos(loaded, video.currentTime, 'now'); await sleep(150); }
    try { await post('/api/quit'); } catch (_) {}
    serverState = 'off';
    closeMenus();
    video.pause();
    showNotice(t('notice.quit'), { mid: true });
  };
  status.append(quitNote, quitGuide, quit);
  left.append(status);
  paintStatus(); checkServer();

  /* the version, and the way to the next one: asked for on the button, never on its own */
  const upd = document.createElement('div');
  upd.className = 'menu__row upd';
  upd.innerHTML = '<span class="menu__rowlabel upd__head"></span><div class="cache__note upd__note"></div><div class="upd__log"></div><button class="cache__clear upd__btn"></button>';
  upd.querySelector('.upd__btn').onclick = ev => { ev.stopPropagation(); updateClick(); };
  upd.addEventListener('click', ev => ev.stopPropagation());
  left.append(upd);

  /* ─ second: the interface ─ */
  const ui = document.createElement('div');
  ui.className = 'menu__col menu__col--ui';
  menuTitle(ui, t('set.iface'));
  const iface = SETTINGS.filter(r => r.key === 'queueMode' || r.key === 'font');
  const settingRow = (col, row) => segRow(col, t(row.label), state.set[row.key],
    row.opts.map(([val, key]) => [val, t(key)]), val => {
      state.set[row.key] = val;
      try { localStorage.setItem('lapka.' + row.key, val); } catch (_) {}
      applySettings();
    });
  settingRow(ui, iface.find(r => r.key === 'queueMode'));
  /* the language: chips as wide as their names */
  const langRow = document.createElement('div');
  langRow.className = 'menu__row';
  const langLab = document.createElement('span');
  langLab.className = 'menu__rowlabel';
  langLab.textContent = t('set.lang');
  const chips = document.createElement('div');
  chips.className = 'langs';
  for (const [code, name] of LANG_LIST) {
    const b = document.createElement('button');
    b.className = 'lang' + (code === lang ? ' sel' : '');
    b.textContent = name;
    b.onclick = ev => {
      ev.stopPropagation();
      setLang(code);                    // repaints everything and closes the menus
      buildGearMenu();
      gearMenu.classList.add('open');   // but the settings stay open
    };
    chips.append(b);
  }
  langRow.append(langLab, chips);
  ui.append(langRow);
  settingRow(ui, iface.find(r => r.key === 'font'));

  /* ─ middle: the player ─ */
  const player = document.createElement('div');
  player.className = 'menu__col menu__col--player';
  menuTitle(player, t('set.head'));
  for (const row of SETTINGS) if (!iface.includes(row)) settingRow(player, row);
  /* the quality a group is saved in: the best there is, the one playing, or the nearest to a named one */
  segRow(player, t('set.saveQuality'), saveQualityWanted(),
         [['max', t('quality.max')], ['played', t('quality.played')], null, ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p'], ['360p', '360p']], val => {
    state.remote.settings = { ...(state.remote.settings || {}), saveQuality: val };
    post('/api/state/setting?k=saveQuality&v=' + val).catch(() => {});
  });
  switchRow(player, t('set.autoResume'), (state.remote.settings?.autoResume || 'on') !== 'off', on => {
    state.remote.settings = { ...(state.remote.settings || {}), autoResume: on ? 'on' : 'off' };
    post('/api/state/setting?k=autoResume&v=' + (on ? 'on' : 'off')).then(() => { if (on) post('/api/saves/resume').catch(() => {}); }).catch(() => {});
  });

  /* ─ right: the storage ─ */
  const place = document.createElement('div');
  place.className = 'menu__col menu__col--place';
  menuTitle(place, t('set.place'));
  homeRow(place);
  cacheRow(place);

  /* ─ the band: the keys, in columns across the whole width ─ */
  const keys = document.createElement('div');
  keys.className = 'menu__band menu__band--keys';
  menuTitle(keys, t('keys.head'));
  const grid = document.createElement('div');
  grid.className = 'keys__grid';
  for (const group of KEYS_UI) {
    const col = document.createElement('div');
    col.className = 'keys__col';
    for (const [caps, key] of group) {
      const row = document.createElement('div');
      row.className = 'keys__row';
      const box = document.createElement('span');
      box.className = 'keys__caps';
      for (const c of caps) {
        const k = document.createElement('kbd');
        k.textContent = c;
        box.append(k);
      }
      const what = document.createElement('span');
      what.className = 'keys__what';
      what.textContent = t(key);
      row.append(box, what);
      col.append(row);
    }
    grid.append(col);
  }
  keys.append(grid);

  gearMenu.append(left, ui, player, place, keys);
  paintStatus(); paintUpdate();      // the rows are in the sheet now: painted from what is known
}

btnGear.onclick = e => {
  e.stopPropagation();
  buildGearMenu();
  closeMenus(gearMenu);
  const opening = !gearMenu.classList.contains('open');
  gearMenu.classList.toggle('open');
  if (opening) pressGearPaw();
};

btnSubs.onclick = e => {
  e.stopPropagation();
  buildSubsMenu();
  closeMenus(subsMenu);
  subsMenu.classList.toggle('open');
};

function closeMenus(except) {
  for (const m of MENUS) if (m && m !== except) m.classList.remove('open');
}
/* A choice in the track, subtitle, PiP mode or speed menu keeps the menu
   open, as the settings do: the tick moves to the item picked, in place,
   so a long list stays where it was scrolled. The menu closes the usual
   ways: its button, another menu, a click outside it or on the picture,
   Esc. */
function markPicked(b) {
  for (const x of b.parentNode.querySelectorAll('.menu__item')) x.classList.toggle('sel', x === b);
}
function anyMenuOpen() {
  return MENUS.some(m => m && m.classList.contains('open'));
}
btnAudio.onclick = e => {
  e.stopPropagation();
  buildAudioMenu();
  closeMenus(audioMenu);
  audioMenu.classList.toggle('open');
};
document.addEventListener('click', e => {
  if (!e.target.closest('.menuwrap')) closeMenus();
  if (!e.target.closest('#deckPack')) closePack();
});

/* ── the notice over the picture ───────────────────────────── */
/* a line over the picture: what went wrong, and one thing to do about it */
let noticeDo = null, noticeUndo = null, noticeKind = null;
/* busy: the player is working (opening, waiting, trying another
   source); the line stands in the middle of the picture with a
   spinner, so a pause never reads as a dead player */
/* mid: the line stands in the middle of the picture, where a question is
   seen at once; a busy line always stands there */
function showNotice(text, { action = null, onAction = null, onClose = null, kind = null, busy = false, mid = false } = {}) {
  noticeText.textContent = text;
  const btn = $('#noticeAction');
  btn.hidden = !action;
  btn.textContent = action || '';
  noticeDo = onAction; noticeUndo = onClose; noticeKind = kind;
  notice.classList.toggle('notice--busy', busy);
  notice.classList.toggle('notice--mid', busy || mid);
  notice.classList.add('show');
}
function hideNotice(kind = null) {
  if (kind && noticeKind !== kind) return;   // another line is up: leave it
  notice.classList.remove('show', 'notice--busy', 'notice--mid'); noticeDo = null; noticeUndo = null; noticeKind = null;
}
/* the busy lines: what is being opened, a source that is slow to answer */
let loadingT = 0, stallT = 0;
function sayLoading(it) {
  clearTimeout(loadingT);
  loadingT = setTimeout(() => { if (it === cur() && !it.switching && video.paused === false && video.readyState < 3) showNotice(t('notice.loading', { name: it.name, player: (it.source && it.source.player) || '' }), { kind: 'busy', busy: true }); }, 1500);
}
function sayStalled(it) {
  clearTimeout(stallT);
  stallT = setTimeout(() => { if (it === cur() && !it.switching && video.readyState < 3) showNotice(t('notice.slow', { player: (it.source && it.source.player) || '' }), { kind: 'busy', busy: true }); }, 2500);
}
function busyOver() { clearTimeout(loadingT); clearTimeout(stallT); hideNotice('busy'); }
$('#noticeClose').onclick = () => { const f = noticeUndo; hideNotice(); if (f) f(); };
$('#noticeAction').onclick = () => { const f = noticeDo; hideNotice(); if (f) f(); };

/* ═══════════════ queue ═══════════════ */
function render() {
  saveSession();          // the list only changes through render, so catch it here
  queueFiles.textContent = t('queue.count', { n: state.list.length });
  const grid = state.view === 'grid';
  queueList.classList.toggle('queue__list--grid', grid && state.list.length > 0);
  queueEl.classList.toggle('queue--empty', !state.list.length);
  applyQueueWidth();
  btnLocate.hidden = !cur() || !state.list.length;
  syncQueueClose();

  if (!state.list.length) {
    queueList.replaceChildren(aboutBlock());
    stage.classList.add('is-empty');
    if (booted) emptyEl.classList.remove('hide');
    syncStatus();
    return;
  }
  stage.classList.remove('is-empty');

  const frag = document.createDocumentFragment();
  const grouped = state.seasons.length > 1;
  queueEl.classList.toggle('queue--grouped', grouped);
  let group = null;
  for (const it of state.list) {
    if (grouped && it.group !== group) {
      group = it.group;
      const s = state.seasons.find(x => x.series.id === it.group);
      if (s) frag.append(groupRow(s));
    }
    frag.append(grid ? tileFor(it) : rowFor(it));
  }
  queueList.replaceChildren(frag);
  paintMeta();
  paintSaved();
  const active = queueList.querySelector('.item.active, .tile.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
  watchThumbs();
}

/* A new current file changes the state of two cards and nothing else.
   render() builds the list anew, and a card built already active has
   nothing to pass from, so the change of state never showed. Here the
   cards stay and only their classes change, which the transitions in
   styles.css play out. A list that no longer matches the queue is built
   anew as before. */
/* the line that opens a part of the franchise in the list: its
   number in the order, its title, its year, and what it is if it is
   not a plain season */
function groupRow(season) {
  const { series, ordinal } = season;
  const li = document.createElement('li');
  li.className = 'queue__group';
  li.dataset.group = series.id;
  li.innerHTML = '<span class="queue__group-label"></span><span class="queue__group-title"></span><span class="queue__group-year"></span><span class="queue__group-kind"></span>' +
    `<span class="queue__group-save">${phSvg(PH.download)}<span class="queue__group-count"></span></span>`;
  li.querySelector('.queue__group-label').append(Object.assign(document.createElement('span'), { className: 'n', textContent: String(ordinal) }));
  li.querySelector('.queue__group-title').textContent = series.title;
  li.querySelector('.queue__group-year').textContent = series.year || '';
  li.querySelector('.queue__group-kind').textContent = kindLabel(series);
  li.title = series.title;
  return li;
}

function paintActive() {
  const kids = [...queueList.children].filter(li => !li.classList.contains('queue__group'));
  if (kids.length !== state.list.length || kids.some((li, i) => li.dataset.id !== String(state.list[i].id))) return render();
  saveSession();
  btnLocate.hidden = !cur();
  for (const li of kids) {
    const it = byId(li.dataset.id);
    li.classList.toggle('active', it === cur());
    li.classList.toggle('playing', it === cur() && !video.paused);
    li.classList.toggle('bad', !!it.err);
  }
}

/* The scroll to a file, read from --glide in styles.css so it is tuned
   there with the rest of the motion. scrollTo with smooth behaviour
   follows the browser's own curve and cannot take another. */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t;
  const Y = t => ((ay * t + by) * t + cy) * t;
  return x => {
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) {
      const d = X(t) - x;
      if (Math.abs(d) < 1e-5) break;
      if (d > 0) hi = t; else lo = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}
const SLIDE = (() => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--glide');
  const m = /cubic-bezier\(([^)]+)\)/.exec(v);
  return { ms: parseFloat(v) || 620, ease: cubicBezier(...(m ? m[1] : '.32,.72,0,1').split(',').map(Number)) };
})();

let glideRaf = 0;
function glideTo(top) {
  cancelAnimationFrame(glideRaf);
  const from = queueList.scrollTop;
  const to = Math.max(0, Math.min(queueList.scrollHeight - queueList.clientHeight, top));
  if (Math.abs(to - from) < 1) return;
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / SLIDE.ms);
    queueList.scrollTop = from + (to - from) * SLIDE.ease(k);
    if (k < 1) glideRaf = requestAnimationFrame(step);
  };
  glideRaf = requestAnimationFrame(step);
}
/* the wheel or a hand on the list takes over from a glide in progress */
queueList.addEventListener('wheel', () => cancelAnimationFrame(glideRaf), { passive: true });
queueList.addEventListener('pointerdown', () => cancelAnimationFrame(glideRaf));

/* In a long season the file playing is easy to lose while scrolling.
   This brings it back into view, not to the very top but at 23 % of the
   list's height, so the files before it are still seen. The same glide
   follows a file that starts, when the setting asks for it. */
function revealCurrent() {
  const li = queueList.querySelector('.item.active, .tile.active');
  if (!li) return;
  const box = queueList.getBoundingClientRect(), r = li.getBoundingClientRect();
  glideTo(queueList.scrollTop + r.top - box.top - box.height * 0.23);
}
btnLocate.onclick = revealCurrent;

/* the queue's width. With files in it, the panel is as wide as the screen
   allows or one step narrower, by the last choice made, and the choice is
   kept. With nothing open, the panel shows the description and is always
   wide. The button shows the state and swaps its glyph. */
const btnQueueWidth = $('#btnQueueWidth');
function applyQueueWidth() {
  const chosen = strFromStore('lapka.queueNarrow', '0') === '1';
  const narrow = chosen && state.list.length > 0;
  workspace.classList.toggle('queue-narrow', narrow);
  if (btnQueueWidth) btnQueueWidth.title = t(chosen ? 'queue.widen' : 'queue.narrow');
}
if (btnQueueWidth) btnQueueWidth.onclick = () => {
  saveStr('lapka.queueNarrow', strFromStore('lapka.queueNarrow', '0') === '1' ? '0' : '1');
  applyQueueWidth();
  setTimeout(() => window.dispatchEvent(new Event('resize')), 450);   // the deck and the menus refit once the slide is over
};

/* ── the project description in an empty queue ────────────────
   The order here carries meaning and is not accidental. At the top,
   what the person needs right now: the queue is empty, drop files in.
   Then, past the divider, what the player is: a heading, prose with a
   link to the source at the end of the first paragraph, then the
   feature list under a heading of its own. The groups of the list run
   by importance to the goal: first what the whole thing was started
   for, then what it cannot work without, and only at the end the
   trimmings. */
const SITES_OK = ['aniliberty.top', 'old.yummyani.me', 'jut-su.net', 'animego.me', 'anidubonline.ru', 'gogoanime.by', 'jkanime.net', 'newdeaf.co', 'yummyanime.tv', 'ani-media.online', 'domanime.ru', 'lordserials.fan'];
const SITES_PART = [{ site: 'animeflv.or.at', note: 'about.partOne' }];
const SITES_SHUT = ['aniwaves.ru', 'aniwatch.co.at'];
/* The left side while nothing is open: the seal, the state as a
   terminal would say it, what Lapka is in two paragraphs, and the
   doors tried so far in three rows. The system speaks in the
   monospace, the description in the text face. */
function aboutBlock() {
  const li = document.createElement('li');
  li.className = 'queue__about';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const mark = el('div', 'mark mark--left'); mark.setAttribute('aria-hidden', 'true');
  mark.append(el('pre', 'paw mono-art', PAW_FRAMES[0]), el('pre', 'banner mono-art', BANNER));

  const state = el('div', 'about__state about__mono');
  state.append(el('p', 'about__line about__line--now', '› ' + t('about.state')), el('p', 'about__line about__line--hint', '  ' + t('about.hint')));

  /* what Lapka is: a lead line, then how it works in three steps,
     what it does and what it stands for as label + line, all in the
     monospace, the doors last */
  const desc = el('div', 'about__desc');
  desc.append(el('p', 'about__lead', t('about.lead')), el('p', 'about__tagline', t('about.tagline')));

  /* the sections are text, set the way text is: a heading, then
     rows of a bold label and a line, or numbered steps */
  const section = (headKey, rows, numbered = false) => {
    const box = el('section', 'about__section');
    box.append(el('h3', 'about__h', t(headKey)));
    if (numbered) {
      const ol = el('ol', 'about__steps');
      rows.forEach(([, v]) => ol.append(el('li', null, t(v))));
      box.append(ol);
    } else {
      const dl = el('dl', 'about__rows');
      rows.forEach(([k, v]) => { dl.append(el('dt', null, t(k)), el('dd', null, t(v))); });
      box.append(dl);
    }
    return box;
  };
  const how = section('about.how', [['', 'about.step1'], ['', 'about.step2'], ['', 'about.step3']], true);
  const can = section('about.can', ['queue', 'dubs', 'quality', 'subs', 'skip', 'resume', 'watched', 'save', 'finish', 'folder', 'sources', 'log'].map(k => [`about.f.${k}.k`, `about.f.${k}`]));
  const rules = section('about.rules', ['local', 'fair', 'general', 'doors', 'open'].map(k => [`about.p.${k}.k`, `about.p.${k}`]));

  const doors = el('section', 'about__section about__doors');
  doors.append(el('h3', 'about__h', t('about.doors')));
  const dl = el('dl', 'about__rows');
  const row = (key, sites) => {
    if (!sites.length) return;
    dl.append(el('dt', null, t(key)));
    const dd = el('dd');
    /* a site and the dot after it never part; the lines break at the
       spaces between the units */
    sites.forEach((x, i) => {
      const unit = el('span', 'about__unit');
      if (typeof x === 'string') unit.append(el('span', 'about__site', x));
      else { unit.append(el('span', 'about__site', x.site)); unit.append(el('span', 'about__note', ' — ' + t(x.note))); }
      if (i < sites.length - 1) unit.append(el('span', 'about__sep', ' ·'));
      dd.append(unit);
      if (i < sites.length - 1) dd.append(document.createTextNode(' '));
    });
    dl.append(dd);
  };
  row('about.doorOk', SITES_OK); row('about.doorPart', SITES_PART); row('about.doorShut', SITES_SHUT);
  doors.append(dl);

  const rule = () => { const r = el('p', 'about__rule about__mono', '─'.repeat(80)); r.setAttribute('aria-hidden', 'true'); return r; };
  li.append(mark, state, rule(), desc, how, can, rules, rule(), doors);
  return li;
}

/* shared by both views: a row and a tile are the same file */
function markup(it, li) {
  li.dataset.id = it.id;
  li.draggable = state.set.drag === 'on';
  if (it === cur()) li.classList.add('active');
  if (it.err) li.classList.add('bad');
  if (it === cur() && !video.paused) li.classList.add('playing');
  return li;
}

function rowFor(it) {
  const li = markup(it, document.createElement('li'));
  li.classList.add('item');
  li.innerHTML =
    `<span class="item__grip">${phSvg(PH.grip)}</span>` +
    `<span class="item__thumb"><span class="item__eq"><i></i><i></i><i></i></span><span class="pos"><i></i></span></span>` +
    `<span class="item__body"><span class="item__name"></span><span class="item__meta"></span></span>` +
    `<span class="item__save">${phSvg(PH.download)}</span>` +
    `<span class="item__x" title="${t('queue.remove')}">${phSvg(PH.x)}</span>`;
  li.querySelector('.item__name').textContent = it.name;
  if (it.thumb) putThumb(li, it.thumb);
  paintPos(li, it);
  paintShape(li, it);
  return li;
}

/* A tile shows the frame alone; the name goes into the tooltip and into
   the background in case there is no frame at all (an audio file, a
   broken container). */
function tileFor(it) {
  const li = markup(it, document.createElement('li'));
  li.classList.add('tile');
  li.title = it.name;
  li.innerHTML = '<span class="tile__name"></span><span class="tile__eq"><i></i><i></i><i></i></span><span class="pos"><i></i></span>';
  li.querySelector('.tile__name').textContent = it.name;
  if (it.thumb) putThumb(li, it.thumb);
  paintPos(li, it);
  paintShape(li, it);
  return li;
}

function putThumb(li, src) {
  /* The image is loaded aside first and only then set as background:
     otherwise the tile flashes as an empty rectangle over the file
     name. A tile is the frame itself; a row keeps it in a box of its own. */
  const box = li.querySelector('.item__thumb') || li;
  const img = new Image();
  img.decoding = 'async';
  img.addEventListener('load', () => {
    if (!li.isConnected) return;
    box.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
    box.classList.add('has-thumb');
    const it = byId(li.dataset.id);
    if (it && !it.aspect && img.naturalHeight) { it.aspect = img.naturalWidth / img.naturalHeight; paintShape(li, it); }
  }, { once: true });
  img.src = src;
}

/* ── frames ───────────────────────────────────────────────────
   A stream has no file to take a frame from, so the series cover
   stands in for every row and tile until the episode has played. */
function watchThumbs() {
  for (const li of queueList.children) askThumb(li);
}
function askThumb(li) {
  const it = byId(li.dataset.id);
  if (!it || it.thumb) return;
  const season = seasonOf(it);
  const cover = (season && season.series.cover) || (state.series && state.series.cover);
  if (!cover) return;
  it.thumb = cover;
  putThumb(li, it.thumb);
}

function paintMeta() {
  for (const li of queueList.children) {
    const it = byId(li.dataset.id);
    if (!it) continue;
    paintPos(li, it); paintShape(li, it);
    const box = li.querySelector('.item__meta');
    if (!box) continue;
    const fixed = `<span class="item__m item__m--dur">${it.dur ? fmt(it.dur) : '—'}</span>`;
    const rest = [];
    if (it.err) rest.push(`<b title="${escapeHtml(it.why || '')}">${t('queue.bad')}</b>`);
    /* one dub is named; several are counted */
    if (it.dubs && it.dubs.length === 1) rest.push(escapeHtml(it.dubs[0].name));
    else if (it.dubs && it.dubs.length) rest.push(t('queue.dubs', { n: it.dubs.length }));
    if (it.stream) rest.push(`<span class="route">${it.stream.kind.toUpperCase()}${it.stream.quality ? ' ' + it.stream.quality : ''}</span>`);
    if (it.source) rest.push(`<span class="route route--off">${it.source.player}</span>`);
    box.innerHTML = fixed + rest.map(b => `<span>${b}</span>`).join('');
  }
}

queueList.addEventListener('click', e => {
  const li = e.target.closest('.item, .tile');
  if (!li) return;
  const it = byId(li.dataset.id);
  if (!it) return;
  if (e.target.closest('.item__x')) return removeItem(it);
  if (e.target.closest('.item__save')) return saveMarkClick(it, e.target.closest('.item__save'));
  playItem(it, true, false);
});

/* The qualities an episode can be saved in, across the live sources
   of its dub; with one to choose from, a small menu by the button. */
const saveQualities = it => {
  const out = new Map();
  for (const s of [...(it.streams || [])].sort((a, b) => streamRank(b) - streamRank(a))) {
    const q = s.quality || (s.kind === 'hls' ? t('quality.auto') : null);
    if (!q || out.has(q)) continue;
    out.set(q, s);
  }
  return [...out.entries()].map(([label, stream]) => ({ label, stream }));
};
const saveMenu = $('#saveMenu');
/* The mark of a row, clicked. What it does follows the row's state: a
   save running is paused, one paused or failed is taken up again with the
   quality it had, and only a fresh start asks for the quality when there
   is more than one to choose from. */
function saveMarkClick(it, btn) {
  const sv = it.save;
  if (isSaved(it)) return;
  if (isSaving(it)) return pauseItems([it]);
  if (isQueued(it)) return promoteSave(it);
  if (sv && (sv.st === 'paused' || sv.st === 'failed')) return enqueueSaves([it]);
  return offerSave(it, btn);
}
/* The save of one row: which dub, in which quality. Built as the dub
   menu is: a row per dub, the qualities it can be saved in as tags on
   the right, four to a line, the dub playing first (first is the whole
   mark: the player shows it already), the rest in their order. Only a
   tag chooses: it names the dub and the quality both, and a row on its
   own would leave the quality unsaid. What each dub offers is asked of
   the server once per episode, levels of adaptive streams included; the
   dub playing shows what this page already knows at once, a dub whose
   sources are not open yet shows a waiting tag, and the window is drawn
   again when the answer comes. No "auto": a file is saved in one
   quality, so an adaptive stream is offered as its levels, and one of
   unknown height by what it is.
   The window opens from a row's mark and closes on a click anywhere
   else, on Esc, or on a choice; the click that closes it does nothing
   else, as with the queue's popover. */
let saveInfo = null;   // { key, dubs }: what the server says the dubs of one row can be saved in
let saveMenuFor = null;   // what the window is open for: a row, or { scope, items, rep } for a part's pick
/* what the server says the dubs of a row can be saved in, asked once per
   episode: first what it knows, then with the sources opened; redraw is
   called on each answer while the window is still about this row */
function loadDubs(it, redraw) {
  const key = `${it.seriesId}/${it.number}`;
  if (saveInfo && saveInfo.key === key) return;
  saveInfo = { key, dubs: null };
  const ask = q => api(`/api/dubs?series=${it.seriesId}&episode=${it.number}${q}`)
    .then(d => { if (saveInfo && saveInfo.key === key) { saveInfo.dubs = d.dubs; if (!saveMenu.hidden) redraw(); } })
    .catch(() => {});
  ask(''); ask('&open=1');
}
const dubsKnown = it => saveInfo && saveInfo.key === `${it.seriesId}/${it.number}` ? saveInfo.dubs : null;
async function offerSave(it, btn) {
  if (!it.streams) { try { await resolveItem(it); } catch (e) { toast(t('toast.openFail', { name: it.name, why: e.message })); return; } }
  /* one dub, one stream of a known quality: nothing to choose */
  if ((it.dubs || []).length < 2 && it.streams.length === 1 && (it.streams[0].quality || it.streams[0].kind !== 'hls')) return enqueueSaves([it], it.streams[0]);
  saveMenuFor = it;
  saveMenu.anchor = btn.getBoundingClientRect();
  saveMenu.hidden = false;
  loadDubs(it, () => { if (saveMenuFor === it) buildSaveMenu(it); });
  buildSaveMenu(it);
}
function closeSaveMenu() { saveMenu.hidden = true; saveMenuFor = null; }
/* the qualities this page knows of the dub playing, before the server has said */
const tagsFromStreams = streams => {
  const out = new Map();
  for (const st of [...(streams || [])].sort((a, b) => streamRank(b) - streamRank(a))) {
    const label = st.quality || st.kind.toUpperCase();
    if (!out.has(label)) out.set(label, { id: st.id, quality: st.quality || null, kind: st.kind, player: st.player, level: false });
  }
  return [...out.values()];
};
const TAGS_PER_LINE = 4;
const tagLabel = q => q.quality || q.kind.toUpperCase();
/* one row of the window: the dub's name, a note under it if any, its tags four to a line; empty → a waiting or a dead tag */
function saveMenuRow(name, sub, qs, onTag, { waiting = true } = {}) {
  const row = document.createElement('div');
  row.className = 'menu__item menu__item--dub savemenu__row' + (qs.length ? '' : ' is-quiet');
  row.innerHTML = '<span class="menu__body"><span class="menu__main"></span><span class="menu__sub" hidden></span></span><span class="menu__tags"></span>';
  row.querySelector('.menu__main').textContent = name;
  if (sub) { const s = row.querySelector('.menu__sub'); s.textContent = sub; s.hidden = false; }
  const tags = row.querySelector('.menu__tags');
  let line = null;
  qs.forEach((q, i) => {
    if (i % TAGS_PER_LINE === 0) { line = document.createElement('span'); line.className = 'menu__tagline'; tags.append(line); }
    const tg = document.createElement('span');
    tg.className = 'qtag';
    tg.textContent = q.label || tagLabel(q);
    if (q.player) tg.title = [q.player, q.kind.toUpperCase()].filter(Boolean).join(' · ');
    tg.onclick = ev => { ev.stopPropagation(); onTag(q); };
    line.append(tg);
  });
  if (!qs.length) {
    const w = document.createElement('span');
    w.className = 'qtag qtag--wait';
    w.textContent = waiting ? '…' : t('audio.dead');
    tags.append(w);
  }
  return row;
}
/* centred under its button, kept inside the window only; the queue column is no frame for it */
function placeSaveMenu() {
  const r = saveMenu.anchor;
  if (!r) return;
  const w = saveMenu.offsetWidth, h = saveMenu.offsetHeight;
  saveMenu.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - h - 8)) + 'px';
  saveMenu.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
}
function buildSaveMenu(it) {
  saveMenu.replaceChildren();
  menuTitle(saveMenu, t('queue.saveAs'));
  const known = dubsKnown(it);
  const nowKey = it.dub ? it.dub.key : state.dubKey;
  const dubs = known || (it.dubs || []).map(d => ({ key: d.key, name: d.name, qualities: [], unopened: d.alive, alive: d.alive }));
  const rows = [...dubs].sort((a, b) => (b.key === nowKey) - (a.key === nowKey));
  for (const d of rows) {
    const qs = d.qualities && d.qualities.length ? d.qualities : d.key === nowKey ? tagsFromStreams(it.streams) : [];
    saveMenu.append(saveMenuRow(d.name, '', qs, q => { closeSaveMenu(); enqueueSaves([it], { id: q.id, quality: q.quality || null, level: q.level ? qualityNum(q.quality) : null, kind: q.kind, player: q.player }); }, { waiting: !!(d.unopened || !known) }));
  }
  placeSaveMenu();
}

/* ── the dub and the quality a part, or the whole queue, is saved in ──
   Shown in the popover as one line, "AniLibria · 1080p", and applied to
   its Download button. Until chosen it is the dub playing (else the one
   most rows have) in the quality the settings prefer. Chosen through
   the same window as a row's save, with one more thing per dub: how
   many rows of the part have it, when not all. Quality is size, not
   content: a row without the exact one gets the nearest. A dub is
   content: a row known to lack it is not put in line, the popover
   counts such rows, and their marks stay for a save of their own. A row
   whose dubs are not known yet (its page unread) goes in line and is
   settled when it is opened. The choice lives for the page. */
const groupPicks = new Map();   // '*' for the queue, else the part's id → { dubKey, dubName, quality }
const scopeKey = scope => scope === null ? '*' : scope;
const lacksDub = (it, key) => !!it.dubs && !it.dubs.some(d => d.key === key);   // known to have no such dub
/* every dub seen across the rows, with how many rows have it */
function dubCoverage(items) {
  const m = new Map();
  for (const it of items) for (const d of it.dubs || []) { const e = m.get(d.key) || { key: d.key, name: d.name, n: 0 }; e.n++; m.set(d.key, e); }
  return [...m.values()];
}
function groupPickOf(scope, items) {
  const own = groupPicks.get(scopeKey(scope));
  if (own) return own;
  const cov = dubCoverage(items);
  const playing = cur();
  const key = (playing && playing.dub && playing.dub.key) || state.dubKey;
  const d = cov.find(x => x.key === key) || [...cov].sort((a, b) => b.n - a.n)[0];
  return d ? { dubKey: d.key, dubName: d.name, quality: null } : null;
}
/* the quality of a pick in words: the label chosen, else the settings' rule */
const qualityWords = quality => quality || ({ max: t('pop.qBest'), played: t('pop.qPlayed') })[saveQualityWanted()] || saveQualityWanted();
/* the tag of a named quality, else the nearest by height, the taller on a tie */
function nearestTag(qs, label) {
  const exact = qs.find(q => tagLabel(q) === label);
  if (exact) return exact;
  const target = qualityNum(label), named = qs.filter(q => qualityNum(q.quality));
  if (!target || !named.length) return qs[0] || null;
  return [...named].sort((a, b) => Math.abs(qualityNum(a.quality) - target) - Math.abs(qualityNum(b.quality) - target) || qualityNum(b.quality) - qualityNum(a.quality))[0];
}
/* the tag the settings' rule picks: the best, the one played, or a named quality */
function tagByRule(it, qs) {
  const want = saveQualityWanted();
  if (want === 'max') return qs[0] || null;
  if (want === 'played') { const now = (it.stream && it.stream.quality) || (state.quality !== 'auto' ? state.quality : ''); return now ? nearestTag(qs, now) : qs[0] || null; }
  return nearestTag(qs, want);
}
/* the stream of a row for a pick: the dub named, in the quality named or the nearest; null when the row has no such dub */
async function streamForPick(it, pick) {
  const d = await api(`/api/dubs?series=${it.seriesId}&episode=${it.number}&open=1`);
  const dub = d.dubs.find(x => x.key === pick.dubKey);
  if (!dub || !dub.qualities.length) return null;
  const q = pick.quality ? nearestTag(dub.qualities, pick.quality) : tagByRule(it, dub.qualities);
  return q ? { id: q.id, quality: q.quality || null, level: q.level ? qualityNum(q.quality) : null } : null;
}
/* the window for a part's pick: the dubs across its rows, the tags of the row playing (else the first) */
function offerGroupPick(scope, anchor) {
  const items = popItems();
  const rep = items.find(it => it === cur()) || items[0];
  if (!rep) return;
  const ctx = { scope, items, rep };
  saveMenuFor = ctx;
  saveMenu.anchor = anchor.getBoundingClientRect();
  saveMenu.hidden = false;
  loadDubs(rep, () => { if (saveMenuFor === ctx) buildGroupMenu(ctx); });
  buildGroupMenu(ctx);
}
function buildGroupMenu({ scope, items, rep }) {
  saveMenu.replaceChildren();
  menuTitle(saveMenu, t('queue.saveAs'));
  const known = dubsKnown(rep);
  const nowKey = (rep.dub && rep.dub.key) || state.dubKey;
  const rows = dubCoverage(items).sort((a, b) => (b.key === nowKey) - (a.key === nowKey) || b.n - a.n || a.name.localeCompare(b.name));
  const choose = (d, q) => {
    groupPicks.set(scopeKey(scope), { dubKey: d.key, dubName: d.name, quality: q ? tagLabel(q) : null });
    closeSaveMenu(); paintSavePop();
  };
  for (const d of rows) {
    const info = known && known.find(x => x.key === d.key);
    /* the qualities the row playing has of this dub; a dub it lacks is offered by the settings' rule alone */
    let qs = info && info.qualities.length ? info.qualities : !known && d.key === nowKey ? tagsFromStreams(rep.streams) : [];
    let waiting = !known || !!(info && info.unopened);
    if (!qs.length && known && !info) { qs = [{ label: qualityWords(null), rule: true }]; waiting = false; }
    /* how many rows have the dub, said only when some are known to lack it; rows not yet read count as possible */
    const lacking = items.filter(it => lacksDub(it, d.key)).length;
    const sub = lacking ? t('pop.cover', { n: items.length - lacking, total: items.length }) : '';
    saveMenu.append(saveMenuRow(d.name, sub, qs, q => choose(d, q.rule ? null : q), { waiting }));
  }
  placeSaveMenu();
}
saveMenu.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', e => {
  if (saveMenu.hidden || e.target.closest('#saveMenu')) return;
  /* the click closes the window and does nothing else; the mark it opened from toggles it itself, and the popover keeps its own clicks */
  if (!e.target.closest('.item__save, #savePop')) { e.stopPropagation(); e.preventDefault(); }
  closeSaveMenu();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !saveMenu.hidden) closeSaveMenu(); });

/* the stream of a named quality, for taking a save up again the way it was started */
const streamOfQuality = (it, quality) => (quality && (saveQualities(it).find(o => o.label === quality) || {}).stream) || null;
/* What a group is saved in. 'max' is the best there is; 'played' is what
   the player has for the episode, or its own preference before it has
   anything; a named quality takes the nearest one offered, the higher
   on a tie. The old 'auto' meant the best. */
const saveQualityWanted = () => ({ auto: 'max' })[state.remote.settings?.saveQuality] || state.remote.settings?.saveQuality || 'max';
const streamToSave = it => {
  const want = saveQualityWanted();
  const opts = saveQualities(it);
  if (!opts.length) return it.stream;
  const target = want === 'max' ? 0
               : want === 'played' ? qualityNum((it.stream && it.stream.quality) || (state.quality !== 'auto' ? state.quality : ''))
               : qualityNum(want);
  if (!target) return opts[0].stream;
  const named = opts.filter(o => qualityNum(o.label));
  if (!named.length) return opts[0].stream;
  return named.sort((a, b) => Math.abs(qualityNum(a.label) - target) - Math.abs(qualityNum(b.label) - target) || qualityNum(b.label) - qualityNum(a.label))[0].stream;
};
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── the library, as the queue sees it ─────────────────────────
   What is saved is read from the folder, never remembered here: a
   file the user deleted is gone from the rows on the next look. */
const savedKey = it => `${it.seriesId}/${it.number}`;
const isSaved = it => state.saved.has(savedKey(it));
async function loadLibrary() {
  try {
    const lib = await api('/api/library');
    state.saved = new Map();
    for (const s of lib.series) for (const e of s.episodes) {
      const k = `${e.seriesId}/${e.episode}`;
      if (!state.saved.has(k)) state.saved.set(k, []);
      state.saved.get(k).push({ dub: e.dub, size: e.size, path: e.path });
    }
  } catch (_) { /* the server may be starting */ }
  paintSaved();
}

/* ═══════════════ saving: state, poll, painters, popover, run ═══════════════
   One state per row, in it.save:
     null                      nothing asked, or done (saved is read from the library)
     { st:'queued' }           waits its turn in a run over many rows
     { st:'opening' }          the episode is being opened for the stream to save
     { st:'saving', jobId }    the server assembles the file; done/total/phase from the job
     { st:'paused' }           held by hand, keeps done/total and the quality it had
     { st:'failed', error }    the server gave up; keeps done/total
   mine: this page runs the job and paints it every half second; a job the
   server runs by itself (taken up after a start) is read by the poll. */
const isSaving = it => !!(it.save && (it.save.st === 'saving' || it.save.st === 'opening'));
const isQueued = it => !!(it.save && it.save.st === 'queued');
const isPaused = it => !!(it.save && it.save.st === 'paused');
/* how far a save got, in its own units: sizes for a file fetched whole, a count for pieces */
const progressWords = sv => sv.unit === 'bytes' ? `${fmtSize(sv.done || 0)} / ${fmtSize(sv.total || 0)}` : `${sv.done || 0} / ${sv.total || 0}`;
const progressPct = sv => sv.phase === 'assemble' ? 100 : sv.total ? Math.round(sv.done / sv.total * 100) : 0;
const isFailed = it => !!(it.save && it.save.st === 'failed');
const jobQuality = job => (job && job.quality) || null;

/* the server's jobs and records, read now and then, laid on the rows this page is not running itself */
let savesT = null;
async function watchSaves() {
  clearTimeout(savesT);
  let d = null;
  try { d = await api('/api/saves'); } catch (_) { return; }
  let active = false, finished = false;
  for (const it of state.list) {
    if (saveQueue.includes(it) || (it.save && it.save.st === 'opening')) continue;   // still on this page: waiting to be opened, or being opened
    const key = `${it.seriesId}/${it.number}/${it.dub ? it.dub.key : state.dubKey}`;
    const job = d.active.find(j => j.seriesId === it.seriesId && j.episode === it.number);
    const rec = d.pending[key] || Object.entries(d.pending).find(([k]) => k.startsWith(`${it.seriesId}/${it.number}/`))?.[1];
    if (job) { it.save = { st: job.state === 'queued' ? 'queued' : 'saving', phase: job.phase, done: job.done, total: job.total, unit: job.unit, jobId: job.id, quality: jobQuality(job), pick: job.streamId ? { id: job.streamId, level: job.level || null } : null }; active = true; }
    else if (rec && rec.error) it.save = { st: 'failed', error: rec.error, done: rec.done || 0, total: rec.total || 0, unit: rec.unit, phase: rec.phase, quality: rec.quality || null };
    else if (rec && rec.paused) it.save = { st: 'paused', done: rec.done || 0, total: rec.total || 0, unit: rec.unit, phase: rec.phase, quality: rec.quality || null };
    else if (it.save) { if (it.save.jobId) finished = true; it.save = null; }   // its job is gone without a record: the file is in the library
  }
  if (finished) await loadLibrary(); else paintSaved();
  if (active || d.active.length) savesT = setTimeout(watchSaves, 700);
}

/* every row's mark, every part's count, the header's count, the popover */
function paintSaved() {
  for (const li of queueList.children) {
    if (li.classList.contains('queue__group')) { paintGroupSave(li); continue; }
    const it = byId(li.dataset.id);
    const btn = it && li.querySelector('.item__save');
    if (!btn) continue;
    paintSaveButton(btn, it);
  }
  const all = state.list.length, done = state.list.filter(isSaved).length;
  saveCount.textContent = all ? `${done}/${all}` : '';
  btnSaveAll.classList.toggle('is-done', all > 0 && done === all);
  btnSaveAll.classList.toggle('is-busy', state.list.some(isSaving));
  btnSaveAll.hidden = !all;
  paintSavePop();
}

/* The mark of one row. The ring is drawn once and then only moved:
   rebuilding it on every tick would take the tooltip down with it. A
   paused ring stands grey with the pause sign inside; a failed one keeps
   its ring in warning colour and says why. The text of the tooltip lives
   on the button, and the tooltip shown now follows it. */
const RING = 2 * Math.PI * 9;
function paintSaveButton(btn, it) {
  const saved = isSaved(it);
  if (saved && it.save && it.save.st !== 'queued') it.save = null;   // the file is in the library: the job's last word does not matter
  const sv = it.save;
  const saving = isSaving(it), paused = isPaused(it), failed = isFailed(it), queued = isQueued(it);
  btn.classList.toggle('is-saved', saved && !saving && !paused && !failed && !queued);
  btn.classList.toggle('is-saving', saving);
  btn.classList.toggle('is-paused', paused);
  btn.classList.toggle('is-failed', failed);
  btn.classList.toggle('is-queued', queued);
  let tip, sub = '';
  if (saving || paused || failed || queued) {
    const pct = progressPct(sv), p = pct / 100;
    let ring = btn.querySelector('.ring');
    if (!ring) {
      btn.innerHTML = `<svg class="ring" viewBox="0 0 24 24"><circle class="ring__track" cx="12" cy="12" r="9"/><circle class="ring__fill" cx="12" cy="12" r="9" style="stroke-dasharray:${RING.toFixed(2)}"/></svg><i class="ring__pause"></i>`;
      ring = btn.querySelector('.ring');
    }
    ring.classList.toggle('is-assembling', saving && sv.phase === 'assemble');
    ring.querySelector('.ring__fill').style.strokeDashoffset = (RING * (1 - p)).toFixed(2);
    const got = t('queue.got', { got: progressWords(sv), pct });
    if (failed) { tip = t('queue.saveFailed', { why: sv.error }); sub = (sv.total ? got + ' · ' : '') + t('queue.retryHint'); }
    else if (paused) { tip = t('queue.savePaused', { got }); sub = t('queue.resumeHint'); }
    else if (queued) { tip = t('queue.queued'); sub = t('queue.promoteHint'); }
    else if (sv.st === 'opening') { tip = t('queue.opening'); sub = t('queue.pauseHint'); }
    else if (sv.phase === 'assemble') { tip = t('queue.assembling'); sub = t('queue.pauseHint'); }
    else { tip = t('queue.saving', { got }); sub = t('queue.pauseHint'); }
    delete btn.dataset.icon;
  } else {
    const want = saved ? PH.check : PH.download;
    if (btn.dataset.icon !== (saved ? 'check' : 'download')) { btn.innerHTML = phSvg(want); btn.dataset.icon = saved ? 'check' : 'download'; }
    tip = saved ? t('queue.savedAs', { size: fmtSize(sizeOf(it)), dubs: (state.saved.get(savedKey(it)) || []).map(x => x.dub).join(', ') }) : t('queue.save');
  }
  btn.dataset.tip = tip; btn.dataset.tipSub = sub;
  if (tipFor === btn) paintTip(btn);
}

/* ── Lapka's own tooltip ───────────────────────────────────────
   The system's takes a second and dies whenever its element is
   redrawn. This one appears at once, sits by the pointer, and is
   repainted with its element while it is up. */
let tipFor = null;
function paintTip(el) {
  tipEl.textContent = el.dataset.tip || '';
  if (el.dataset.tipSub) { const s = document.createElement('div'); s.className = 'tip__sub'; s.textContent = el.dataset.tipSub; tipEl.append(s); }
  const r = el.getBoundingClientRect();
  tipEl.hidden = false;
  /* measured from the left edge: a fixed box shrinks to what is left of the window past its old position */
  tipEl.style.left = '0px'; tipEl.style.top = '0px';
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let left = r.left + r.width / 2 - w / 2, top = r.top - h - 8;
  if (top < 8) top = r.bottom + 8;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
}
document.addEventListener('pointerover', e => {
  const el = e.target.closest('[data-tip]');
  if (el === tipFor) return;
  tipFor = el;
  if (el) paintTip(el); else tipEl.hidden = true;
});
document.addEventListener('pointerdown', () => { tipFor = null; tipEl.hidden = true; });
queueList.addEventListener('scroll', () => { tipFor = null; tipEl.hidden = true; }, { passive: true });

function paintGroupSave(li) {
  const items = state.list.filter(it => it.group === li.dataset.group);
  const done = items.filter(isSaved).length;
  const el = li.querySelector('.queue__group-save');
  if (!el) return;
  el.querySelector('.queue__group-count').textContent = `${done}/${items.length}`;
  el.classList.toggle('is-done', items.length > 0 && done === items.length);
  el.classList.toggle('is-busy', items.some(isSaving));
  el.title = t('queue.saveGroup');
}

/* ── the popover ───────────────────────────────────────────────
   Over the header's button for the whole queue, over a group's mark for
   that part. Hovering previews it, a click pins it. It says what the part
   or the queue holds and what is happening to it, and carries the buttons
   that act on exactly that scope: start or take up everything in it that
   is not saved, or pause what is loading in it. It is built once when it
   opens and then painted in place: the nodes stay, so the button under the
   pointer is the same button a moment later. Under the anchor, on the
   body, so the queue panel cannot clip it. */
let popT = null;
const sizeOf = it => (state.saved.get(savedKey(it)) || []).reduce((a, b) => a + (b.size || 0), 0);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function popSection(head) { const s = el('div', 'savepop__sec'); s.append(el('div', 'savepop__head', head)); return s; }
function popRow(grid, k, v, small) {
  grid.append(el('span', 'savepop__k', k));
  const val = el('span', 'savepop__v', v);
  if (small) { val.append(' '); val.append(el('small', '', small)); }
  grid.append(val);
}
let popScope = null, popAnchor = null, popPinned = false, pop = null;
/* under its button: a part's popover centred on the part's button, the
   queue's flush with the left of its own; both kept inside the window */
function placeSavePop() {
  if (savePop.parentNode !== document.body) document.body.append(savePop);
  const anchor = popAnchor || btnSaveAll;
  const r = anchor.getBoundingClientRect(), w = savePop.offsetWidth, h = savePop.offsetHeight;
  const left = popAnchor ? r.left + r.width / 2 - w / 2 : r.left;
  savePop.style.top = Math.min(r.bottom + 8, window.innerHeight - h - 12) + 'px';
  savePop.style.left = Math.max(12, Math.min(left, window.innerWidth - w - 12)) + 'px';
}
const popItems = () => popScope === null ? state.list : state.list.filter(it => it.group === popScope);

function buildSavePop() {
  const season = popScope === null ? null : state.seasons.find(x => x.series.id === popScope);
  const q = popSection(popScope === null ? t('pop.queue') : (season ? `${season.ordinal} · ${season.series.title}` : t('pop.part')));
  const bar = el('div', 'savepop__bar'), fill = el('i'); bar.append(fill); q.append(bar);
  const g = el('div', 'savepop__grid');
  const row = key => { const k = el('span', 'savepop__k', t(key)), v = el('span', 'savepop__v'); g.append(k, v); return { k, v }; };
  const saved = row('pop.saved'), now = row('pop.now'), queued = row('pop.queued'), paused = row('pop.paused'), failed = row('pop.failed'), rest = row('pop.rest'), dur = row('pop.duration');
  /* what the Download button saves in: the line opens the window that chooses it */
  const pickRow = row('pop.pick'); pickRow.v.className = 'savepop__v savepop__pick';
  pickRow.v.onclick = ev => { ev.stopPropagation(); if (!popPinned) pinSavePop(popScope, popAnchor); offerGroupPick(popScope, pickRow.v); };
  const without = row('pop.without');
  q.append(g);
  const acts = el('div', 'savepop__acts');
  const go = el('button', 'btn btn--solid'), pause = el('button', 'btn');
  go.onclick = ev => { ev.stopPropagation(); const items = popItems(), pick = groupPickOf(popScope, items); enqueueSaves(pick ? items.filter(it => !lacksDub(it, pick.dubKey)) : items, null, { pick }); };
  pause.onclick = ev => { ev.stopPropagation(); pauseItems(popItems(), popScope === null); };
  acts.append(go, pause); q.append(acts);
  /* the destructive pair asks twice: the first click arms the button, the second within a few seconds acts */
  const acts2 = el('div', 'savepop__acts savepop__acts--quiet');
  const cancel = el('button', 'btn btn--quiet'), del = el('button', 'btn btn--quiet');
  const armed = (b, run) => ev => {
    ev.stopPropagation();
    if (b.classList.contains('is-armed')) { b.classList.remove('is-armed'); run(); return; }
    b.classList.add('is-armed'); paintSavePop();
    clearTimeout(b._arm); b._arm = setTimeout(() => { b.classList.remove('is-armed'); paintSavePop(); }, 4000);
  };
  cancel.onclick = armed(cancel, () => cancelSaves(popItems()));
  del.onclick = armed(del, () => deleteSaved(popItems()));
  acts2.append(cancel, del); q.append(acts2);
  const frag = document.createDocumentFragment(); frag.append(q);
  const parts = [];
  if (popScope === null && state.seasons.length > 1) {
    const p = popSection(t('pop.parts'));
    const grid = el('div', 'savepop__parts');
    for (const s of state.seasons) {
      const c = el('span', 'c'), sz = el('span', 's');
      grid.append(el('span', 'n', String(s.ordinal)), el('span', 't', s.series.title), c, sz);
      parts.push({ id: s.series.id, c, sz });
    }
    p.append(grid); frag.append(p);
  }
  const lib = popScope === null ? popSection(t('pop.library')) : null;
  if (lib) { lib.hidden = true; frag.append(lib); }
  savePop.replaceChildren(frag);
  pop = { refs: { fill, saved, now, queued, paused, failed, rest, dur, pickRow, without, go, pause, cancel, del, parts, lib } };
}

/* the words and the buttons, from the queue as it is now */
function paintSavePop() {
  if (savePop.hidden || !pop) return;
  const r = pop.refs, items = popItems();
  const saved = items.filter(isSaved), loading = items.filter(isSaving), queued = items.filter(isQueued), paused = items.filter(isPaused), failed = items.filter(isFailed);
  const left = items.filter(it => !isSaved(it));
  const savedBytes = saved.reduce((a, it) => a + sizeOf(it), 0);
  const known = items.filter(it => it.dur), dur = known.reduce((a, it) => a + it.dur, 0);
  /* what the rest would take, judged by what is saved already: by the
     minute where an episode's length is known, by the episode where not */
  const savedDur = saved.reduce((a, it) => a + (it.dur || 0), 0);
  const perSec = savedBytes && savedDur ? savedBytes / savedDur : 0;
  const perEp = saved.length ? savedBytes / saved.length : 0;
  const estimate = left.reduce((a, it) => a + (it.dur && perSec ? it.dur * perSec : perEp), 0);
  const put = (row, main, note, show = true) => {
    row.k.hidden = row.v.hidden = !show;
    if (!show) return;
    row.v.textContent = main;
    if (note) { const sm = document.createElement('small'); sm.textContent = note; row.v.append(' ', sm); }
  };
  r.fill.style.width = (items.length ? saved.length / items.length * 100 : 0).toFixed(1) + '%';
  put(r.saved, `${saved.length} / ${items.length}`, savedBytes ? fmtSize(savedBytes) : '');
  const cur1 = loading[0];
  put(r.now, cur1 ? cur1.name : '', cur1 && cur1.save.st === 'saving' ? (cur1.save.total ? `${progressWords(cur1.save)} · ${progressPct(cur1.save)}%` : t('queue.assembling')) : (cur1 ? t('queue.opening') : ''), loading.length > 0);
  put(r.queued, String(queued.length), '', queued.length > 0);
  put(r.paused, String(paused.length), '', paused.length > 0);
  put(r.failed, String(failed.length), failed[0] ? failed[0].save.error : '', failed.length > 0);
  put(r.rest, String(left.length), t('pop.about', { size: fmtSize(estimate) }), estimate > 0 && left.length > 0);
  put(r.dur, fmtLong(dur), known.length < items.length ? t('pop.ofKnown', { n: known.length }) : '', dur > 0);
  /* the pick, and the rows it leaves out for want of the dub */
  const pick = groupPickOf(popScope, items);
  put(r.pickRow, pick ? `${pick.dubName} · ${qualityWords(pick.quality)}` : '', '', !!pick);
  const lacking = pick ? left.filter(it => lacksDub(it, pick.dubKey)) : [];
  put(r.without, lacking.length ? `${pick.dubName} · ${t('pop.episodes', { n: lacking.length })}` : '', '', lacking.length > 0);
  /* the buttons: start or take up what is not saved here and has the dub; pause what loads here */
  const toGo = left.filter(it => !isSaving(it) && !(pick && lacksDub(it, pick.dubKey)));
  r.go.hidden = !toGo.length;
  r.go.textContent = (paused.length || failed.length ? t(popScope === null ? 'pop.resumeAll' : 'pop.resumePart') : t(popScope === null ? 'pop.download' : 'pop.downloadPart')) + ` · ${toGo.length}`;
  r.pause.hidden = !loading.length;
  r.pause.textContent = t(popScope === null ? 'pop.pauseAll' : 'pop.pausePart');
  const withSave = items.filter(it => it.save && !isSaved(it));
  r.cancel.hidden = !withSave.length;
  r.cancel.textContent = r.cancel.classList.contains('is-armed') ? t('pop.cancelSure', { n: withSave.length }) : t('pop.cancel');
  r.del.hidden = !saved.length;
  r.del.textContent = r.del.classList.contains('is-armed') ? t('pop.deleteSure', { n: saved.length }) : t('pop.deleteFiles') + ` · ${saved.length}`;
  for (const part of r.parts) {
    const its = items.filter(it => it.seriesId === part.id), done = its.filter(isSaved);
    part.c.textContent = `${done.length}/${its.length}`;
    part.c.classList.toggle('is-done', its.length > 0 && done.length === its.length);
    part.sz.textContent = done.length ? fmtSize(done.reduce((a, it) => a + sizeOf(it), 0)) : '';
  }
  placeSavePop();
}

/* the library section is read once per opening, not on every paint */
async function fillSavePopLibrary(scope) {
  let d = null, lib = null;
  try { [d, lib] = await Promise.all([api('/api/home'), api('/api/library')]); } catch (_) { return; }
  if (!pop || !pop.refs.lib || popScope !== scope || savePop.hidden) return;
  const l = pop.refs.lib;
  const grid = el('div', 'savepop__grid');
  const all = lib.series.flatMap(x => x.episodes);
  popRow(grid, t('pop.onDisk'), t('pop.series', { n: lib.series.length }), t('pop.episodes', { n: all.length }) + ' · ' + fmtSize(all.reduce((a, e) => a + (e.size || 0), 0)));
  if (d) {
    popRow(grid, t('pop.cache'), fmtSize(d.cache.bytes), t('pop.ofLimit', { limit: fmtSize(d.cache.limit) }));
    if (d.cache.free != null) popRow(grid, t('pop.free'), fmtSize(d.cache.free), d.cache.total ? t('pop.ofDisk', { total: fmtSize(d.cache.total) }) : '');
  }
  l.append(grid);
  if (d) {
    const b = el('button', 'savepop__path');
    b.innerHTML = phSvg(PH.folder) + '<span></span>';
    b.querySelector('span').textContent = d.home;
    b.title = t('set.homeOpen');
    b.onclick = ev => { ev.stopPropagation(); post('/api/home/open').catch(e => toast(t('toast.homeFail', { why: e.message }))); };
    l.append(b);
  }
  l.hidden = false;
  placeSavePop();
}

function showSavePop(scope = null) {
  clearTimeout(popT);
  const fresh = savePop.hidden || popScope !== scope || !pop;
  popScope = scope;
  savePop.hidden = false;
  if (fresh) { buildSavePop(); fillSavePopLibrary(scope); }
  paintSavePop();
}
function hideSavePop() { if (popPinned) return; popT = setTimeout(() => { savePop.hidden = true; pop = null; }, 120); }
function pinSavePop(scope, anchor = null) {
  popPinned = true; popAnchor = anchor;
  savePop.classList.add('is-pinned');
  showSavePop(scope);
}
let popClosedScope = null;
function unpinSavePop() {
  popClosedAt = Date.now(); popClosedScope = popScope;
  popPinned = false; popAnchor = null; pop = null;
  savePop.classList.remove('is-pinned');
  savePop.hidden = true;
}
btnSaveAll.addEventListener('pointerenter', () => { if (!popPinned) { popAnchor = null; showSavePop(null); } });
btnSaveAll.addEventListener('pointerleave', hideSavePop);
savePop.addEventListener('pointerenter', () => clearTimeout(popT));
savePop.addEventListener('pointerleave', hideSavePop);
savePop.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', e => {
  if (!popPinned || e.target.closest('#savePop, #saveMenu')) return;
  /* the click closes the popover and does nothing else: the anchors toggle it themselves */
  const anchor = e.target.closest('#btnSaveAll, .queue__group-save');
  if (!anchor) { e.stopPropagation(); e.preventDefault(); }
  unpinSavePop();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && popPinned) unpinSavePop(); });
/* the header's button and a group's mark open their popovers; nothing starts from the click itself */
let popClosedAt = 0;
btnSaveAll.onclick = () => { if (Date.now() - popClosedAt < 50 && popClosedScope === null) return; pinSavePop(null); };
queueList.addEventListener('click', e => {
  const g = e.target.closest('.queue__group-save');
  if (!g) return;
  e.stopPropagation();
  const li = g.closest('.queue__group');
  if (Date.now() - popClosedAt < 50 && popClosedScope === li.dataset.group) return;   // the click that just closed it
  pinSavePop(li.dataset.group, g);
});

/* ── saving: this page opens, the server keeps the line ────────
   Whatever asks for a save, a row's mark, a part's button, the queue's
   button, puts rows into this page's short line to be opened; one at a
   time each is opened (its stream found) and handed to the server, which
   keeps the one real line: one job works, the rest wait. From then on the
   row's state comes from the server's poll. A row asked for with a quality
   of its own keeps that stream for its turn. */
const saveQueue = [];
let opener = null;
function enqueueSaves(items, stream = null, { first = false, pick: groupPick = null } = {}) {
  for (const it of items) {
    if (isSaved(it) || isSaving(it) || isQueued(it)) continue;
    const before = it.save || {};
    it.saveStream = stream || null;
    /* what was picked stays with the row: a pause and a resume keep the dub and the quality */
    const pick = stream ? { id: stream.id, level: stream.level || null } : before.pick || null;
    it.save = { st: 'queued', quality: (stream && stream.quality) || before.quality || null, pick, groupPick: groupPick || before.groupPick || null, done: before.done || 0, total: before.total || 0, unit: before.unit, phase: before.phase };
    if (first) saveQueue.unshift(it); else saveQueue.push(it);
  }
  paintSaved();
  if (!opener) opener = openSaves().finally(() => { opener = null; paintSaved(); });
}
async function openSaves() {
  while (saveQueue.length) {
    const it = saveQueue.shift();
    if (!isQueued(it)) continue;             // left the line while it waited
    const st = it.saveStream || null; it.saveStream = null;
    await submitSave(it, st);
  }
  clearTimeout(savesT); watchSaves();
}

/* one row handed to the server: opened if it was not, its stream named, the job asked for */
async function submitSave(it, stream = null) {
  const before = it.save || {};
  const quality = stream ? (stream.quality || null) : before.quality || null;
  const pick = stream ? { id: stream.id, level: stream.level || null } : before.pick || null;
  const first = !!before.first;
  it.pauseWanted = false;
  it.save = { st: 'opening', phase: 'fetch', done: before.done || 0, total: before.total || 0, unit: before.unit, quality, pick }; paintSaved();
  try {
    if (!it.stream) await resolveItem(it);
    if (it.pauseWanted) { it.save = { st: 'paused', phase: before.phase || 'fetch', done: before.done || 0, total: before.total || 0, unit: before.unit, quality, pick }; paintSaved(); return; }
    /* a part's pick names the dub and the quality for every row of it */
    let st = stream || pick || null;
    if (!st && before.groupPick) { st = await streamForPick(it, before.groupPick); if (!st) throw new Error(t('pop.noDub', { dub: before.groupPick.dubName })); }
    st = st || streamOfQuality(it, quality) || streamToSave(it);
    if (!st) throw new Error(t('toast.noStream', { name: it.name }));
    let job = await post('/api/save?stream=' + st.id + (st.level ? '&level=' + st.level : '') + (first ? '&first=1' : ''));
    if (it.pauseWanted) job = await post('/api/save/pause?id=' + encodeURIComponent(job.id));
    it.save = jobState(job, quality); paintSaved();
  } catch (e) {
    it.save = { st: 'failed', error: e.message, phase: before.phase, done: before.done || 0, total: before.total || 0, unit: before.unit, quality, pick }; paintSaved();
    toast(t('toast.saveFail', { why: e.message }));
  }
}
/* a server job as the row's state */
function jobState(job, quality = null) {
  const q = jobQuality(job) || quality;
  const pick = job.streamId ? { id: job.streamId, level: job.level || null } : null;
  if (job.state === 'paused') return { st: 'paused', phase: job.phase, done: job.done || 0, total: job.total || 0, unit: job.unit, quality: q, pick };
  if (job.state === 'error') return { st: 'failed', error: job.error, phase: job.phase, done: job.done || 0, total: job.total || 0, unit: job.unit, quality: q, pick };
  if (job.state === 'done') return null;
  return { st: job.state === 'queued' ? 'queued' : 'saving', phase: job.phase, done: job.done || 0, total: job.total || 0, unit: job.unit, jobId: job.id, quality: q, pick };
}

/* rows taken out of this page's line go back to what they were before they were asked */
function dequeueSaves(items) {
  for (const it of items) if (isQueued(it) && !it.save.jobId) {
    const i = saveQueue.indexOf(it); if (i >= 0) saveQueue.splice(i, 1);
    const sv = it.save;
    it.save = sv.total || sv.phase ? { st: 'paused', phase: sv.phase || 'fetch', done: sv.done || 0, total: sv.total || 0, unit: sv.unit, quality: sv.quality } : null;
    it.saveStream = null;
  }
  paintSaved();
}

/* a waiting row made the current one: it heads the line, and the one
   working steps back behind it with its progress kept */
async function promoteSave(it) {
  const sv = it.save;
  if (!sv || sv.st !== 'queued') return;
  if (sv.jobId) {
    try { const job = await post('/api/save/promote?id=' + encodeURIComponent(sv.jobId)); it.save = jobState(job, sv.quality); }
    catch (e) { toast(t('toast.saveFail', { why: e.message })); }
  } else {
    const i = saveQueue.indexOf(it); if (i >= 0) saveQueue.splice(i, 1);
    sv.first = true;
    saveQueue.unshift(it);
    if (!opener) opener = openSaves().finally(() => { opener = null; paintSaved(); });
  }
  paintSaved();
  clearTimeout(savesT); watchSaves();
}

/* ── cancelling and clearing ───────────────────────────────────
   A save cancelled leaves nothing: the job, the half file, the cached
   pieces and the record go, on the server and on this page. Saved files
   deleted go with their sidecars; a series folder left empty goes too. */
async function cancelSaves(items) {
  const mine = items.filter(it => it.save && !isSaved(it));
  dequeueSaves(mine);
  for (const it of mine) { if (it.save && it.save.st === 'opening') it.pauseWanted = true; it.save = null; }
  paintSaved();
  const bySeries = new Map();
  for (const it of mine) { if (!bySeries.has(it.seriesId)) bySeries.set(it.seriesId, []); bySeries.get(it.seriesId).push(it.number); }
  try {
    for (const [seriesId, eps] of bySeries) await post(`/api/saves/cancel?series=${encodeURIComponent(seriesId)}&episodes=${eps.join(',')}`);
  } catch (e) { toast(t('toast.saveFail', { why: e.message })); }
  if (mine.length) toast(t('toast.cancelled', { n: mine.length }));
  clearTimeout(savesT); watchSaves();
}
async function deleteSaved(items) {
  const saved = items.filter(isSaved);
  const bySeries = new Map();
  for (const it of saved) { if (!bySeries.has(it.seriesId)) bySeries.set(it.seriesId, []); bySeries.get(it.seriesId).push(it.number); }
  let n = 0;
  try {
    for (const [seriesId, eps] of bySeries) n += (await post(`/api/library/delete?series=${encodeURIComponent(seriesId)}&episodes=${eps.join(',')}`)).removed || 0;
  } catch (e) { toast(t('toast.saveFail', { why: e.message })); }
  await loadLibrary();
  toast(t('toast.deleted', { n }));
}

/* ── the pause, by scope ───────────────────────────────────────
   A row's ring pauses that row. A part's button pauses the rows of that
   part: the one loading is cut off on the server, the ones waiting leave
   the line, and the line goes on with the rest. The queue's button pauses
   everything, the server's own jobs and its resume loop included. Each
   paused row keeps where it got to and the quality it had, and waits for
   a hand. */
async function pauseItems(items, whole = false) {
  dequeueSaves(items);
  for (const it of items) if (it.save && it.save.st === 'opening') it.pauseWanted = true;
  const jobs = items.filter(it => (isSaving(it) || isQueued(it)) && it.save.jobId);
  try {
    if (whole) await post('/api/saves/pause');
    else await Promise.all(jobs.map(it => post('/api/save/pause?id=' + encodeURIComponent(it.save.jobId))));
  } catch (e) { toast(t('toast.pauseFail', { why: e.message })); return; }
  for (const it of jobs) it.save = { st: 'paused', phase: it.save.phase, done: it.save.done || 0, total: it.save.total || 0, unit: it.save.unit, quality: it.save.quality || null };
  paintSaved();
  clearTimeout(savesT); watchSaves();       // the rows follow the server's records
}

function removeItem(it) {
  const i = idxOf(it), wasCurrent = it === cur();
  state.list.splice(i, 1);
  if (wasCurrent) {
    const nx = state.list[i] || state.list[i - 1] || null;
    if (nx) playItem(nx);
    else { state.current = null; playToken++; hideProgress();
           stage.classList.remove('fading');
           video.pause(); video.removeAttribute('src'); video.load(); }
  }
  render();
}

/* ═══════════════ dragging inside the list ═══════════════
   The insertion point is computed geometrically, from the cursor
   position against the midpoints of the rows. Through e.target it
   worked in fits and starts: a nested span or a gap in the list could
   be under the cursor, and then the marker vanished and on release the
   file flew to the end.

   The dragged row moves to the computed place at once and serves as the
   slot, while its neighbours travel there with a FLIP animation: the
   positions are measured before the reorder, then the shift is
   compensated with a transform and released. */
let dragEl = null;

function flipMove(mutate) {
  const kids = [...queueList.children];
  const before = new Map(kids.map(k => {
    const r = k.getBoundingClientRect();
    return [k, [r.left, r.top]];
  }));
  mutate();

  /* First READ all the new positions, then WRITE all the shifts. Mix
     them and the browser recomputes layout on every row, which is the
     forced reflow the console warns about. */
  const shift = [];
  for (const k of queueList.children) {
    const was = before.get(k);
    if (!was) continue;
    const r = k.getBoundingClientRect();
    const dx = was[0] - r.left, dy = was[1] - r.top;
    if (dx || dy) shift.push([k, dx, dy]);
  }
  for (const [k, dx, dy] of shift) {
    k.style.transition = 'none';
    k.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  requestAnimationFrame(() => {
    for (const [k] of shift) {
      k.style.transition = 'transform 240ms cubic-bezier(.22,.8,.24,1)';
      k.style.transform = '';
    }
  });
}

/* The element the dragged one will be placed BEFORE; null means the very
   end. In rows the vertical axis is enough; in tiles the order runs left
   to right and line by line, so both axes matter. */
function insertionRef(x, y) {
  const grid = state.view === 'grid';
  for (const li of queueList.querySelectorAll(grid ? '.tile:not(.dragging)' : '.item:not(.dragging)')) {
    const r = li.getBoundingClientRect();
    if (grid ? (y < r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2) return li;
  }
  return null;
}

queueList.addEventListener('dragstart', e => {
  const li = e.target.closest('.item, .tile');
  if (!li) return;
  dragEl = li;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', li.dataset.id); } catch (_) {}
  /* the class is added on the next frame: otherwise the browser takes
     the drag image from the already changed row and it comes out
     half transparent */
  requestAnimationFrame(() => li.classList.add('dragging'));
});

queueList.addEventListener('dragover', e => {
  if (!dragEl) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const ref = insertionRef(e.clientX, e.clientY);
  if (ref === dragEl || ref === dragEl.nextElementSibling) return;   // already in place
  flipMove(() => queueList.insertBefore(dragEl, ref));
});

function commitDrag() {
  if (!dragEl) return;
  dragEl.classList.remove('dragging');
  dragEl = null;
  for (const k of queueList.children) { k.style.transition = ''; k.style.transform = ''; }

  /* the order comes from the markup, which has already been rearranged */
  const at = new Map([...queueList.children].map((li, i) => [li.dataset.id, i]));
  state.list.sort((x, y) => at.get(String(x.id)) - at.get(String(y.id)));
  paintMeta();   // no render(), or rebuilding the rows would cut the animation short
}

queueList.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); commitDrag(); });
queueList.addEventListener('dragend', commitDrag);

/* The order of the queue: from the first episode to the last, or
   the other way round; the parts of a franchise go with it. */
const seasonRank = it => { const s = seasonOf(it); return s ? s.ordinal || 0 : 0; };
const byOrder = (a, b) => seasonRank(a) - seasonRank(b) || a.number - b.number;
$('#btnSort').onclick = () => { state.list.sort(byOrder); render(); toast(t('queue.sorted')); };
$('#btnReverse').onclick = () => { state.list.sort((a, b) => byOrder(b, a)); render(); toast(t('queue.reversed')); };
$('#btnClear').onclick = () => {
  playToken++;
  stopPlayback();                    // the picture and the sound, hls.js included
  state.list = []; state.current = null;
  state.series = null; state.seasons = []; state.dubKey = null; state.saved = new Map();
  try { localStorage.removeItem('lapka.session'); } catch (_) {}
  endCard.classList.remove('show'); hideNotice(); hideProgress();
  stage.classList.remove('fading');
  skipNow = null; skipEl.hidden = true;
  emptyEl.classList.remove('hide');
  paintTitle(); syncStatus(); syncAudioButton(); syncQualityButton(); syncSubsButton();
  render();
};

/* ── list view: rows or tiles ─────────────────────────────────
   The switch lives in the queue header rather than in the settings:
   this is a choice about the current viewing, changed often and in the
   middle of things. */
function setView(v) {
  state.view = v;
  try { localStorage.setItem('lapka.view', v); } catch (_) {}
  paintView();
  render();
}
function paintView() {
  btnViewRows.classList.toggle('on', state.view === 'rows');
  btnViewGrid.classList.toggle('on', state.view === 'grid');
}
btnViewRows.onclick = () => setView('rows');
btnViewGrid.onclick = () => setView('grid');

function toggleQueue(force) {
  state.queueOpen = force === undefined ? !state.queueOpen : force;
  workspace.classList.toggle('queue-open', state.queueOpen);
  btnList.classList.toggle('on', state.queueOpen);
  fitDeck();         // the stage has changed width; the observer follows the slide
}
btnList.onclick = () => toggleQueue();
$('#btnQueueClose').onclick = () => toggleQueue(false);
$('#btnInfo').onclick = () => toggleQueue(true);
/* In a narrow window the panel would cover the start screen whole, so
   there the player starts with it shut; the info button opens it. */
toggleQueue(!narrowWindow.matches);

/* With nothing loaded the panel holds the project description, and
   closing it had no way back: the queue button lives in the deck, which
   is hidden then. So the cross goes, except in a narrow window: there
   the panel covers everything, the info button included, and the cross
   is the only way back to the start screen. */
function syncQueueClose() {
  $('#btnQueueClose').hidden = !state.list.length && !narrowWindow.matches;
}
narrowWindow.addEventListener('change', syncQueueClose);

/* While the picture plays in a PiP window, the main tab is where the
   queue is at hand: the file in the window is switched from here without
   closing it. So the queue opens when PiP starts, at any width: in a
   narrow window it covers the placeholder, which has nothing to show
   anyway. It closes again when PiP ends, provided it was this that
   opened it and it is still open. */
let pipOpenedQueue = false;
function pipStarted() {
  if (state.queueOpen) return;
  toggleQueue(true);
  pipOpenedQueue = true;
}
function pipEnded() {
  if (pipOpenedQueue && state.queueOpen) toggleQueue(false);
  pipOpenedQueue = false;
}

/* ═══════════════ fullscreen ═══════════════ */
const isFull = () => !!document.fullscreenElement;
async function toggleFull() {
  if (state.pipWin) return toast(t('pip.closeFirst'));
  try {
    if (isFull()) await document.exitFullscreen();
    else await workspace.requestFullscreen({ navigationUI: 'hide' });
  } catch (_) { toast(t('full.fail')); }
}
btnFull.onclick = toggleFull;
document.addEventListener('fullscreenchange', () => {
  btnFull.classList.toggle('on', isFull());
  btnFull.innerHTML = phSvg(isFull() ? PH.cornersIn : PH.cornersOut);
  poke();
});

/* ═══════════════ picture-in-picture ═══════════════ */
const hasDocPip = 'documentPictureInPicture' in window;

async function nativePip() {
  if (!document.pictureInPictureEnabled || video.disablePictureInPicture) {
    toast(t('pip.unsupported')); return;
  }
  try { await video.requestPictureInPicture(); }
  catch (_) { toast(t('pip.refused')); }
}

async function togglePip() {
  if (state.pipWin) return state.pipWin.close();
  if (document.pictureInPictureElement) { try { await document.exitPictureInPicture(); } catch (_) {} return; }
  if (!cur()) return toast(t('pip.pickFirst'));

  /* The browser mode is a window with no address bar but with the
     browser's own controls. The bar cannot be hidden in the extended
     mode: it is Chrome's own interface. */
  if (state.pipMode === 'native') return nativePip();

  if (hasDocPip) { try { return await openDocPip(); } catch (err) { console.warn(err); } }
  return nativePip();
}

const PIP_MODES = [
  { id: 'document', main: 'pip.doc',    sub: 'pip.docSub' },
  { id: 'native',   main: 'pip.native', sub: 'pip.nativeSub' },
];

function buildPipMenu() {
  pipMenu.replaceChildren();
  const head = document.createElement('div');
  head.className = 'menu__title';
  head.textContent = t('pip.head');
  pipMenu.append(head);

  for (const m of PIP_MODES) {
    const disabled = m.id === 'document' && !hasDocPip;
    const b = document.createElement('button');
    b.className = 'menu__item' + (state.pipMode === m.id ? ' sel' : '');
    b.disabled = disabled;
    b.innerHTML = `<span class="menu__tick">${phSvg(PH.check)}</span>
      <span class="menu__body"><span class="menu__main"></span><span class="menu__sub"></span></span>`;
    b.querySelector('.menu__main').textContent = t(m.main);
    b.querySelector('.menu__sub').textContent = t(disabled ? 'pip.noDoc' : m.sub);
    b.onclick = () => {
      if (disabled) return;
      state.pipMode = m.id;
      saveStr('lapka.pipMode', m.id);
      markPicked(b);
      toast(t('pip.switched', { name: t(m.main) }));
      if (state.pipWin) state.pipWin.close();
      else if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    };
    pipMenu.append(b);
  }
}

btnPipMode.onclick = e => {
  e.stopPropagation();
  buildPipMenu();
  closeMenus(pipMenu);
  pipMenu.classList.toggle('open');
};

/* ── the extended PiP window ─────────────────────────────────
   The window gets a copy of the player, and only the video itself moves
   into it. It used to take the whole stage, and the tab was left with a
   placeholder and no controls at all: no deck, no queue button, no
   settings, so a queue closed on a narrow screen could not be opened
   again. Now the tab keeps everything, as it does in the browser's own
   PiP, and the window is a second view of the same player.

   The copy is the stage cloned at the moment of opening, with pip-mode
   on it, so it looks as the moved stage used to. It is kept up to date
   by mirroring: every change in the tab's stage is replayed in the copy
   at the same place in the tree. The way back goes by the same address:
   a button pressed in the window presses its twin in the tab, so every
   handler stays where it is. Only what belongs to one window is not
   mirrored: the stage's own classes (idle, the cursor), the deck's
   fitting to the tab's width, and which menu is open and where it
   stands. The copy starts without them too, whatever the tab had at
   that moment, and its deck is never fitted: the pip-mode rules size it
   for the window. */
let pipView = null, pipMirror = null, videoSlot = null, pipHideT = 0;

const pathIn = (root, node) => {
  const p = [];
  for (let n = node; n !== root; n = n.parentNode) {
    if (!n || !n.parentNode) return null;
    p.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
  }
  return p;
};
const nodeAt = (root, p) => p.reduce((n, i) => n && n.childNodes[i], root) || null;

/* the classes each window keeps for itself; the rest follow the tab */
const OWN_CLASSES = new Set(['idle', 'cursor-hidden', 'is-pip', 'pip-mode', 'open',
  'deck--packed', 'deck--compact', 'deck--offcentre', 'rb--icon']);
function mirrorOne(r) {
  const path = pathIn(stage, r.target);
  if (!path) return;                                  // already out of the tree
  if (path.length && path[0] === pathIn(stage, videoSlot)[0]) return;   // the video's place
  const el = r.target;
  const twin = path.length ? nodeAt(pipView, path) : pipView;
  if (!twin) return;
  if (r.type === 'attributes' && r.attributeName === 'class') {
    const own = [...twin.classList].filter(c => OWN_CLASSES.has(c));
    twin.setAttribute('class', el.getAttribute('class') || '');   // an attribute, svg has no string className
    twin.classList.remove(...OWN_CLASSES);
    twin.classList.add(...own);
    return;
  }
  /* where an open menu stands is worked out in its own window, and the
     studio name is cut to the tab's room, not the window's */
  if (r.type === 'attributes' && r.attributeName === 'style' && (el.classList.contains('menu') || el === audioLabel)) return;
  if (el === stage && r.type === 'attributes') return;
  if (r.type === 'attributes') {
    const v = el.getAttribute(r.attributeName);
    if (v == null) twin.removeAttribute(r.attributeName); else twin.setAttribute(r.attributeName, v);
  } else if (r.type === 'characterData') {
    twin.data = el.data;
  } else if (el !== stage) {
    twin.replaceChildren(...Array.from(el.childNodes, n => n.cloneNode(true)));
  }
}

/* the deck in the window hides on its own, like the one in the tab */
function pipPoke() {
  if (!pipView) return;
  pipView.classList.remove('idle', 'cursor-hidden');
  clearTimeout(pipHideT);
  pipHideT = setTimeout(() => {
    if (!pipView || video.paused || pipView.querySelector('.menu.open')) return;
    pipView.classList.add('idle', 'cursor-hidden');
  }, 2600);
}

function closePipMenus(except) {
  if (pipView) for (const m of pipView.querySelectorAll('.menu.open')) if (m !== except) m.classList.remove('open');
}

/* A press in the window. The track and subtitle buttons open their menu
   in the window only, built by the tab's own code and mirrored in. A
   choice in a menu, and every other button, presses its twin in the tab;
   a choice keeps the menu open, as it does in the tab (markPicked). */
function pipClick(e) {
  const t = e.target;
  if (t.closest('.seek, .vol__bar')) return;          // the sliders handle themselves
  const opener = t.closest('#btnAudio, #btnSubs');
  if (opener) {
    const m = pipView.querySelector(opener.id === 'btnAudio' ? '#audioMenu' : '#subsMenu');
    const open = !m.classList.contains('open');
    if (open) (opener.id === 'btnAudio' ? buildAudioMenu : buildSubsMenu)();
    closePipMenus(m);
    m.classList.toggle('open', open);
    if (open) queueMicrotask(() => fitMenu(m));       // after the rebuilt items have been mirrored in
    return;
  }
  const b = t.closest('button');
  if (!b) { if (!t.closest('.menuwrap')) closePipMenus(); return; }
  const twin = nodeAt(stage, pathIn(pipView, b));
  if (twin) twin.click();
}

async function openDocPip() {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  /* 600 wide, raised from 520 when the deck in the window still held
     loop and autoplay as well and the row broke in two. Those have left
     the window since; the width stayed. */
  const w = 600, h = Math.max(200, Math.round(w * vh / vw));
  const win = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
  state.pipWin = win;

  const boot = win.document.createElement('style');
  boot.textContent = 'html,body{margin:0;background:#000;overflow:hidden}';
  win.document.head.append(boot);
  document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
    const c = win.document.createElement('link');
    c.rel = 'stylesheet'; c.href = l.href;
    win.document.head.append(c);
  });

  win.document.title = cur() ? cur().name : 'Lapka';
  /* The window has a root element of its own, and the chosen font and
     the language live on the root. Without them the floating window
     showed Fixel while the main one was set to Inter. */
  win.document.documentElement.dataset.font = state.set.font;
  win.document.documentElement.lang = lang;
  win.document.body.classList.add('pip-body');

  /* The video's place in the tab is held by an empty slot, and the copy is
     cloned only after that: a cloned video would start loading its source
     all over again. In the copy the slot is where the real video goes, so
     both trees keep the same shape and the mirror finds its way. */
  videoSlot = document.createElement('span');
  video.replaceWith(videoSlot);
  pipView = stage.cloneNode(true);
  for (const el of [pipView, ...pipView.querySelectorAll('[class]')]) el.classList.remove(...OWN_CLASSES);
  pipView.querySelector('#audioLabel').style.maxWidth = '';
  pipView.classList.add('pip-mode');
  pipView.removeAttribute('tabindex');
  nodeAt(pipView, pathIn(stage, videoSlot)).replaceWith(video);
  win.document.body.append(pipView);
  pipMirror = new MutationObserver(recs => recs.forEach(mirrorOne));
  pipMirror.observe(stage, { subtree: true, attributes: true, childList: true, characterData: true });

  bindSlider(pipView.querySelector('#seek'), seekSlider);
  bindSlider(pipView.querySelector('#volBar'), volSlider);
  pipView.addEventListener('click', pipClick);
  pipView.addEventListener('pointermove', pipPoke);

  stage.classList.add('is-pip');
  pipSeg.classList.add('on');
  win.document.addEventListener('keydown', e => { pipPoke(); onKey(e); });
  win.addEventListener('pagehide', closeDocPip, { once: true });
  win.addEventListener('resize', () => { for (const m of pipView.querySelectorAll('.menu.open')) fitMenu(m); });
  syncStatus(); poke(); pipPoke(); pipStarted();
}
function closeDocPip() {
  if (pipMirror) pipMirror.disconnect();
  clearTimeout(pipHideT);
  if (videoSlot) videoSlot.replaceWith(video);
  pipMirror = null; pipView = null; videoSlot = null;
  stage.classList.remove('is-pip');
  pipSeg.classList.remove('on');
  state.pipWin = null;
  syncStatus(); poke(); fitDeck(); pipEnded();
}
btnPip.onclick = togglePip;
$('#btnPipBack').onclick = () => {
  if (state.pipWin) state.pipWin.close();
  else if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
};
/* the browser's own PiP leaves the video element in the tab, and Chrome
   paints a placeholder of its own into it; ours stands over it, as in the
   extended mode */
video.addEventListener('enterpictureinpicture', () => { stage.classList.add('is-pip'); pipSeg.classList.add('on'); syncStatus(); pipStarted(); });
video.addEventListener('leavepictureinpicture', () => { stage.classList.remove('is-pip'); pipSeg.classList.remove('on'); syncStatus(); pipEnded(); });

/* ── media session ───────────────────────────────────────── */
function mediaMeta(it) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.name, artist: it.seriesTitle || 'Lapka',
      album: `${idxOf(it) + 1} / ${state.list.length}`,
    });
  } catch (_) {}
}
if ('mediaSession' in navigator) {
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (_) {} };
  set('play', () => video.play().catch(() => {}));
  set('pause', () => video.pause());
  set('previoustrack', prev);
  set('nexttrack', () => next());
  set('seekbackward', d => nudge(-((d && d.seekOffset) || 10)));
  set('seekforward', d => nudge((d && d.seekOffset) || 10));
  set('seekto', d => { if (d && d.seekTime != null) seekTo(d.seekTime); });
}

/* The native PiP window draws its own seek bar from these values. */
let posStateT = 0;
function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const now = performance.now();
  if (now - posStateT < 900) return;
  posStateT = now;
  const d = duration();
  if (!d) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: video.playbackRate || 1,
      position: Math.min(d, Math.max(0, position())),
    });
  } catch (_) {}
}

/* ═══════════════ video events ═══════════════ */
/* The icon and the caption of the button live in one place: the caption
   is translated, and after a language change it has to be restored in
   the same state as the icon. */
function paintPlay() {
  const playing = !video.paused;
  setIcon(playIcon, playing ? PH.pause : PH.play);
  btnPlay.title = t(playing ? 'deck.pause' : 'deck.play');
}

video.addEventListener('play', () => {
  paintPlay(); pipPoke(); pipGhost.classList.add('playing');
  pulse(true); syncStatus(); markPlaying(true);
  deckShow(false);
});
video.addEventListener('pause', () => {
  paintPlay(); pipPoke(); pipGhost.classList.remove('playing');
  pulse(false); syncStatus(); markPlaying(false);
  /* At the end of a file the browser sends pause BEFORE ended, and that
     is not a stop the user asked for. The ended handler decides. */
  if (video.ended) return;
  if (loaded) markPos(loaded, video.currentTime);
  deckShow(true);
});
let posT = 0;
/* ── skipping the opening or the ending ─────────────────────────
   While the time is inside a mark the button is there; press it and
   the mark is jumped over, dismiss it and it stays away for this
   mark of this episode, do nothing and it goes when the mark ends. */
/* The plate over the picture while the time is inside a marked zone.
   By hand: the button skips, the cross hides the plate for this zone.
   By itself (the setting): the button reads Watch and fills from left
   to right over six seconds of playing; unanswered, the zone is skipped;
   Watch keeps this zone and this zone alone; the cross skips at once.
   A zone answered either way is done for this episode: seeking back
   into it shows no plate again. */
const AUTO_SKIP_S = 6;
let skipNow = null;
function hideSkip() { skipNow = null; skipEl.hidden = true; }
function doSkip(it, zone, done = false) {
  seekTo(zone.stop);
  flash(t('skip.' + zone.name));
  if (done && it) it.skipHidden[zone.name] = true;
  hideSkip();
}
function paintSkip() {
  const it = cur();
  const t0 = video.currentTime;
  let found = null;
  if (it && it.marks) for (const name of ['opening', 'ending']) {
    const m = it.marks[name];
    if (m && !it.skipHidden[name] && t0 >= m.start && t0 < m.stop - 1) { found = { name, ...m }; break; }
  }
  if (!found) { if (skipNow) hideSkip(); return; }
  if (skipNow && skipNow.name === found.name) {
    if (skipNow.auto) {
      const f = Math.min(1, Math.max(0, (t0 - skipNow.since) / skipNow.wait));
      btnSkip.style.setProperty('--fill', f.toFixed(3));
      if (f >= 1) doSkip(it, skipNow, true);
    }
    return;
  }
  skipNow = found;
  const auto = state.set.autoSkip === 'on';
  if (auto) { skipNow.auto = true; skipNow.since = t0; skipNow.wait = Math.max(1, Math.min(AUTO_SKIP_S, found.stop - 1 - t0)); }
  btnSkip.textContent = t(auto ? 'skip.watch' : 'skip.' + found.name);
  btnSkip.classList.toggle('is-auto', auto);
  btnSkip.style.setProperty('--fill', '0');
  btnSkipHide.title = t(auto ? 'skip.now' : 'skip.hide');
  skipEl.hidden = false;
}
btnSkip.onclick = () => {
  if (!skipNow) return;
  const it = cur();
  if (skipNow.auto) { if (it) it.skipHidden[skipNow.name] = true; hideSkip(); }   // watched: this zone stays
  else doSkip(it, skipNow);
};
btnSkipHide.onclick = () => {
  if (!skipNow) return;
  const it = cur();
  if (skipNow.auto) doSkip(it, skipNow, true);
  else { if (it) it.skipHidden[skipNow.name] = true; hideSkip(); }
};

video.addEventListener('timeupdate', () => {
  paintSeek(); updatePositionState(); paintSkip();
  if (!loaded || video.paused) return;
  const now = Date.now(), send = now - posT >= 5000;
  if (send) posT = now;
  markPos(loaded, video.currentTime, send);
});
video.addEventListener('progress', paintSeek);
video.addEventListener('seeked', () => { state.seekPreview = null; paintSeek(); });
video.addEventListener('loadedmetadata', () => {
  state.seekPreview = null;
  const it = cur();
  if (it && isFinite(video.duration) && video.duration) it.dur = video.duration;
  if (it && video.videoWidth && video.videoHeight) it.aspect = video.videoWidth / video.videoHeight;
  paintSeek(); paintMeta(); syncAudioButton(); syncSubsButton(); syncQualityButton();
});
let volT = null;
video.addEventListener('volumechange', () => {
  paintVolume();
  /* not written on every step: a held arrow key produces dozens */
  state.vol = video.volume;
  clearTimeout(volT);
  volT = setTimeout(() => { try { localStorage.setItem('lapka.vol', String(state.vol)); } catch (_) {} }, 400);
});
video.addEventListener('ratechange', () => {
  btnRate.textContent = (video.playbackRate % 1 ? video.playbackRate : video.playbackRate.toFixed(0)) + '×';
  fitDeck();         // 1.25× is wider than 1×
});
video.addEventListener('playing', () => {
  state.errStreak = 0; state.seekPreview = null; autoSwitch = false; syncStatus();
  busyOver();
  const it = cur();
  if (it) {
    if (it.switching) { flash(t('flash.source', { player: (it.source && it.source.player) || '' })); it.switching = null; hideNotice('switching'); }
    it.retries = 0;                  // it plays: the count of tries starts over
  }
});
video.addEventListener('waiting', () => { const it = cur(); if (it && it.loadedSrc) sayStalled(it); });
video.addEventListener('canplay', () => { clearTimeout(stallT); hideNotice('busy'); });
video.addEventListener('timeupdate', () => { if (noticeKind === 'busy' && !video.paused && video.readyState >= 3) hideNotice('busy'); });   // the picture moves: nothing is waiting
video.addEventListener('ended', () => {
  markWatched(loaded);             // however short the episode was
  /* looping one file works even with autoplay off: it is a mode set
     explicitly, not an automatic decision */
  const advancing = state.loop === 'one' || state.autoplay;
  if (!advancing) {
    autoSwitch = false;
    deckShow(true);          // nothing follows, so the deck is needed
    toast(t('auto.off'));
    return;
  }
  /* the deck was hidden, so it stays hidden */
  autoSwitch = stage.classList.contains('idle');
  next(true);
});

/* A stream that fails is not the end: the same dub may come from
   another player. The failed stream is handed back to the server,
   which marks its source dead and picks again. Only when that has
   been tried does the episode count as broken and the queue moves on. */
video.addEventListener('error', () => {
  stage.classList.remove('fading');
  const it = cur();
  if (!it || !it.loadedSrc) return;
  /* another source, another try: up to three per episode, then it is
     broken. Seen, not guessed at: the stage says the source failed and
     which one is being tried, so a pause here never reads as a dead
     player. */
  const failed = it.stream && it.stream.id;
  it.retries = (it.retries || 0) + 1;
  if (failed && it.retries <= 3) {
    it.avoid = failed;
    const from = it.source && it.source.player;
    it.switching = { from, n: it.retries };
    busyOver();
    showNotice(t('notice.switching', { from: from || '?', n: it.retries, total: 3 }), { kind: 'switching', busy: true });
    playItem(it, true, false);
    return;
  }
  it.switching = null;
  busyOver();
  stopPlayback();
  showNotice(t('notice.allFailed', { name: it.name }), { action: t('notice.retry'), onAction: () => { it.err = false; it.retries = 0; playItem(it); } });
  it.err = true;
  render();
  state.errStreak++;
  if (state.errStreak < state.list.length && state.autoplay) setTimeout(() => { if (it === cur() && notice.classList.contains('show')) next(true); }, 4000);
  else state.errStreak = 0;
});

function paintTitle() {
  const it = cur();
  titleName.textContent = it ? it.name : '—';
  const season = it ? seasonOf(it) : null;
  const series = season ? season.series : state.series;
  titlePath.textContent = series ? series.title + (state.seasons.length > 1 && series.year ? ' · ' + series.year : '') : '';
}
/* A line cut short shows itself whole in the ordinary tooltip. Only a
   cut one: over a line that fits, the tooltip would repeat it. */
for (const el of [titleName, titlePath])
  el.addEventListener('pointerenter', () => { el.title = el.scrollWidth > el.clientWidth ? el.textContent : ''; });
function markPlaying(on) {
  const li = queueList.querySelector('.item.active, .tile.active');
  if (li) li.classList.toggle('playing', on);
}
function syncStatus() {
  const it = cur();
  document.title = it ? `${it.name} · Lapka` : 'Lapka';
  paintFavicon();
}

/* ── state in the tab ─────────────────────────────────────────
   The state used to be shown by a pause glyph before the file name: it
   ate space in an already truncated title and looked out of place. Now
   the favicon shows it, the same dark coin as before with a different
   mark inside. */
const FAV = {
  /* the paw of the seal, the first frame, as rectangles: white on the black plate */
  idle:  `<path d="${PAW_PATHS[0]}" fill="#fff" shape-rendering="crispEdges"/>`,
  play:  `<path d="M12.8 9.3 23 16l-10.2 6.7z" fill="#fff"/>`,
  pause: `<path d="M11.6 9.4h3.3v13.2h-3.3zM17.1 9.4h3.3v13.2h-3.3z" fill="#fff"/>`,
  busy:  `<path d="M10.3 8.8h11.4v2.3l-4.6 4.9 4.6 4.9v2.3H10.3v-2.3l4.6-4.9-4.6-4.9z" fill="#fff"/>`,
};
const favUrl = mark => 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#0b0b0c"/>' + mark + '</svg>');

let favNow = '';
function paintFavicon() {
  const s = state.busy ? 'busy'
          : !cur() ? 'idle'
          : video.paused ? 'pause' : 'play';
  if (s === favNow) return;          // do not touch the link on every timeupdate
  favNow = s;
  favicon.href = favUrl(FAV[s]);
}

/* ── buttons ───────────────────────────────────────────────── */
btnPlay.onclick = togglePlay;
$('#btnNext').onclick = () => next();
$('#btnPrev').onclick = prev;
btnMute.onclick = () => { video.muted = !video.muted; };
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function buildRateMenu() {
  rateMenu.replaceChildren();
  const head = document.createElement('div');
  head.className = 'menu__title';
  head.textContent = t('rate.head');
  rateMenu.append(head);

  for (const r of RATES) {
    const b = document.createElement('button');
    b.className = 'menu__item' + (Math.abs(video.playbackRate - r) < 0.001 ? ' sel' : '');
    b.innerHTML = `<span class="menu__tick">${phSvg(PH.check)}</span>
      <span class="menu__body"><span class="menu__main"></span></span>`;
    b.querySelector('.menu__main').textContent = r === 1 ? t('rate.normal') : r + '×';
    b.onclick = () => { video.playbackRate = r; markPicked(b); };
    rateMenu.append(b);
  }
}
btnRate.onclick = e => {
  e.stopPropagation();
  buildRateMenu();
  closeMenus(rateMenu);
  rateMenu.classList.toggle('open');
};
const LOOP_MODES = ['off', 'queue', 'one'];
const LOOP_ICON = { off: PH.repeat, queue: PH.repeat, one: PH.repeatOnce };
function paintLoop() {
  btnLoop.innerHTML = phSvg(LOOP_ICON[state.loop]);
  btnLoop.title = t('loop.' + state.loop);
  btnLoop.classList.toggle('on', state.loop !== 'off');
}
btnLoop.onclick = () => {
  state.loop = LOOP_MODES[(LOOP_MODES.indexOf(state.loop) + 1) % LOOP_MODES.length];
  paintLoop();
  toast(t('loop.' + state.loop));
};
function paintAuto() {
  btnAuto.classList.toggle('on', state.autoplay);
  btnAuto.title = t(state.autoplay ? 'auto.on' : 'auto.off');
}
btnAuto.onclick = () => {
  state.autoplay = !state.autoplay;
  saveStr('lapka.autoplay', state.autoplay ? '1' : '0');
  paintAuto();
  toast(t(state.autoplay ? 'auto.toastOn' : 'auto.off'));
};

$('#btnRestart').onclick = () => { endCard.classList.remove('show'); if (state.list.length) playItem(state.list[0]); };
$('#btnEndClose').onclick = () => endCard.classList.remove('show');

/* ── the link ──────────────────────────────────────────────────
   Typed on the start screen or in the queue's footer, dragged in
   from another window, or pasted anywhere on the page. */
linkForm.addEventListener('submit', e => {
  e.preventDefault();
  const u = linkInput.value.trim();
  if (u) openLink(u);
});
queueLinkForm.addEventListener('submit', e => {
  e.preventDefault();
  const u = queueLinkInput.value.trim();
  if (u) { queueLinkInput.value = ''; openLink(u); }
});

const linkIn = dt => {
  if (!dt) return null;
  const text = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
  const line = text.split('\n').map(l => l.trim()).find(l => /^https?:\/\//i.test(l));
  return line || null;
};
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  if (dragEl || !e.dataTransfer || ![...e.dataTransfer.types].some(x => x === 'text/uri-list' || x === 'text/plain')) return;
  dragDepth++; dropveil.classList.add('show');
});
window.addEventListener('dragover', e => { if (!dragEl) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropveil.classList.remove('show'); } });
window.addEventListener('drop', e => {
  if (dragEl) return;
  e.preventDefault();
  dragDepth = 0; dropveil.classList.remove('show');
  const u = linkIn(e.dataTransfer);
  if (u) openLink(u);
});
document.addEventListener('paste', e => {
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  const u = ((e.clipboardData && e.clipboardData.getData('text')) || '').trim();
  if (/^https?:\/\//i.test(u)) { e.preventDefault(); openLink(u); }
});

/* ═══════════════ keyboard ═══════════════ */
function onKey(e) {
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (el === seek || el === volBar) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  /* We read e.code, the physical key, rather than the character typed.
     The letters used to be listed in Latin/Cyrillic pairs, and on any
     third layout half the shortcuts fell away: on AZERTY the Q key
     yields "a", on QWERTZ Y and Z are swapped. The physical code is the
     same on every layout, so there is nothing to enumerate. */
  const code = e.code || e.key;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit && duration()) {
    e.preventDefault();
    const n = Number(digit[1]);
    seekTo(duration() * n / 10);
    flash(n * 10 + '%');
    return poke();
  }

  switch (code) {
    case 'Space': case 'KeyK': e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft':  e.preventDefault(); nudge(e.shiftKey ? -1 : -5); break;
    case 'ArrowRight': e.preventDefault(); nudge(e.shiftKey ? 1 : 5); break;
    case 'KeyJ': e.preventDefault(); nudge(-10); break;
    case 'KeyL': e.preventDefault(); nudge(10); break;
    case 'ArrowUp':   e.preventDefault(); video.muted = false; video.volume = Math.min(1, video.volume + .05); flash(Math.round(video.volume * 100) + '%'); break;
    case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - .05); flash(Math.round(video.volume * 100) + '%'); break;
    case 'KeyM': video.muted = !video.muted; break;
    case 'KeyN': next(); break;
    case 'KeyB': prev(); break;
    case 'KeyF': toggleFull(); break;
    case 'KeyP': togglePip(); break;
    case 'KeyQ': toggleQueue(); break;
    case 'Home': e.preventDefault(); seekTo(0); break;
    case 'End':  e.preventDefault(); seekTo(duration() - 2); break;
    case 'Escape':
      if (anyMenuOpen()) closeMenus();
      else if (state.pipWin) state.pipWin.close();
      else if (state.queueOpen) toggleQueue(false);
      break;
  }
  poke();
}
document.addEventListener('keydown', onKey);
document.addEventListener('keyup', e => {
  if (e.key === ' ' && e.target && e.target.tagName === 'BUTTON') e.target.blur();
});

/* ═══════════════ boot ═══════════════ */
(async function boot() {
  video.volume = state.vol;
  document.documentElement.lang = lang;
  applyI18n();
  applySettings();
  paintPlay(); paintVolume(); paintSeek(); paintLoop(); paintAuto(); paintView();
  applyCueStyle(); render();
  btnAudio.hidden = true;
  btnSubs.hidden = true;

  /* what the server remembers: positions, watched episodes and the dub per series */
  try {
    const st = await api('/api/state');
    state.remote = st;
    for (const [k, v] of Object.entries(st.positions || {})) state.positions[k] = { t: v.t, d: v.d || 0 };
    for (const k of Object.keys(st.watched || {})) state.watched[k] = true;
    /* the settings sheet is drawn from these the moment it first opens */
    askHome().catch(() => {}); askCache().catch(() => {}); checkServer();
  } catch (_) { /* the server may be starting */ }

  sessionReady = true;
  paintModeHint();
  fitFoot();
  booted = true;
  paintLoop();
  render();          // the screen can be shown now: it is correct already

  /* The series of the previous session comes back, not started. */
  if (await restoreSession()) toast(t('toast.restored'));
})();

function paintModeHint() {
  modeHint.innerHTML = t('hint.link');
  syncOpenButton();
}

/* the page leaving: the place is sent at once, not after a timer the page would not live to see; pagehide is the event the browsers agree on, beforeunload the older one */
const leaving = () => { if (loaded && video.currentTime) markPos(loaded, video.currentTime, 'now'); };
window.addEventListener('pagehide', leaving);
window.addEventListener('beforeunload', () => { leaving(); if (state.pipWin) state.pipWin.close(); });

})();
