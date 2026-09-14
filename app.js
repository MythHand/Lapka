/* ═══════════════════════════════════════════════════════════
   PIP Player, the player itself
   Two modes: plain file:// and the local ffmpeg server.
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
  try { saved = localStorage.getItem('pip.lang'); } catch (_) {}
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
}

function setLang(code) {
  if (!LANG_DICT[code] || code === lang) return;
  lang = code;
  pluralRules = new Intl.PluralRules(lang);
  langNames = new Intl.DisplayNames([lang], { type: 'language' });
  try { localStorage.setItem('pip.lang', code); } catch (_) {}
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
  syncAudioButton(); syncSubsButton(); syncStatus();
  render();
  closeMenus();
  fitFoot();         // the captions have changed length
}

/* ── dom ─────────────────────────────────────────────────── */
const workspace = $('#workspace'), stageHost = $('#stageHost'), stage = $('#stage');
const video = $('#video'), prober = $('#prober');
const titleName = $('#titleName'), titlePath = $('#titlePath');
const pulseEl = $('#pulse'), pulseIcon = $('#pulseIcon'), flashEl = $('#flash');
const notice = $('#notice'), noticeText = $('#noticeText');
const endCard = $('#endCard'), endMeta = $('#endMeta');
const emptyEl = $('#empty'), modeHint = $('#modeHint');
const prep = $('#prep'), prepName = $('#prepName'), prepTrack = $('#prepTrack');
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
const btnGear = $('#btnGear'), gearMenu = $('#gearMenu');
const queueList = $('#queueList'), queueFiles = $('#queueFiles'), queueTotal = $('#queueTotal');
const btnViewRows = $('#btnViewRows'), btnViewGrid = $('#btnViewGrid');
const ghostName = $('#ghostName'), pipGhost = $('#pipGhost');
const filePick = $('#filePick'), dirPick = $('#dirPick'), favicon = $('#favicon');
const dropveil = $('#dropveil'), toastEl = $('#toast');
const browserModal = $('#browserModal'), helpModal = $('#helpModal');
const brPlaces = $('#brPlaces'), brList = $('#brList'), brPath = $('#brPath');
const btnDisk = $('#btnDisk'), btnEmptyDisk = $('#btnEmptyDisk');
const deckPack = $('#deckPack'), btnPack = $('#btnPack'), queueAdd = $('.queue__add');
const queueEl = $('#queue'), btnLocate = $('#btnLocate');
const MENUS = [audioMenu, pipMenu, rateMenu, subsMenu, gearMenu];

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
  if (deckRight.scrollWidth > room()) deck.classList.add('deck--packed');
  if (!fitLabel(room()) || deckRight.scrollWidth > room()) {
    deck.classList.add('deck--compact');
    /* the last step: the centre leaves the exact middle, and the sides
       share the row by what they hold rather than half and half */
    if (!fitLabel(room()) || deckRight.scrollWidth > room()) deck.classList.add('deck--offcentre');
  }
  if (!deck.classList.contains('deck--packed')) closePack();   // unfolded, the tray is gone with its state
}
/* Shortens the studio name to the room its side has. False when even
   the icon alone leaves the side too wide. */
function fitLabel(room) {
  btnAudio.classList.remove('rb--icon');
  audioLabel.style.maxWidth = '';
  const over = deckLeft.scrollWidth - room;
  if (over <= 0) return true;
  if (btnAudio.hidden) return false;
  const left = audioLabel.getBoundingClientRect().width - over;
  if (left >= fourLetters()) { audioLabel.style.maxWidth = Math.floor(left) + 'px'; return true; }
  btnAudio.classList.add('rb--icon');
  return deckLeft.scrollWidth <= room;
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
  if (tags.length > 1 && tags[tags.length - 1].offsetTop > tags[0].offsetTop)
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
  { key: 'drag', def: 'on', label: 'set.drag',
    opts: [['on', 'common.on'], ['off', 'common.off']] },
  { key: 'follow', def: 'on', label: 'set.follow',
    opts: [['on', 'common.on'], ['off', 'common.off']] },
  { key: 'hideUi', def: 'off', label: 'set.hideUi',
    opts: [['on', 'common.on'], ['off', 'common.off']] },
  { key: 'font', def: 'fixel', label: 'set.font',
    opts: [['fixel', 'set.font.fixel'], ['inter', 'set.font.inter']] },
];
const SETTINGS_V = '5';   // the defaults changed, so what was saved is dropped

function loadSettings() {
  try {
    if (localStorage.getItem('pip.set.v') !== SETTINGS_V) {
      for (const s of SETTINGS) localStorage.removeItem('pip.' + s.key);
      localStorage.removeItem('pip.autoUi');          // keys from earlier versions
      localStorage.removeItem('pip.pipMode');
      localStorage.removeItem('nocturne.pipMode');
      localStorage.setItem('pip.set.v', SETTINGS_V);
    }
  } catch (_) { /* private mode, so just take the defaults */ }

  const out = {};
  for (const s of SETTINGS) {
    let v = null;
    try { v = localStorage.getItem('pip.' + s.key); } catch (_) {}
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

const SESSION_V = 1;
const POS_KEEP = 200;      // how many files we remember positions for
const POS_MIN = 30;        // before the thirtieth second there is nowhere to return to
const POS_TAIL = 60;       // and not to the very end either: the file is finished

let posMap = readStore('pip.pos', {});

function markPos(path, sec) {
  if (!path || !isFinite(sec)) return;
  const d = duration();
  if (sec < POS_MIN || (d && sec > d - POS_TAIL)) { delete posMap[path]; }
  else posMap[path] = Math.round(sec);
  const keys = Object.keys(posMap);
  if (keys.length > POS_KEEP) for (const k of keys.slice(0, keys.length - POS_KEEP)) delete posMap[k];
  writeStore('pip.pos', posMap);
  for (const li of queueList.children) {
    const it = byId(li.dataset.id);
    if (it && it.path === path) paintPos(li, it);
  }
}

/* Where watching stopped, drawn as a bar on the file's frame, in the
   rows and in the tiles alike. Only what the player would return to is
   drawn: the first half minute and the last minute are not kept, so a
   finished episode has no bar. */
function paintPos(li, it) {
  const at = it.path ? posMap[it.path] : null, d = it.dur;
  const f = at && d ? Math.min(1, at / d) : 0;
  li.classList.toggle('has-pos', f > 0);
  li.style.setProperty('--pos', f.toFixed(4));
}

/* A row's frame takes the proportions of the file: known from the probe,
   or from the frame itself once it has loaded. Until then the box is
   16:9, the common case. */
function paintShape(li, it) {
  const box = li.querySelector('.item__thumb');
  if (box && it.aspect) box.style.aspectRatio = String(it.aspect);
}

let saveT = null;
let sessionReady = false;   // nothing is written until boot ends: the list is still empty
function saveSession() {
  if (!sessionReady) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const items = state.list.filter(i => i.kind === 'server')
      .map(i => ({ name: i.name, path: i.path, size: i.size, dur: i.dur }));
    if (!items.length) { try { localStorage.removeItem('pip.session'); } catch (_) {} return; }
    writeStore('pip.session', {
      v: SESSION_V, items, loop: state.loop,
      audioPref: state.audioPref, subPref: state.subPref,
      current: cur() ? cur().path : null,
    });
  }, 500);
}

/* The queue comes back, playback does not. The browser would block
   autoplay without a click anyway, and the server would have to start
   an ffmpeg pass just because a tab was opened. */
