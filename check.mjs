#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   Integrity check to run before opening the page in a browser.
   It catches what has already bitten twice, such as a popup layer
   clipped by an ancestor with overflow:hidden.
   Run:  node check.mjs
   ═══════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(HERE, f), 'utf8');
const html = read('index.html'), css = read('styles.css'), js = read('app.js');
const i18nSrc = read('i18n.js');

const problems = [], notes = [];
const fail = m => problems.push(m);
const note = m => notes.push(m);

/* ── parse the markup into a tree ──────────────────────────── */
const VOID = new Set(['area','base','br','col','embed','hr','img','input',
                      'link','meta','param','source','track','wbr']);
function parse(src) {
  const root = { tag: '#root', cls: [], id: null, parent: null, kids: [] };
  let cursor = root;
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { if (cursor.parent) cursor = cursor.parent; continue; }
    const cls = (/class="([^"]*)"/.exec(attrs) || [, ''])[1].split(/\s+/).filter(Boolean);
    const id = (/id="([^"]*)"/.exec(attrs) || [, null])[1];
    const node = { tag, cls, id, parent: cursor, kids: [] };
    cursor.kids.push(node);
    if (!selfClose && !VOID.has(tag.toLowerCase())) cursor = node;
  }
  return root;
}
function walk(node, fn) { fn(node); node.kids.forEach(k => walk(k, fn)); }

/* ── CSS rules indexed by class ────────────────────────────── */
const rules = [];
{
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) {
    const sels = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const sel of sels) rules.push({ sel, decl: m[2] });
  }
}
const declsForClass = cls => rules.filter(r =>
  new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '(?![\\w-])').test(r.sel));

/* ── 1. duplicate and missing ids ──────────────────────────── */
{
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) fail(`duplicate ids: ${[...new Set(dup)].join(', ')}`);

  const used = new Set([...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]));
  const missing = [...used].filter(u => !ids.includes(u));
  if (missing.length) fail(`js reaches for ids that do not exist: ${missing.join(', ')}`);
}

/* ── 2. brace balance ──────────────────────────────────────── */
{
  const o = (css.match(/\{/g) || []).length, c = (css.match(/\}/g) || []).length;
  if (o !== c) fail(`css: ${o} opening braces, ${c} closing`);
}