function restoreSession() {
  const ses = readStore('pip.session', null);
  if (!ses || ses.v !== SESSION_V || !Array.isArray(ses.items) || !ses.items.length) return 0;
  for (const e of ses.items) {
    if (!e || !e.path) continue;
    state.list.push({
      id: ++state.seq, kind: 'server', name: e.name, path: e.path,
      size: e.size || 0, dur: e.dur || null, err: false, tracks: null, audioIndex: null,
      subs: null, subIndex: null, probed: false,
      audioPicked: false, subPicked: false,
    });
  }
  if (ses.loop === 'queue' || ses.loop === 'one') state.loop = ses.loop;
  if (ses.audioPref) state.audioPref = ses.audioPref;
  if (ses.subPref) state.subPref = ses.subPref;
  /* The file we stopped on is marked current but not opened: otherwise
     opening a tab would start an ffmpeg pass. The source is supplied by
     the first press of play, see togglePlay. */
  const back = ses.current && state.list.find(i => i.path === ses.current);
  if (back) { state.current = back; paintTitle(); }
  return state.list.length;
}

/* ── state ─────────────────────────────────────────────────── */
const state = {
  list: [], current: null,
  loop: 'off', queueOpen: true,
  autoplay: strFromStore('pip.autoplay', '1') !== '0',
  audioPref: null,   // the track chosen by hand, carried to the next files
  subPref: null,     // the same for subtitles; null means off
  set: loadSettings(),   // the player settings, see SETTINGS
  cue: {             // subtitle styling, all within what ::cue can do
    size: strFromStore('pip.cue.size', 'm'),
    bg:   strFromStore('pip.cue.bg', 'shadow'),
    pos:  strFromStore('pip.cue.pos', 'auto'),
  },
  pipWin: null, errStreak: 0, seq: 0,
  vol: numFromStore('pip.vol', 1, 0, 1),   // volume survives a reload
  server: null,            // the answer from /api/ping, or null
  busy: false,             // a file is being prepared, the favicon shows it
  seekPreview: null,       // the position shown while seeking
  browserDir: null,
  view: strFromStore('pip.view', 'rows') === 'grid' ? 'grid' : 'rows',
  /* the browser one by default: it has no address bar on top */
  pipMode: strFromStore('pip.pipMode', 'native'),
};

/* A link to the source in the empty queue. An empty string hides it,
   which is better than a broken address. */
const REPO = 'https://github.com/MythHand/PIP-Player';

const MEDIA_EXT = /\.(mp4|m4v|webm|ogv|ogm|mov|mkv|avi|ts|m2ts|mts|mpg|mpeg|3gp|flv|wmv|divx|mp3|m4a|m4b|aac|flac|wav|opus|oga)$/i;
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
const fmtSize = b => b >= 1073741824
  ? t('units.gb', { n: (b / 1073741824).toFixed(1) })
  : t('units.mb', { n: Math.round(b / 1048576) });

let toastT;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 3000);
}
const idxOf = it => state.list.indexOf(it);
const byId = id => state.list.find(x => String(x.id) === String(id));
/* the second line under the title: where the file sits */
function folderOf(it) {
  const p = it.kind === 'server' ? it.path : (it.path || it.name);
  const dir = p.slice(0, p.lastIndexOf('/'));
  return dir || (it.kind === 'server' ? '' : t('queue.picked'));
}
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

/* ── the server preparing a file ──────────────────────────────
   One ffmpeg pass per file and track, the result goes into the cache.
   While it runs, the progress is shown. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* stop playback completely: not only pause but also dropping the
   source, otherwise the previous track is heard behind the overlay */
function stopPlayback() {
  if (!video.getAttribute('src')) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

/* There is deliberately no progress bar: encoding reports percentages,
   but the faststart phase that follows rewrites the whole file and
   reports nothing, so a bar would freeze at 100 % there. What is shown
   is the steps themselves and the command being run. */
const PREP_STEPS = ['prep.probe', 'prep.convert', 'prep.finalize'];

function trackLabel(it) {
  const tr = (it.tracks || []).find(x => x.index === it.audioIndex);
  if (!tr) return '';
  const name = langName(tr.lang), title = (tr.title || '').trim();
  const head = name && title ? `${name} · ${title}`
             : name || title || t('audio.trackN', { n: tr.order + 1 });
  return [head, tr.codec.toUpperCase(), channelsLabel(tr.channels, tr.layout)].filter(Boolean).join(' · ');
}

function showProgress(it, info) {
  closeMenus();
  prepName.textContent = it.name;
  const lab = trackLabel(it);
  prepTrack.textContent = lab ? t('prep.track', { name: lab }) : '';

  const phase = info.phase || 'convert';
  const order = ['probe', 'convert', 'finalize'];
  const now = order.indexOf(phase);

  prepSteps.replaceChildren();
  PREP_STEPS.forEach((key, i) => {
    const done = i < now, active = i === now;
    const li = document.createElement('li');
    li.className = 'step' + (done ? ' step--done' : active ? ' step--active' : '');
    const mark = done ? '✓' : active ? '' : '';
    li.innerHTML = `<span class="step__mark">${mark}</span><span class="step__text"></span><span class="step__aux"></span>`;
    li.querySelector('.step__text').textContent = t(key);
    /* no percentages: faststart reports no progress and any number
       would stick there. Only the elapsed time is shown. */
    if (active && info.elapsed) li.querySelector('.step__aux').textContent = fmt(info.elapsed / 1000);
    prepSteps.append(li);
  });

  prepCmd.textContent = info.cmd || '';
  prep.classList.add('show');
  state.busy = true;
  paintFavicon();
}
function hideProgress() {
  prep.classList.remove('show');
  state.busy = false;
  paintFavicon();
}

function prepareQuery(it) {
  const q = new URLSearchParams({ path: it.path });
  if (it.audioIndex != null) q.set('a', String(it.audioIndex));
  return q.toString();
}

async function ensureReady(it) {
  for (;;) {
    let r;
    try { r = await (await fetch('/api/prepare?' + prepareQuery(it))).json(); }
    catch (_) { hideProgress(); toast(t('toast.bridgeDown')); return null; }

    if (r.duration) it.dur = r.duration;
    if (r.state === 'ready' || r.state === 'direct') { hideProgress(); return r; }
    if (r.state === 'error' || r.error) {
      hideProgress();
      it.err = true; render();
      toast(t('toast.prepFail', { name: it.name }));
      return null;
    }
    stopPlayback();          // the previous track must not play on behind the overlay
    showProgress(it, r);
    await sleep(600);
    if (it !== cur()) { hideProgress(); return null; }
  }
}

/* The next file is prepared while the current one plays. Its tracks are
   probed first: without that the server would take the default track and
   a whole pass would be wasted if the choice was carried over from the
   previous file. */
async function prefetchNext() {
  const nx = state.list[idxOf(cur()) + 1];
  if (!nx || nx.kind !== 'server') return;
  await probeItem(nx);
  resolveTracks(nx);
  fetch('/api/prepare?' + prepareQuery(nx)).catch(() => {});
}

async function sourceFor(it) {
  if (it.kind === 'local') return it.url;
  /* the track is chosen BEFORE preparing: otherwise the server spends a
     whole pass on the default one while the carried over track is what
     is wanted */
  await probeItem(it);
  resolveTracks(it);
  if (it.carried) {
    it.carried = false;
    const tr = (it.tracks || []).find(x => x.index === it.audioIndex);
    if (tr) toast(t('toast.carried', { name: tr.title || langName(tr.lang) }));
  }
  const r = await ensureReady(it);
  if (!r) return null;
  /* the probe answers for the default track; another track can turn a
     file that played as it is into one that goes through ffmpeg */
  if (it.direct !== (r.state === 'direct')) { it.direct = r.state === 'direct'; paintMeta(); }
  return r.state === 'direct'
    ? '/api/raw?path=' + encodeURIComponent(it.path)
    : '/api/media?key=' + r.key;
}

/* ═══════════════ adding files ═══════════════ */
function addLocalFiles(files) {
  const ok = [];
  for (const f of files) {
    if (!f) continue;
    if (/^(video|audio)\//.test(f.type) || MEDIA_EXT.test(f.name)) ok.push(f);
  }
  if (!ok.length) { toast(t('toast.noMedia')); return; }
  ok.sort((a, b) => collator.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));

  const wasEmpty = !state.list.length;
  for (const f of ok) {
    state.list.push({
      id: ++state.seq, kind: 'local', file: f, name: f.name,
      path: f.webkitRelativePath || f.name, url: URL.createObjectURL(f),
      size: f.size, dur: null, err: false, tracks: null, audioIndex: null,
    });
  }
  const added = state.list.slice(-ok.length);
  render(); probeLocal();
  toast(t('toast.added', { n: ok.length }));
  if (wasEmpty) playItem(state.list[0]);
  resolveOnDisk(added);            // in server mode, hand them over at once
}

function addServerFiles(entries) {
  if (!entries.length) { toast(t('toast.emptyFolder')); return; }
  const wasEmpty = !state.list.length;
  for (const e of entries) {
    state.list.push({
      id: ++state.seq, kind: 'server', name: e.name, path: e.path,
      size: e.size || 0, dur: null, err: false, tracks: null, audioIndex: null,
      subs: null, subIndex: null, probed: false,
      audioPicked: false, subPicked: false,
    });
  }
  render(); probeServer();
  toast(t('toast.added', { n: entries.length }));
  if (wasEmpty) playItem(state.list[0]);
}

async function walkEntry(entry, out) {
  if (!entry) return;
  if (entry.isFile) await new Promise(r => entry.file(f => { out.push(f); r(); }, r));
  else if (entry.isDirectory) {
    const rd = entry.createReader();
    for (;;) {
      const batch = await new Promise(r => rd.readEntries(r, () => r([])));
      if (!batch.length) break;
      for (const e of batch) await walkEntry(e, out);
    }
  }
}

/* ── durations of local files ──────────────────────────────── */
let probingLocal = false;
function probeLocal() {
  if (probingLocal) return;
  const it = state.list.find(i => i.kind === 'local' && i.dur === null && !i.err);
  if (!it) return;
  probingLocal = true;
  const fin = () => { probingLocal = false; paintMeta(); probeLocal(); };
  prober.addEventListener('loadedmetadata', () => {
    it.dur = isFinite(prober.duration) ? prober.duration : 0;
    if (prober.videoWidth && prober.videoHeight) it.aspect = prober.videoWidth / prober.videoHeight;
    fin();
  }, { once: true });
  prober.addEventListener('error', () => { it.dur = 0; fin(); }, { once: true });
  prober.src = it.url;
}

/* ── the chosen track carries to the next files ───────────────
   First we try a full match of the track set: episodes from one release
   have the same one, and then taking the track at the same index is
   enough. After that, language plus studio name, then language alone. */
const trackSig = ts => ts.map(x => `${x.lang}|${(x.title || '').trim()}|${x.codec}|${x.channels}`).join('/');
const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

function rememberTrack(it, index) {
  const tr = (it.tracks || []).find(x => x.index === index);
  if (!tr) return;
  state.audioPref = { sig: trackSig(it.tracks), order: tr.order, lang: tr.lang, title: tr.title };
}

function preferredTrack(it) {
  const p = state.audioPref;
  if (!p || !it.tracks || !it.tracks.length) return null;
  if (p.sig === trackSig(it.tracks) && it.tracks[p.order]) return it.tracks[p.order].index;
  const byBoth = it.tracks.find(x => same(x.lang, p.lang) && same(x.title, p.title));
  if (byBoth) return byBoth.index;
  const byLang = it.tracks.find(x => same(x.lang, p.lang));
  return byLang ? byLang.index : null;
}

/* ── ffprobe for server side files ────────────────────────────
   Reading the file, nothing else. Choosing the tracks is deliberately
   not part of this, see resolveTracks. */
async function probeItem(it) {
  if (it.probed) return;
  if (it.probing) return it.probing;        // a probe is already running, wait for it
  it.probing = (async () => {
  try {
    const r = await fetch('/api/probe?path=' + encodeURIComponent(it.path));
    if (r.ok) {
      const info = await r.json();
      it.dur = info.duration;
      it.tracks = info.audio;
      it.defaultAudio = info.defaultAudio;
      it.videoCodec = info.video ? info.video.codec : null;
      if (info.video && info.video.width && info.video.height) it.aspect = info.video.width / info.video.height;
      it.direct = !!(info.plan && info.plan.direct);   // served as it is, ffmpeg not involved
      it.subs = info.subs || [];
    }
  } catch (_) { /* the server may be gone, which is fine */ }
  it.probed = true;
  })();
  await it.probing;
  it.probing = null;
}

/* ── which track is playing ───────────────────────────────────
   Probing a file and choosing a track are different things, and they
   used to be fused inside probeItem. The whole queue is probed right
   after files are added, which meant every file got a choice before the
   user had made one; after that the probed flag was set and carrying
   the choice to later episodes never worked again, because the player
   held on to what it had decided at the moment of adding.

   So the choice is recomputed before every playback and pinned to a
   file only once it has been set by hand. */
function resolveTracks(it) {
  if (!it || it.kind !== 'server' || !it.probed) return;

  if (!it.audioPicked) {
    const want = preferredTrack(it);
    const pick = want != null ? want : it.defaultAudio;
    it.carried = want != null && want !== it.defaultAudio && want !== it.audioIndex;
    it.audioIndex = pick;
  }
  if (!it.subPicked) it.subIndex = preferredSub(it);
}

let probingServer = false;
async function probeServer() {
  if (probingServer) return;
  const it = state.list.find(i => i.kind === 'server' && !i.probed);
  if (!it) return;
  probingServer = true;
  await probeItem(it);
  probingServer = false;
  paintMeta();
  if (it === cur()) { resolveTracks(it); syncAudioButton(); syncSubsButton(); }
  probeServer();
}

/* ═══════════════ handing local files to the server ═══════════════
   The browser does not give the absolute path of a dropped file. We ask
   the server to find it by name and size, and pick the rest of the batch
   out of the same directory, so one or two requests cover a whole
   folder. */
/* Directories where files have already been found. They go to the
   server as a hint: the next batch from the same folder costs one stat
   instead of a sweep through the whole home folder. */
const DIR_KEEP = 12;
let knownDirs = readStore('pip.dirs', []);
function rememberDir(dir) {
  if (!dir) return;
  knownDirs = [dir, ...knownDirs.filter(d => d !== dir)].slice(0, DIR_KEEP);
  writeStore('pip.dirs', knownDirs);
}

async function resolveOnDisk(items, { loud } = {}) {
  if (!state.server || !state.server.ffmpeg) return 0;
  const pending = items.filter(i => i.kind === 'local');
  if (!pending.length) return 0;

  if (loud) toast(t('toast.seeking'));
  let found = 0;
  /* whether the current file already plays from the browser's copy; asked
     before the upgrade below, which forgets what was loaded */
  const c0 = cur(), started = !!(c0 && pending.includes(c0) && c0.loadedSrc);

  try {
    const probe = pending[0];
    const q = new URLSearchParams({ name: probe.name, size: String(probe.size || '') });
    for (const d of knownDirs) q.append('dir', d);
    const r = await fetch('/api/find?' + q);
    const hit = r.ok ? (await r.json()).matches[0] : null;
    if (!hit) { if (loud) toast(t('toast.notFound')); return 0; }

    upgradeItem(probe, hit);
    rememberDir(hit.dir);
    found++;

    if (pending.length > 1) {
      const ls = await fetch('/api/ls?path=' + encodeURIComponent(hit.dir));
      const dir = ls.ok ? await ls.json() : null;
      if (dir && dir.files) {
        const byName = new Map(dir.files.map(f => [f.name, f]));
        for (const it of pending.slice(1)) {
          const m = byName.get(it.name);
          if (m) { upgradeItem(it, m); found++; }
        }
      }
    }
  } catch (_) { if (loud) toast(t('toast.noAnswer')); return found; }

  if (found) {
    render();
    const c = cur();
    /* A file that already plays goes on from the same moment, now through
       the server. One that is still starting is started over: the search
       answers within the 0.22 s of the fade, the start it overtook gave up
       without bringing the picture back, and the video stayed dark and
       paused. */
    if (c && pending.includes(c) && c.kind === 'server') { if (c === c0 && started) switchTrack(c); else playItem(c); }
    probeServer();
    hideNotice();
    toast(found === 1 ? t('toast.handedOne') : t('toast.handedN', { n: found }));
  } else if (loud) toast(t('toast.noMatch'));
  return found;
}

function upgradeItem(it, hit) {
  /* The browser's copy of the file playing now is still being read by the
     video; it is let go once the server's version is in (loadSource). */
  if (it.url) {
    if (it === cur() && it.loadedSrc === it.url) it.staleUrl = it.url;
    else URL.revokeObjectURL(it.url);
    it.url = null;
  }
  const localKey = it.path;          // a dropped file is kept by its name
  it.kind = 'server';
  it.path = hit.path;
  /* the place kept while the browser played it moves to the path on disk */
  if (localKey && posMap[localKey] != null) {
    if (posMap[it.path] == null) posMap[it.path] = posMap[localKey];
    delete posMap[localKey];
    writeStore('pip.pos', posMap);
  }
  it.size = hit.size || it.size;
  it.probed = false;
  it.audioIndex = null;
  it.audioPicked = false;
  it.subIndex = null;
  it.subPicked = false;
  it.err = false;
  it.file = null;
  it.loadedSrc = null;
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
  state.current = it;
  state.seekPreview = null;
  hideNotice();
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
  const src = await sourceFor(it);
  const reveal = fadeIn();
  if (token !== playToken || it !== cur() || !src) { autoSwitch = false; reveal(); return; }

  await faded;                       // let the fade finish
  if (token !== playToken || it !== cur()) return;

  /* returning to the last position: only if the file was left in the
     middle, and only once per start, after that it is ordinary
     watching */
  const back = posMap[it.path];
  loadSource(it, src, token, () => {
    const d = duration();
    if (back == null || back < POS_MIN || (d && back > d - POS_TAIL)) return;
    video.currentTime = back;
    toast(t('toast.resume', { time: fmt(back) }));
  }, autoplay);
  syncAudioButton(); syncSubsButton(); applySubs(it);
  armAudioCheck(); prefetchNext();
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
  it.loadedSrc = src;
  video.src = src;
  video.load();
  if (it.staleUrl) { URL.revokeObjectURL(it.staleUrl); it.staleUrl = null; }
  const reveal = fadeIn();
  video.addEventListener('loadeddata', reveal, { once: true });
  setTimeout(reveal, 4000);          // a fallback in case the frame never arrives
  video.addEventListener('loadedmetadata', () => { if (token === playToken) onMeta(); }, { once: true });
  if (play) video.play().catch(() => {});
}

/* changing the track: a different prepared file, the same position */
async function switchTrack(it) {
  /* a file still starting counts as playing: the start meant to play it */
  const at = video.currentTime, playing = !video.paused || !it.loadedSrc;
  const token = ++playToken;
  const src = await sourceFor(it);
  if (token !== playToken || it !== cur() || !src) return;
  loadSource(it, src, token, () => { video.currentTime = at; }, playing);
  syncAudioButton(); syncSubsButton(); applySubs(it);
  prefetchNext();          // the next file is prepared with the new choice
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

/* ═══════════════ audio tracks ═══════════════ */
function audioOptions() {
  const it = cur();
  if (!it) return [];
  if (it.kind === 'server' && it.tracks && it.tracks.length) {
    return it.tracks.map(tr => {
      const name = langName(tr.lang);
      const title = (tr.title || '').trim();
      /* Studio names are exactly what tells several dubs in one language
         apart, so they go on the first line next to it. */
      const main = name && title ? `${name} · ${title}`
                 : name || title || t('audio.trackN', { n: tr.order + 1 });
      const sub = [
        `#${tr.order + 1}`,
        tr.codec.toUpperCase(),
        channelsLabel(tr.channels, tr.layout),
        tr.bitrate ? t('units.kbps', { n: Math.round(tr.bitrate / 1000) }) : '',
        tr.sampleRate ? t('units.khz', { n: +(tr.sampleRate / 1000).toFixed(1) }) : '',
        tr.default ? t('audio.default') : '',
        tr.forced ? t('audio.forced') : '',
        tr.comment ? t('audio.comment') : '',
      ].filter(Boolean).join(' · ');
      return { id: tr.index, main, sub, short: title || name || `#${tr.order + 1}`,
               sel: tr.index === it.audioIndex };
    });
  }
  const nat = video.audioTracks;
  if (nat && nat.length) {
    const out = [];
    for (let i = 0; i < nat.length; i++) {
      out.push({
        id: i, native: true,
        main: langName(nat[i].language) || nat[i].label || t('audio.trackN', { n: i + 1 }),
        sub: nat[i].label || '',
        sel: nat[i].enabled,
      });
    }
    return out;
  }
  return [];
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

function buildAudioMenu() {
  const opts = audioOptions();
  audioMenu.replaceChildren();
  const head = document.createElement('div');
  head.className = 'menu__title';
  head.textContent = t('audio.title');
  audioMenu.append(head);

  if (!opts.length) {
    const e = document.createElement('div');
    e.className = 'menu__empty';
    e.textContent = t(state.server ? 'audio.one' : 'audio.serverOnly');
    audioMenu.append(e);
    return;
  }

  for (const o of opts) {
    const b = document.createElement('button');
    b.className = 'menu__item' + (o.sel ? ' sel' : '');
    b.innerHTML = `<span class="menu__tick">${phSvg(PH.check)}</span>
      <span class="menu__body"><span class="menu__main"></span>${o.sub ? '<span class="menu__sub"></span>' : ''}</span>`;
    b.querySelector('.menu__main').textContent = o.main;
    if (o.sub) b.querySelector('.menu__sub').textContent = o.sub;
    b.onclick = () => { pickAudio(o); markPicked(b); };
    audioMenu.append(b);
  }
}

function pickAudio(opt) {
  const it = cur();
  if (!it) return;
  if (opt.native) {
    const nat = video.audioTracks;
    for (let i = 0; i < nat.length; i++) nat[i].enabled = i === opt.id;
    syncAudioButton();
    toast(t('audio.current', { name: opt.main }));
    return;
  }
  if (it.audioIndex === opt.id) return;
  it.audioIndex = opt.id;
  it.audioPicked = true;          // for this file the choice was made by hand
  it.carried = false;
  rememberTrack(it, opt.id);
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
  if (!it || it.kind !== 'server' || !it.subs) return [];
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
    e.textContent = t(state.server ? 'subs.none' : 'subs.serverOnly');
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

/* the track is attached to video as a separate track element */
async function applySubs(it) {
  video.querySelectorAll('track').forEach(x => x.remove());
  if (!it || it.subIndex == null || it.kind !== 'server') return;

  const url = `/api/subs?path=${encodeURIComponent(it.path)}&s=${it.subIndex}`;
  try {
    /* fetched in advance so an error can be caught and shown, not swallowed */
    const r = await fetch(url);
    if (!r.ok) { toast(t('subs.fail')); it.subIndex = null; syncSubsButton(); return; }
  } catch (_) { return; }
  if (it !== cur() || it.subIndex == null) return;

  const el = document.createElement('track');
  el.kind = 'subtitles';
  el.src = url;
  el.default = true;
  video.append(el);
  /* switched on after the browser has parsed the file */
  el.addEventListener('load', () => {
    if (el.track) el.track.mode = 'showing';
    applyCueLine();
  }, { once: true });
  setTimeout(() => { if (el.track) { el.track.mode = 'showing'; applyCueLine(); } }, 200);
}

/* What can actually be controlled in WebVTT: size, backdrop and line
   height. Everything else, the cue font, the horizontal position, ASS
   styling, is set by the file itself and the browser does not expose
   it. */
const CUE_SIZE = { s: '80%',  m: '100%', l: '128%', xl: '160%' };
const CUE_BG = {
  none:   { bg: 'transparent', sh: 'none' },
  shadow: { bg: 'transparent', sh: '0 1px 3px #000, 0 0 6px rgba(0,0,0,.95), 0 0 1px #000' },
  plate:  { bg: 'rgba(0,0,0,.72)', sh: 'none' },
};
const CUE_POS = { low: -1, auto: 'auto', high: -4 };

const CUE_UI = [
  /* S/M/L/XL are not translated: the letters read the same everywhere */
  { key: 'size', label: 'cue.size', opts: [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']] },
  { key: 'bg',   label: 'cue.bg',   opts: [['none', 'cue.bg.none'], ['shadow', 'cue.bg.shadow'], ['plate', 'cue.bg.plate']] },
  { key: 'pos',  label: 'cue.pos',  opts: [['low', 'cue.pos.low'], ['auto', 'cue.pos.auto'], ['high', 'cue.pos.high']] },
];

function applyCueStyle() {
  const c = state.cue, b = CUE_BG[c.bg] || CUE_BG.shadow;
  /* the variables go on the video element itself: it is what moves into
     the extended PiP window, and variables set on the document would
     stay behind in the tab */
  video.style.setProperty('--cue-size', CUE_SIZE[c.size] || '100%');
  video.style.setProperty('--cue-bg', b.bg);
  video.style.setProperty('--cue-shadow', b.sh);
  applyCueLine();
}

function applyCueLine() {
  const v = CUE_POS[state.cue.pos];
  for (const tr of video.textTracks || []) {
    if (!tr.cues) continue;
    for (const cue of tr.cues) { try { cue.line = v; } catch (_) {} }
  }
}

function setCue(key, val) {
  state.cue[key] = val;
  saveStr('pip.cue.' + key, val);
  applyCueStyle();
  buildSubsMenu();
}

/* Label on top, options below it across the full width: on one line
   they did not fit and overlapped each other. */
function segRow(menu, label, current, opts, pick) {
  const line = document.createElement('div');
  line.className = 'menu__row';
  const lab = document.createElement('span');
  lab.className = 'menu__rowlabel';
  lab.textContent = label;
  const group = document.createElement('div');
  group.className = 'seg2';
  for (const [val, text] of opts) {
    const b = document.createElement('button');
    b.textContent = text;
    b.className = current === val ? 'sel' : '';
    b.onclick = ev => { ev.stopPropagation(); pick(val); };
    group.append(b);
  }
  line.append(lab, group);
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
const KEYS_UI = [
  [['Space', 'K'],   'keys.play'],
  [['←', '→'],       'keys.seek5'],
  [['⇧ ←', '⇧ →'],   'keys.seek1'],
  [['J', 'L'],       'keys.seek10'],
  [['↑', '↓'],       'keys.volume'],
  [['0–9'],          'keys.jump'],
  [['Home', 'End'],  'keys.edges'],
  [['B', 'N'],       'keys.nextPrev'],
  [['M'],            'keys.mute'],
  [['P'],            'keys.pip'],
  [['F'],            'keys.full'],
  [['Q'],            'keys.queue'],
  [['Esc'],          'keys.esc'],
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
  const src = cur() && cur().loadedSrc;
  const m = src && /\/api\/media\?key=([a-f0-9]+)/.exec(src);
  return m ? m[1] : '';
}

const GB = 1024 ** 3;

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
  const take = answer => { d = answer; limitGb = Math.round(d.limit / GB); paint(); };

  fetch('/api/cache').then(r => r.json()).then(take)
    .catch(() => { size.textContent = t('set.cacheFail'); });

  const gbAt = ratio => Math.min(hiGb(), Math.max(loGb(), Math.round(ratio * scale() / GB)));
  let sent = null;
  const commit = async () => {
    if (!d || limitGb === Math.round(d.limit / GB)) return;
    const want = limitGb;
    sent = want;
    try {
      const r = await fetch('/api/cache/limit?gb=' + want, { method: 'POST', headers: { 'x-pip': '1' } });
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
        { method: 'POST', headers: { 'x-pip': '1' } });
      const answer = await r.json();
      take(answer);
      toast(t('toast.cacheCleared', { size: fmtSize(answer.freed.bytes) }));
    } catch (_) { toast(t('set.cacheFail')); }
  };
}

/* Three columns: keys, settings, languages. Languages need only a
   narrow strip, one word per row; keys need one of their own, because a
   caption next to a key reads only when both are on the same line. The
   widths live in menu--gear, this is the content alone. */
function buildGearMenu() {
  gearMenu.replaceChildren();
  gearMenu.classList.add('menu--split', 'menu--gear');

  const keys = document.createElement('div');
  keys.className = 'menu__col menu__col--keys';
  menuTitle(keys, t('keys.head'));
  for (const [caps, key] of KEYS_UI) {
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
    keys.append(row);
  }

  const langs = document.createElement('div');
  langs.className = 'menu__col menu__col--side';
  menuTitle(langs, t('set.lang'));
  for (const [code, name] of LANG_LIST) {
    const b = document.createElement('button');
    b.className = 'menu__item' + (code === lang ? ' sel' : '');
    b.innerHTML = `<span class="menu__tick">${phSvg(PH.check)}</span>
      <span class="menu__body"><span class="menu__main"></span></span>`;
    b.querySelector('.menu__main').textContent = name;
    b.onclick = ev => {
      ev.stopPropagation();
      setLang(code);                    // repaints everything and closes the menus
      buildGearMenu();
      gearMenu.classList.add('open');   // but the language list stays open
    };
    langs.append(b);
  }

  const opts = document.createElement('div');
  opts.className = 'menu__col';
  menuTitle(opts, t('set.head'));
  for (const row of SETTINGS) {
    segRow(opts, t(row.label), state.set[row.key],
           row.opts.map(([val, key]) => [val, t(key)]), val => {
      state.set[row.key] = val;
      try { localStorage.setItem('pip.' + row.key, val); } catch (_) {}
      applySettings();
      buildGearMenu();
    });
  }
  if (state.server && state.server.ffmpeg) cacheRow(opts);

  gearMenu.append(keys, opts, langs);
}

btnGear.onclick = e => {
  e.stopPropagation();
  buildGearMenu();
  closeMenus(gearMenu);
  gearMenu.classList.toggle('open');
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

/* ── diagnosing "there is no sound" ────────────────────────── */
let audioCheckT;
function armAudioCheck() {
  clearTimeout(audioCheckT);
  audioCheckT = setTimeout(() => {
    const it = cur();
    if (!it || video.paused) return;
    const decoded = video.webkitAudioDecodedByteCount;
    if (decoded === undefined || decoded > 0) return;
    if (it.kind === 'server') return;   // the server has already re-encoded the audio
    showNotice(t(
      state.server && state.server.ffmpeg && it.kind === 'local' ? 'notice.direct'
      : state.server ? 'hint.noFfmpeg'   // without ffprobe there is no track list to pick from
      : 'notice.codec'));
  }, 3500);
}
function showNotice(text) {
  noticeText.textContent = text;
  const canBridge = state.server && state.server.ffmpeg && cur() && cur().kind === 'local';
  $('#noticeAction').textContent = t(canBridge ? 'notice.bridge' : 'notice.fix');
  notice.classList.add('show');
}
function hideNotice() { notice.classList.remove('show'); clearTimeout(audioCheckT); }
$('#noticeClose').onclick = hideNotice;
$('#noticeAction').onclick = () => {
  const it = cur();
  if (state.server && state.server.ffmpeg && it && it.kind === 'local') resolveOnDisk([it], { loud: true });
  else helpModal.classList.add('open');
};

/* ═══════════════ queue ═══════════════ */
function render() {
  saveSession();          // the list only changes through render, so catch it here
  queueFiles.textContent = t('queue.count', { n: state.list.length });
  const grid = state.view === 'grid';
  queueList.classList.toggle('queue__list--grid', grid && state.list.length > 0);
  queueEl.classList.toggle('queue--empty', !state.list.length);
  btnLocate.hidden = !cur() || !state.list.length;
  syncQueueClose();

  if (!state.list.length) {
    queueList.replaceChildren(aboutBlock());
    queueTotal.textContent = '0:00:00';
    stage.classList.add('is-empty');
    if (booted) emptyEl.classList.remove('hide');
    syncStatus();
    return;
  }
  stage.classList.remove('is-empty');

  const frag = document.createDocumentFragment();
  for (const it of state.list) frag.append(grid ? tileFor(it) : rowFor(it));
  queueList.replaceChildren(frag);
  paintMeta();
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
function paintActive() {
  const kids = [...queueList.children];
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

/* ── the project description in an empty queue ────────────────
   The order here carries meaning and is not accidental. At the top,
   what the person needs right now: the queue is empty, drop files in.
   Then, past the divider, what the player is: a heading, prose with a
   link to the source at the end of the first paragraph, then the
   feature list under a heading of its own. The groups of the list run
   by importance to the goal: first what the whole thing was started
   for, then what it cannot work without, and only at the end the
   trimmings. */
const FEAT_GROUPS = [
  ['pip', 3],       // why the project exists
  ['audio', 5],     // without a track choice a release cannot be watched
  ['bridge', 7],    // what makes any of it play at all
  ['play', 8],      // the mechanics of watching a series
  ['ui', 6],        // the trimmings
];

function aboutBlock() {
  const li = document.createElement('li');
  li.className = 'queue__about';
  /* Prose, then the note about MKV, then the list. The AC-3 paragraph
     covers one particular case, so it is not in the main flow but a
     separate note at the end of the description. */
  li.innerHTML =
    '<p class="queue__drop"></p>' +
    '<hr class="queue__rule">' +
    '<h2></h2>' +
    '<p class="queue__lede"></p>' +
    '<p class="queue__lede"></p>' +
    '<aside class="queue__case"></aside>' +
    '<h3 class="queue__featshead"></h3>' +
    '<div class="queue__feats"></div>';

  li.querySelector('.queue__drop').innerHTML = t('queue.empty');
  li.querySelector('h2').textContent = t('about.lead');
  li.querySelector('.queue__case').textContent = t('about.p2');
  li.querySelector('.queue__featshead').textContent = t('about.feats');

  const ps = li.querySelectorAll('.queue__lede');
  ps[0].textContent = t('about.p1');
  ps[1].textContent = t('about.p3');

  /* the link is the tail of the first paragraph, not a line of its own */
  if (REPO) {
    const a = document.createElement('a');
    a.className = 'queue__repo';
    a.href = REPO;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = `<span></span>${phSvg(PH.linkOut)}`;
    a.querySelector('span').textContent = t('about.repo');
    ps[0].append(' ', a);
  }

  /* The keys come in families, feat.<group> and feat.<group>.N; listing
     them one by one would mean keeping the list in two places.

     A point can have points of its own, feat.<group>.N.M. They belong to
     that point and not to the group: hotkeys in the floating window and
     the address bar are about the extended mode, so they sit under it
     instead of standing as equals next to it. The English dictionary is
     the full set of keys, so it decides whether a sub-point exists. */
  const feats = li.querySelector('.queue__feats');
  const has = key => LANG_DICT.en[key] !== undefined;
  for (const [group, n] of FEAT_GROUPS) {
    const h = document.createElement('h4');
    h.textContent = t('feat.' + group);
    const ul = document.createElement('ul');
    for (let i = 1; i <= n; i++) {
      const item = document.createElement('li');
      item.textContent = t(`feat.${group}.${i}`);
      if (has(`feat.${group}.${i}.1`)) {
        const sub = document.createElement('ul');
        for (let j = 1; has(`feat.${group}.${i}.${j}`); j++) {
          const s = document.createElement('li');
          s.textContent = t(`feat.${group}.${i}.${j}`);
          sub.append(s);
        }
        item.append(sub);
      }
      ul.append(item);
    }
    feats.append(h, ul);
  }
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

/* ── thumbnails ───────────────────────────────────────────────
   Frames are taken only for rows and tiles that are actually visible: a
   season can hold close to a hundred files, and there is no point
   running ffmpeg on all of them at once. */
let tileWatcher = null;

function watchThumbs() {
  if (tileWatcher) tileWatcher.disconnect();
  tileWatcher = null;

  /* The first screenful is requested straight away by hand: the observer
     reports visibility only from the next frame on, and tiles already in
     front of the eyes should fill without that pause. */
  const box = queueList.getBoundingClientRect();
  const rest = [];
  for (const li of queueList.children) {
    const r = li.getBoundingClientRect();
    if (r.bottom > box.top - 250 && r.top < box.bottom + 250) askThumb(li);
    else rest.push(li);
  }
  if (!rest.length) return;

  if (!('IntersectionObserver' in window)) {
    for (const li of rest) askThumb(li);
    return;
  }
  tileWatcher = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      tileWatcher.unobserve(e.target);
      askThumb(e.target);
    }
  }, { root: queueList, rootMargin: '250px' });
  for (const li of rest) tileWatcher.observe(li);
}

function askThumb(li) {
  const it = byId(li.dataset.id);
  if (!it || it.thumb || it.noThumb) return;
  if (it.kind === 'server') {
    it.thumb = '/api/thumb?path=' + encodeURIComponent(it.path);
    putThumb(li, it.thumb);
    return;
  }
  grabFrame(it).then(url => {
    if (!url) { it.noThumb = true; return; }
    it.thumb = url;
    if (li.isConnected) putThumb(li, url);
  });
}

/* A dropped file has no path on disk and cannot be handed to the
   server, so the frame is grabbed here through a canvas. Strictly one
   at a time: parallel seeks in one video element cancel each other, and
   holding ten of them means ten decoders. */
let thumbChain = Promise.resolve();
function grabFrame(it) {
  thumbChain = thumbChain.then(() => oneFrame(it)).catch(() => null);
  return thumbChain;
}

function oneFrame(it) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.playsInline = true;
    let done = false;
    const finish = url => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      v.removeAttribute('src'); v.load();
      resolve(url);
    };
    const guard = setTimeout(() => finish(null), 7000);

    v.addEventListener('loadeddata', () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      /* 12 %: past the opening titles, not yet the middle of the episode */
      v.currentTime = d ? Math.min(d - 0.1, d * 0.12) : 0;
    }, { once: true });

    v.addEventListener('seeked', () => {
      if (!v.videoWidth) return finish(null);      // an audio file
      try {
        const w = 320, h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        finish(c.toDataURL('image/jpeg', 0.72));
      } catch (_) { finish(null); }
    }, { once: true });

    v.addEventListener('error', () => finish(null), { once: true });
    v.src = it.url;
  });
}

function paintMeta() {
  queueTotal.textContent = fmtLong(state.list.reduce((a, b) => a + (b.dur || 0), 0));
  for (const li of queueList.children) {
    const it = state.list.find(x => String(x.id) === li.dataset.id);
    if (it) { paintPos(li, it); paintShape(li, it); }   // both need what the probe brings
    const box = it && li.querySelector('.item__meta');
    if (!box) continue;
    /* the first two columns have a fixed width so the rows line up */
    const fixed =
      `<span class="item__m item__m--dur">${it.dur ? fmt(it.dur) : '—'}</span>` +
      `<span class="item__m item__m--size">${it.size ? fmtSize(it.size) : '—'}</span>`;

    const rest = [];
    if (it.err) rest.push(`<b>${t('queue.bad')}</b>`);
    if (it.kind === 'server' && it.tracks) {
      rest.push(it.tracks.length > 1
        ? t('queue.tracks', { n: it.tracks.length })
        : (it.tracks[0] ? it.tracks[0].codec.toUpperCase() : ''));
    }
    if (state.server && state.server.ffmpeg) {
      rest.push(it.kind === 'server' && !it.direct
        ? `<b class="route">${t('queue.viaBridge')}</b>`
        : `<span class="route route--off">${t('queue.direct')}</span>`);
    }
    box.innerHTML = fixed + rest.filter(Boolean).map(b => `<span>${b}</span>`).join('');
  }
}

queueList.addEventListener('click', e => {
  const li = e.target.closest('.item, .tile');
  if (!li) return;
  const it = byId(li.dataset.id);
  if (!it) return;
  if (e.target.closest('.item__x')) return removeItem(it);
  playItem(it, true, false);
});

function removeItem(it) {
  const i = idxOf(it), wasCurrent = it === cur();
  if (it.url) URL.revokeObjectURL(it.url);
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

$('#btnSort').onclick = () => { state.list.sort((a, b) => collator.compare(a.path, b.path)); render(); toast(t('queue.sorted')); };
$('#btnReverse').onclick = () => { state.list.reverse(); render(); toast(t('queue.reversed')); };
$('#btnShuffle').onclick = () => {
  for (let i = state.list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.list[i], state.list[j]] = [state.list[j], state.list[i]];
  }
  render(); toast(t('queue.shuffled'));
};
$('#btnClear').onclick = () => {
  state.list.forEach(i => i.url && URL.revokeObjectURL(i.url));
  state.list = []; state.current = null;
  video.pause(); video.removeAttribute('src'); video.load();
  endCard.classList.remove('show'); hideNotice(); hideProgress();
  stage.classList.remove('fading');
  render();
};

/* ── list view: rows or tiles ─────────────────────────────────
   The switch lives in the queue header rather than in the settings:
   this is a choice about the current viewing, changed often and in the
   middle of things. */
function setView(v) {
  state.view = v;
  try { localStorage.setItem('pip.view', v); } catch (_) {}
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
      saveStr('pip.pipMode', m.id);
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

  win.document.title = cur() ? cur().name : 'PIP Player';
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
      title: it.name, artist: 'PIP Player',
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
  pulse(true); syncStatus(); markPlaying(true); armAudioCheck();
  deckShow(false);
});
video.addEventListener('pause', () => {
  paintPlay(); pipPoke(); pipGhost.classList.remove('playing');
  pulse(false); syncStatus(); markPlaying(false);
  /* At the end of a file the browser sends pause BEFORE ended, and that
     is not a stop the user asked for. The ended handler decides. */
  if (video.ended) return;
  const it = cur();
  if (it) markPos(it.path, video.currentTime);
  deckShow(true);
});
let posT = 0;
video.addEventListener('timeupdate', () => {
  paintSeek(); updatePositionState();
  const now = Date.now();
  if (now - posT < 5000) return;
  posT = now;
  const it = cur();
  if (it && !video.paused) markPos(it.path, video.currentTime);
});
video.addEventListener('progress', paintSeek);
video.addEventListener('seeked', () => { state.seekPreview = null; paintSeek(); });
video.addEventListener('loadedmetadata', () => {
  state.seekPreview = null;
  const it = cur();
  if (it && isFinite(video.duration) && video.duration) it.dur = video.duration;
  paintSeek(); paintMeta(); syncAudioButton(); syncSubsButton();
});
let volT = null;
video.addEventListener('volumechange', () => {
  paintVolume();
  /* not written on every step: a held arrow key produces dozens */
  state.vol = video.volume;
  clearTimeout(volT);
  volT = setTimeout(() => { try { localStorage.setItem('pip.vol', String(state.vol)); } catch (_) {} }, 400);
});
video.addEventListener('ratechange', () => {
  btnRate.textContent = (video.playbackRate % 1 ? video.playbackRate : video.playbackRate.toFixed(0)) + '×';
  fitDeck();         // 1.25× is wider than 1×
});
video.addEventListener('playing', () => {
  state.errStreak = 0; state.seekPreview = null; autoSwitch = false; syncStatus();
});
video.addEventListener('ended', () => {
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

video.addEventListener('error', () => {
  stage.classList.remove('fading');
  const it = cur();
  if (!it || !video.getAttribute('src')) return;
  it.err = true;
  render();
  toast(t('toast.playFail', { name: it.name }));
  state.errStreak++;
  if (state.errStreak < state.list.length) setTimeout(() => next(true), 1000);
  else state.errStreak = 0;
});

function paintTitle() {
  const it = cur();
  titleName.textContent = it ? it.name : '—';
  titlePath.textContent = it ? folderOf(it) : '';
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
  document.title = it ? `${it.name} · PIP Player` : 'PIP Player';
  paintFavicon();
}

/* ── state in the tab ─────────────────────────────────────────
   The state used to be shown by a pause glyph before the file name: it
   ate space in an already truncated title and looked out of place. Now
   the favicon shows it, the same dark coin as before with a different
   mark inside. */
const FAV = {
  idle:  `<g transform="translate(4.369 5.500) scale(1.2158)"><path d="M10.4377 5.18182H12.1798V6.90909H13.9218V8.63636H17.4059V10.3636H13.9218V12.0909H12.1798V13.8182H10.4377V17.2727H8.69568V13.8182H6.95365V12.0909H5.21161V10.3636H1.72754V8.63636H5.21161V6.90909H6.95365V5.18182H8.69568V1.72727H10.4377V5.18182ZM17.4059 15.5455H15.6638V13.8182H17.4059V15.5455ZM4.34059 6.04545H2.59856V4.31818H4.34059V6.04545ZM14.7928 3.45455H13.0508V1.72727H14.7928V3.45455ZM12.1798 1.72727H10.4377V0H12.1798V1.72727Z" fill="#fff"/></g>`,
  play:  `<path d="M12.8 9.3 23 16l-10.2 6.7z" fill="#fff"/>`,
  pause: `<path d="M11.6 9.4h3.3v13.2h-3.3zM17.1 9.4h3.3v13.2h-3.3z" fill="#fff"/>`,
  busy:  `<path d="M10.3 8.8h11.4v2.3l-4.6 4.9 4.6 4.9v2.3H10.3v-2.3l4.6-4.9-4.6-4.9z" fill="#fff"/>`,
};
const favUrl = mark => 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="15" fill="#0b0b0c"/>' + mark + '</svg>');

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
  saveStr('pip.autoplay', state.autoplay ? '1' : '0');
  paintAuto();
  toast(t(state.autoplay ? 'auto.toastOn' : 'auto.off'));
};

$('#btnRestart').onclick = () => { endCard.classList.remove('show'); if (state.list.length) playItem(state.list[0]); };
$('#btnEndClose').onclick = () => endCard.classList.remove('show');
$('#helpClose').onclick = () => helpModal.classList.remove('open');
helpModal.onclick = e => { if (e.target === helpModal) helpModal.classList.remove('open'); };

/* ── choosing files ────────────────────────────────────────── */
const pickFiles = () => filePick.click();
const pickFolder = () => dirPick.click();
$('#btnAddFiles').onclick = pickFiles;
$('#btnEmptyFiles').onclick = pickFiles;
$('#btnAddFolder').onclick = pickFolder;
$('#btnEmptyFolder').onclick = pickFolder;
filePick.onchange = e => { addLocalFiles(e.target.files); e.target.value = ''; };
dirPick.onchange = e => { addLocalFiles(e.target.files); e.target.value = ''; };

/* ── dragging in from outside ──────────────────────────────── */
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  if (dragEl || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++; dropveil.classList.add('show');
});
window.addEventListener('dragover', e => { if (!dragEl) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropveil.classList.remove('show'); } });
window.addEventListener('drop', async e => {
  if (dragEl) return;
  e.preventDefault();
  dragDepth = 0; dropveil.classList.remove('show');
  const dt = e.dataTransfer;
  if (!dt) return;
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry ? i.webkitGetAsEntry() : null).filter(Boolean);
  if (entries.length) {
    const out = [];
    for (const en of entries) await walkEntry(en, out);
    addLocalFiles(out);
  } else addLocalFiles(dt.files);
});