/* ── 3. classes with no style, styles with no class ────────── */
const liveClasses = new Set();
{
  for (const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => liveClasses.add(c));
  // classes js adds as strings or through classList
  for (const m of js.matchAll(/classList\.\w+\(([^)]*)\)/g))
    for (const q of m[1].matchAll(/'([^']+)'/g)) q[1].split(/\s+/).forEach(c => liveClasses.add(c));
  for (const m of js.matchAll(/class(?:Name)?\s*=\s*'([^']*)'/g)) m[1].split(/\s+/).forEach(c => c && liveClasses.add(c));
  for (const m of js.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => liveClasses.add(c));
  for (const m of js.matchAll(/'\s*([a-z][\w-]*(?:__[\w-]+)?(?:--[\w-]+)?)\s*'/g)) liveClasses.add(m[1]);

  /* inside url() and format() a dot means a file extension, not a class */
  const cssNoUrls = css.replace(/url\([^)]*\)|format\([^)]*\)/g, '');
  const cssClasses = new Set([...cssNoUrls.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
  const orphanMarkup = [...liveClasses].filter(c => /^[a-z]/.test(c) && !cssClasses.has(c)
    && [...html.matchAll(/class="([^"]+)"/g)].some(m => m[1].split(/\s+/).includes(c)));
  if (orphanMarkup.length) fail(`markup uses classes that have no style: ${orphanMarkup.join(', ')}`);

  const dead = [...cssClasses].filter(c => !liveClasses.has(c));
  if (dead.length) note(`css rules nothing uses: ${dead.join(', ')}`);
}

/* ── 4. THE BIG ONE: popup layers must not be clipped ──────── */
{
  const POPUPS = ['menu', 'seek__tip'];
  // where overflow:hidden is deliberate and the layer just has to fit
  const ALLOWED = new Set(['stage', 'stage-host', 'queue', 'queue__list', 'modal__card', 'browser__list']);
  const tree = parse(html);

  walk(tree, node => {
    if (!node.cls.some(c => POPUPS.includes(c))) return;
    const who = node.id ? '#' + node.id : '.' + node.cls.join('.');
    for (let p = node.parent; p; p = p.parent) {
      for (const cls of p.cls) {
        const clips = declsForClass(cls).some(r =>
          /overflow(-x|-y)?\s*:\s*hidden/.test(r.decl) &&
          !/^\S+\s/.test(r.sel.replace(/^\./, '')) === false ? false : /overflow(-x|-y)?\s*:\s*hidden/.test(r.decl));
        if (!clips) continue;
        if (ALLOWED.has(cls)) { continue; }
        fail(`layer ${who} is clipped by ancestor .${cls}, which has overflow:hidden`);
      }
    }
  });
}

/* ── 5. properties decided by nothing but file order ────────
   When an element carries two classes and both set the same layout
   property through a single-class selector, the one lower in the file
   simply wins. That is how .menuwrap overrode .gear and dropped the
   button back into normal flow. */
{
  const KEY = ['position', 'display', 'overflow', 'z-index',
               'top', 'right', 'bottom', 'left'];
  const single = new Map();   // class -> { property: [value, order] }
  rules.forEach((r, i) => {
    const m = /^\.([\w-]+)$/.exec(r.sel.trim());
    if (!m) return;
    const bag = single.get(m[1]) || {};
    for (const prop of KEY) {
      const d = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;}]+)').exec(r.decl);
      if (d) bag[prop] = [d[1].trim(), i];
    }
    single.set(m[1], bag);
  });

  const seen = new Set();
  walk(parse(html), node => {
    if (node.cls.length < 2) return;
    for (const prop of KEY) {
      const decls = node.cls
        .map(c => [c, (single.get(c) || {})[prop]])
        .filter(([, v]) => v);
      if (decls.length < 2) continue;
      /* .block and .block--mod are a deliberate pair, but only when the
         modifier is declared BELOW the base. Above it the base wins,
         which is a bug. Unrelated classes such as .gear and .menuwrap
         are dangerous in either order. */
      const isMod = (a, b) => a.startsWith(b + '--') || a.startsWith(b + '__');
      const okPair = ([a, av], [b, bv]) =>
        (isMod(a, b) && av[1] > bv[1]) || (isMod(b, a) && bv[1] > av[1]);
      if (decls.every(x => decls.every(y => x[0] === y[0] || okPair(x, y)))) continue;
      const vals = new Set(decls.map(([, v]) => v[0]));
      if (vals.size < 2) continue;
      const win = decls.reduce((a, b) => (a[1][1] > b[1][1] ? a : b));
      const key = node.cls.join('.') + prop;
      if (seen.has(key)) continue;
      seen.add(key);
      fail(`on .${node.cls.join('.')} the property ${prop} is set by ` +
           decls.map(([c, v]) => `.${c}:${v[0]}`).join(' and ') +
           `, and .${win[0]} wins for no reason but its place in the file`);
    }
  });
}

/* ── 6. one selector declaring display twice, differently ──── */
{
  const seen = new Map();
  for (const r of rules) {
    const d = /display\s*:\s*([\w-]+)/.exec(r.decl);
    if (!d) continue;
    const prev = seen.get(r.sel);
    if (prev && prev !== d[1]) note(`selector ${r.sel} sets display twice: ${prev} and ${d[1]}`);
    seen.set(r.sel, d[1]);
  }
}

/* ── 7. an svg rule must not kill the icon fill ─────────────
   Phosphor icons are solid outlines and need fill. Any rule shaped
   like ".something svg" that sets fill or stroke carries at least the
   weight of svg.ph, and once declared later the icon disappears
   completely. That already happened to the queue toolbar. */
{
  for (const r of rules) {
    const sel = r.sel.trim();
    if (!/\bsvg$/.test(sel) || sel === 'svg' || /\.ph\b/.test(sel)) continue;
    const bad = /(^|;)\s*(fill|stroke)\s*:/.exec(r.decl);
    if (bad) fail(`rule ${sel} sets ${bad[2]} and will kill the fill of svg.ph icons, keep only sizing here`);
  }
}