/* ═══════════════ disk browser (server mode) ═══════════════ */
function openBrowser() {
  browserModal.classList.add('open');
  loadDir(state.browserDir || (state.server.places[0] && state.server.places[0].path));
}
btnDisk.onclick = openBrowser;
btnEmptyDisk.onclick = openBrowser;
$('#brClose').onclick = () => browserModal.classList.remove('open');
browserModal.onclick = e => { if (e.target === browserModal) browserModal.classList.remove('open'); };
$('#brUp').onclick = () => { if (state.browserData && state.browserData.parent) loadDir(state.browserData.parent); };
$('#brAddAll').onclick = () => {
  const d = state.browserData;
  if (!d) return;
  addServerFiles(d.files);
  browserModal.classList.remove('open');
};

async function loadDir(path) {
  if (!path) return;
  try {
    const r = await fetch('/api/ls?path=' + encodeURIComponent(path));
    const data = await r.json();
    if (data.error) return toast(data.error);
    state.browserDir = data.path;
    state.browserData = data;
    brPath.textContent = data.path;
    renderPlaces();
    renderBrowser(data);
  } catch (_) { toast(t('browse.fail')); }
}

function renderPlaces() {
  brPlaces.replaceChildren();
  for (const p of state.server.places) {
    const b = document.createElement('button');
    b.className = 'brow' + (p.path === state.browserDir ? ' sel' : '');
    b.innerHTML = phSvg(PH.folder) + '<span class="brow__name"></span>';
    b.querySelector('.brow__name').textContent = p.key ? t('place.' + p.key) : p.name;
    b.onclick = () => loadDir(p.path);
    brPlaces.append(b);
  }
}

function renderBrowser(d) {
  brList.replaceChildren();
  if (!d.dirs.length && !d.files.length) {
    const e = document.createElement('li');
    e.className = 'browser__empty';
    e.textContent = t('browse.empty');
    brList.append(e);
    return;
  }
  for (const dir of d.dirs) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'brow';
    b.innerHTML = phSvg(PH.folder) + '<span class="brow__name"></span>' + phSvg(PH.caretRight);
    b.querySelector('.brow__name').textContent = dir.name;
    b.onclick = () => loadDir(dir.path);
    li.append(b); brList.append(li);
  }
  for (const f of d.files) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'brow';
    b.innerHTML = phSvg(PH.fileVideo) +
      '<span class="brow__name"></span><span class="brow__size"></span>';
    b.querySelector('.brow__name').textContent = f.name;
    b.querySelector('.brow__size').textContent = fmtSize(f.size);
    b.onclick = () => { addServerFiles([f]); browserModal.classList.remove('open'); };
    li.append(b); brList.append(li);
  }
}

/* ═══════════════ keyboard ═══════════════ */
function onKey(e) {
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (el === seek || el === volBar) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (browserModal.classList.contains('open') || helpModal.classList.contains('open')) {
    if (e.key === 'Escape') { browserModal.classList.remove('open'); helpModal.classList.remove('open'); }
    return;
  }

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
async function detectServer() {
  if (!location.protocol.startsWith('http')) return null;
  try {
    const r = await fetch('/api/ping');
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

(async function boot() {
  video.volume = state.vol;
  document.documentElement.lang = lang;
  applyI18n();
  applySettings();
  paintPlay(); paintVolume(); paintSeek(); paintLoop(); paintAuto(); paintView();
  applyCueStyle(); render();
  btnAudio.hidden = true;
  btnSubs.hidden = true;

  state.server = await detectServer();

  if (state.server) {
    btnDisk.hidden = false;
    btnEmptyDisk.hidden = false;
  }
  /* The primary button depends on the mode: with a server it is the disk
     browser, without one it is choosing files. It is assigned once,
     before the screen is first shown; the markup used to declare one
     button filled and boot immediately unfilled it and swapped the
     buttons around, all of it visible to the eye. */
  const primary = state.server && state.server.ffmpeg ? btnEmptyDisk : $('#btnEmptyFiles');
  primary.classList.add('btn--solid');

  /* The queue of the previous session comes back only in server mode,
     where the files have a path on disk. What is restored is not
     started: the watch position returns by itself when the file is
     played. */
  if (state.server && state.server.ffmpeg && !state.list.length) {
    const back = restoreSession();
    if (back) { probeServer(); toast(t('toast.restored', { n: back })); }
  }
  sessionReady = true;

  paintModeHint();
  fitFoot();         // the disk button may have just appeared
  booted = true;
  paintLoop();
  render();          // the screen can be shown now: it is correct already
})();

/* Which mode is running, as a hint under the empty screen buttons. It
   is a function of its own because it has to be rebuilt after a
   language change. */
function paintModeHint() {
  modeHint.innerHTML = t(
    state.server && state.server.ffmpeg ? 'hint.bridge'
    : state.server ? 'hint.noFfmpeg'
    : hasDocPip ? 'hint.local'
    : 'hint.localNoPip');
}

window.addEventListener('beforeunload', () => {
  const it = cur();
  if (it && video.currentTime) markPos(it.path, video.currentTime);
  if (state.pipWin) state.pipWin.close();
  state.list.forEach(i => i.url && URL.revokeObjectURL(i.url));
});

})();