/* ── 8. layout rests on direct parentage ────────────────────
   Layouts built on flex with space-between, or on grid, work only
   while the elements are DIRECT children of their container. Let one
   of them slip inside a sibling and there is nothing left to space
   apart: everything collapses to one edge while the styles stay valid
   and say nothing. That already happened to the queue footer. Listed
   below are the relations the layout depends on. */
{
  const CONTRACT = [
    ['queue__foot',  ['queue__side', 'queue__add']],
    ['queue__side',  ['brand', 'queue__sum']],
    ['deck__ctrls',  ['deck__side--left', 'deck__center', 'deck__side--right']],
    ['deck__side--left',  ['deck__grp']],
    ['deck__side--right', ['deck__grp']],
    ['queue__tools', ['toolgrp', 'spacer', 'rb--sm']],
  ];
  const tree = parse(html);
  const find = cls => { let hit = null; walk(tree, n => { if (!hit && n.cls.includes(cls)) hit = n; }); return hit; };

  for (const [parentCls, kids] of CONTRACT) {
    const parent = find(parentCls);
    if (!parent) { fail(`the markup has no .${parentCls}, and the layout rests on it`); continue; }
    const direct = new Set(parent.kids.flatMap(k => k.cls));
    for (const kid of kids) {
      if (direct.has(kid)) continue;
      const somewhere = [];
      walk(parent, n => { if (n !== parent && n.cls.includes(kid)) somewhere.push(n); });
      fail(somewhere.length
        ? `.${kid} sits inside .${parentCls} but not as a direct child, the layout will fall apart`
        : `.${kid} is gone from .${parentCls}`);
    }
  }
}

/* ── 9. translations ───────────────────────────────────────
   Half a language is worse than one language: the interface splits in
   two. So every dictionary must carry exactly the same set of keys,
   and every key the code or the markup asks for must be in it. */
{
  let I18N = null;
  try {
    const w = {};
    new Function('window', i18nSrc)(w);
    I18N = w.I18N;
  } catch (e) { fail('i18n.js does not parse: ' + e.message); }

  if (I18N) {
    const base = Object.keys(I18N.dict.en || {});
    if (!base.length) fail('i18n.js has no English dictionary');

    /* Duplicate keys inside one dictionary: JS silently takes the last
       one and half the file turns dead. That already happened after the
       feature list was rewritten. */
    for (const m of i18nSrc.matchAll(/\n'?([\w-]+)'?: \{/g)) {
      const from = m.index;
      const to = i18nSrc.indexOf('\n},', from);
      const keys = [...i18nSrc.slice(from, to).matchAll(/\n  '([\w.]+)':/g)].map(x => x[1]);
      const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (dup.length) fail(`dictionary ${m[1]} repeats keys: ${[...new Set(dup)].join(', ')}`);
    }

    for (const [code] of I18N.list) {
      const d = I18N.dict[code];
      if (!d) { fail(`language ${code} is listed but has no dictionary`); continue; }
      const keys = Object.keys(d);
      const missing = base.filter(k => !keys.includes(k));
      const extra = keys.filter(k => !base.includes(k));
      if (missing.length) fail(`dictionary ${code} is missing keys: ${missing.join(', ')}`);
      if (extra.length) fail(`dictionary ${code} has extra keys: ${extra.join(', ')}`);
    }
    for (const code of Object.keys(I18N.dict)) {
      if (!I18N.list.some(([c]) => c === code)) fail(`dictionary ${code} exists but is not in the language list`);
    }

    /* What counts as asking for a translation: a literal t('key') and a
       data attribute in the markup. A key ending in a dot is the start
       of a composed one such as t('loop.' + state.loop), so it is left
       out here. */
    const asked = new Set();
    for (const m of js.matchAll(/\bt\(\s*'([\w.]+)'/g)) if (!m[1].endsWith('.')) asked.add(m[1]);
    for (const m of html.matchAll(/data-i18n(?:-html|-title|-aria)?="([\w.]+)"/g)) asked.add(m[1]);

    const unknown = [...asked].filter(k => !base.includes(k));
    if (unknown.length) fail(`asked for translations that do not exist: ${unknown.join(', ')}`);

    /* The other side: a key exists and nothing asks for it. The test is
       looser here, because a key can live in a table (SETTINGS, CUE_UI,
       PIP_MODES) or be built from a prefix, so any mention of the string
       in the code counts, along with every family composed at runtime. */
    const prefixes = [...js.matchAll(/\bt\(\s*'([\w.]+\.)'\s*\+/g)].map(m => m[1]);
    const mentioned = k => js.includes(`'${k}'`) || html.includes(`"${k}"`)
                        || prefixes.some(pre => k.startsWith(pre));
    const unused = base.filter(k => !asked.has(k) && !mentioned(k));
    if (unused.length) note(`translations nothing asks for: ${unused.join(', ')}`);
  }
}

/* ── result ────────────────────────────────────────────────── */
for (const n of notes) console.log('  ~ ' + n);
if (!problems.length) {
  console.log('\n  Check passed: ' + (notes.length ? notes.length + ' note(s), no errors' : 'clean') + '\n');
  process.exit(0);
}
console.log('');
for (const p of problems) console.log('  ✗ ' + p);
console.log('\n  Errors: ' + problems.length + '\n');
process.exit(1);
