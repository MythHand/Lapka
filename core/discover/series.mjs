/* ═══════════════════════════════════════════════════════════
   What series this is, and which of its pages we are on.

   Title, cover, the way up to the series page from an episode page,
   and the number of the episode the page shows. All candidates, each
   with a confidence and the place it was found.
   ═══════════════════════════════════════════════════════════ */
import { numberFromText, numberFromUrl, tailNumberOfUrl, titleFromText } from './numbers.mjs';
import { textOf } from './text.mjs';

const SEO_HEAD = /^\s*(?:watch|ver|смотреть)\s+(?:anime\s+|аниме\s+)?(?=\S)/i;
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

/* "Название — Сайт", "Название | Сайт", "Название - смотреть онлайн" */
const stripSite = t => clean(t).split(/\s+[|—–]\s+|\s+-\s+/)[0]
  .replace(/\s*(?:смотреть|онлайн|бесплатно|все серии|watch online).*$/i, '').trim();

export function findTitle(doc, { profile } = {}) {
  const out = [];
  const add = (value, by, confidence, where) => { value = clean(value); if (value) out.push({ value, by, confidence, where }); };
  if (profile?.series?.title) for (const el of doc.querySelectorAll(profile.series.title)) add(el.textContent, 'profile', 1, profile.series.title);
  add(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'), 'og:title', 0.9, 'meta[property="og:title"]');
  const h1 = doc.querySelector('h1'); if (h1) add(textOf(h1), 'h1', 0.8, 'h1');
  add(stripSite(doc.querySelector('title')?.textContent), 'title', 0.5, 'title');
  /* "Клинок, рассекающий демонов смотреть на джутсу" in og:title and
     "Клинок, рассекающий демонов" in the heading: the heading is the
     name, the rest is a tail for search engines */
  /* "Watch Dr. Stone: Science Future Part 3 Anime Free on Gogoanime" in
     og:title and "Dr. Stone: Science Future Part 3" in the heading or
     the title tag: the shorter one the longer one opens with, past a
     "Watch", is the name and the rest a tail for search engines. Not
     when the shorter one is the episode's own line ("Эпизод 8"). */
  const og = out.find(c => c.by === 'og:title');
  const core = og ? og.value.replace(SEO_HEAD, '').toLowerCase() : '';
  for (const other of out) {
    if (!og || other === og || other.by === 'profile') continue;
    const v = other.value.toLowerCase();
    if (og.value.length > other.value.length && v.length >= 4 && core.startsWith(v) && numberFromText(other.value) === null) other.confidence = Math.max(other.confidence, 0.95);
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

export function findCover(doc, url) {
  const out = [];
  const add = (value, by, confidence, where) => {
    if (!value) return;
    try { value = new URL(value, url).toString(); } catch { return; }
    out.push({ value, by, confidence, where });
  };
  add(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), 'og:image', 0.9, 'meta[property="og:image"]');
  add(doc.querySelector('link[rel="image_src"]')?.getAttribute('href'), 'image_src', 0.7, 'link[rel="image_src"]');
  add(doc.querySelector('.poster img, .cover img, [class*="poster"] img')?.getAttribute('src'), 'poster', 0.6, '.poster img');
  return out;
}

/* On an episode page, the link back to the series. The nearest link
   whose address is a parent of ours is the strongest sign; then the
   breadcrumb; then any link that says it goes up. */
export function findSeriesUrl(doc, url, seriesTitle = '') {
  const out = [];
  const page = new URL(url);
  const pagePath = page.pathname.replace(/\/+$/, '');
  const seen = new Set();
  const add = (value, by, confidence, where) => {
    if (!value) return;
    value = value.replace(/\/{2,}$/, '/');   // "…/season-3//" is "…/season-3/"
    if (seen.has(value)) return;
    seen.add(value); out.push({ value, by, confidence, where });
  };
  /* a link on this site named exactly as the series is: the way
     WordPress themes lead from an episode to its series */
  const want = clean(seriesTitle).toLowerCase();
  if (want.length >= 4) for (const a of doc.querySelectorAll('a[href]')) {
    if (clean(textOf(a)).toLowerCase() !== want) continue;
    let u; try { u = new URL(a.getAttribute('href'), url); } catch { continue; }
    if (u.origin !== page.origin || u.pathname.replace(/\/+$/, '') === pagePath || u.hash) continue;
    add(u.toString(), 'named', 0.8, 'a[href]');
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    let u; try { u = new URL(a.getAttribute('href'), url); } catch { continue; }
    if (u.origin !== page.origin) continue;
    const p = u.pathname.replace(/\/+$/, '');
    if (!p || p === pagePath || !pagePath.startsWith(p + '/')) continue;
    const depth = pagePath.slice(p.length).split('/').length - 1;
    add(u.toString(), 'parent-path', depth === 1 ? 0.9 : 0.6, 'a[href]');
  }
  for (const a of doc.querySelectorAll('[class*="breadcrumb"] a, [itemtype*="BreadcrumbList"] a, nav[aria-label*="bread" i] a')) {
    let u; try { u = new URL(a.getAttribute('href'), url); } catch { continue; }
    add(u.toString(), 'breadcrumb', 0.5, 'breadcrumb');
  }
  for (const a of doc.querySelectorAll('a[rel="up"], a[href]')) {
    if (a.getAttribute('rel') !== 'up' && !/^[←«<]/.test(clean(a.textContent))) continue;
    let u; try { u = new URL(a.getAttribute('href'), url); } catch { continue; }
    add(u.toString(), 'link-up', 0.4, 'a');
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

/* Which episode this page shows: the address and the heading are
   asked, and agreement between them is what makes it certain. */
export function findCurrentEpisode(doc, url) {
  const out = [];
  const fromUrl = numberFromUrl(url);
  if (fromUrl !== null) out.push({ value: fromUrl, by: 'url', confidence: 0.6, where: url });
  const h1 = doc.querySelector('h1') ? textOf(doc.querySelector('h1')) : '';
  const fromH1 = numberFromText(h1);
  if (fromH1 !== null) out.push({ value: fromH1, by: 'h1', confidence: 0.6, where: 'h1' });
  const fromTitle = numberFromText(doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.querySelector('title')?.textContent);
  if (fromTitle !== null) out.push({ value: fromTitle, by: 'title', confidence: 0.4, where: 'title' });
  /* the page's own element that names the episode's number in an
     attribute, when there is one such element and not a list of them */
  for (const attr of ['data-numero', 'data-episode-num', 'data-ep-num', 'data-current-episode', 'data-num', 'data-episode-number']) {
    const els = doc.querySelectorAll(`[${attr}]`);
    if (els.length !== 1) continue;
    const n = Number(els[0].getAttribute(attr));
    if (Number.isFinite(n) && n > 0 && n < 10000) { out.push({ value: n, by: 'attr', confidence: 0.6, where: `[${attr}]` }); break; }
  }
  const tail = tailNumberOfUrl(url);
  if (tail !== null) out.push({ value: tail, by: 'url-tail', confidence: 0.35, where: url });
  /* two independent sources agreeing beat either alone */
  const votes = new Map();
  for (const c of out) votes.set(c.value, (votes.get(c.value) || 0) + c.confidence);
  return [...votes.entries()].map(([value, confidence]) => ({
    value, confidence: Math.min(0.98, confidence), by: out.filter(c => c.value === value).map(c => c.by).join('+'),
  })).sort((a, b) => b.confidence - a.confidence);
}

/* "2 сезон", "Season 2", "2nd season", "S2", or a bare number at the
   end of a title ("Богиня благословляет этот прекрасный мир 2",
   "Этот Замечательный Мир! 3 (OVA)"): the season a title names */
const SEASON = [/(\d{1,2})\s*-?\s*(?:й|ой|ый)?\s*сезон/i, /сезон\s*№?\s*(\d{1,2})(?!\d)/i, /season\s*(\d{1,2})/i, /(\d{1,2})(?:st|nd|rd|th)\s+season/i, /\b(?:part|часть)\s*(\d{1,2})(?!\d)/i, /\bS(\d{1,2})\b(?!\d)/];

/* "neobjatnyj-okean-sezon-3", "one_piece_season_2", "…/s2/": the season an address names */
const SEASON_PATH = /(?:^|[-_/])(?:sezon|season|s)[-_]?(\d{1,2})(?=[-_/.]|$)/i;
export function seasonFromUrl(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const m = SEASON_PATH.exec(u.pathname.toLowerCase());
  return m ? Number(m[1]) : null;
}

/* A title the way a site writes it for search engines: "Необъятный
   океан, Сезон 3 (2026) все серии онлайн". The name is what is left
   once the year in brackets and the tail of watch-words go; the year
   is kept. */
const SEO_TAIL = /\s*(?:[-—–|:·,]\s*)?(?:все\s+серии(?:\s+подряд)?|смотреть(?:\s+аниме)?(?:\s+онлайн)?|аниме\s+онлайн|онлайн|в\s+хорошем\s+качестве|бесплатно|в\s+hd|hd|watch\s+online|online|free|english\s+(?:subbed|dubbed)|(?:eng\s+)?(?:subbed|dubbed)|anime\s+free|at\s+\w+|sub\s+espa[ñn]ol|en\s+espa[ñn]ol|online\s+gratis|gratis)\s*$/i;
export function tidyTitle(text, host = '') {
  let t = String(text || '').replace(SEO_HEAD, '');
  let year = null;
  /* "… — JkAnime", "… - Gogoanime": the site's own name at the end, when it is the site's */
  const site = String(host || '').replace(/^www\./, '').split('.')[0].toLowerCase();
  const tail = /\s*[—–|-]\s*([\p{L}\d.]+)\s*$/u.exec(t);
  if (site.length >= 3 && tail) { const w = tail[1].toLowerCase().replace(/\./g, ''); if (w.includes(site) || site.includes(w)) t = t.slice(0, tail.index); }
  t = t.replace(/\s*\(((?:19|20)\d{2})\)\s*/g, (_, y) => { year = year || Number(y); return ' '; });
  for (let i = 0; i < 6; i++) { const was = t; t = t.replace(SEO_TAIL, ''); if (t === was) break; }
  t = t.replace(/\s+/g, ' ').replace(/[\s,:·|—–-]+$/g, '').trim();
  return { title: t || String(text || '').trim(), year };
}
const TRAILING = /(?:^|\s)(\d{1,2})(?:\s*\((?:OVA|ONA|TV|special)\))?\s*$/i;
/* bare: whether a number at the end counts; it does in a title, not in a link ("3" in a strip of episodes) */
export function seasonFromText(text, { bare = true } = {}) {
  const t = String(text || '');
  for (const re of SEASON) { const m = re.exec(t); if (m) return Number(m[1]); }
  if (bare) { const m = TRAILING.exec(t); if (m) return Number(m[1]); }
  return null;
}

/* Links to the other seasons: anchors whose text names a season, or
   options of a select of seasons. The current season is the one whose
   address is this page's, or, as pages usually do not link to
   themselves, the one number missing from the run of links. */
/* A season link that names another series ("О моём перерождении в
   слизь 2 сезон" on the page of "Клинок, рассекающий демонов") is a
   recommendation, not a part of this franchise. A link that names
   only a season, or names this series, is. The test is the first
   long word of the title: a part's name carries it. */
function aboutThisSeries(text, title) {
  const stem = (String(title || '').toLowerCase().match(/[a-zа-яё0-9]{4,}/) || [''])[0].slice(0, 5);
  const words = String(text).toLowerCase().replace(/\d+|сезон\w*|season|s\d+/gi, ' ').match(/[a-zа-яё]{4,}/g) || [];
  return !words.length || !stem || words.some(w => w.startsWith(stem) || stem.startsWith(w.slice(0, 5)));
}

export function findFranchise(doc, url, ownSeason = null, title = '') {
  const out = new Map();
  const page = (() => { try { return new URL(url).toString().replace(/\/+$/, ''); } catch { return url; } })();
  for (const el of doc.querySelectorAll('a[href], option[value]')) {
    const text = textOf(el);
    const n = seasonFromText(text, { bare: false });
    if (n === null || !aboutThisSeries(text, title)) continue;
    const raw = el.getAttribute('href') ?? el.getAttribute('value');
    let abs; try { abs = new URL(raw, url); } catch { continue; }
    if (/^(javascript|mailto):/i.test(abs.href) || String(raw).includes('#')) continue;
    if (abs.origin !== new URL(url).origin) continue;   // a season of this series lives on this site; a chat or a news site does not
    const key = abs.toString().replace(/\/+$/, '');
    if (!out.has(key)) out.set(key, { order: n, title: text, url: abs.toString(), kind: 'tv', self: key === page });
  }
  /* Links that say nothing (a picture) but whose address is this
     page's slug with another season: "neobjatnyj-okean-sezon-2" and
     "neobjatnyj_okean_sezon_1_2018_720_hd" beside
     "neobjatnyj-okean-sezon-3". The slug's stem before the season
     marker names the series. */
  let pageUrl; try { pageUrl = new URL(url); } catch { pageUrl = null; }
  const slugOf = p => p.toLowerCase().replace(/[-_]+/g, '-');
  const stemOf = p => { const seg = slugOf(p).split('/').filter(Boolean).find(s => SEASON_PATH.test(s)); if (!seg) return null; const stem = seg.replace(/(?:^|-)(?:sezon|season|s)-?\d{1,2}(?=-|$).*$/, ''); return stem.length >= 5 ? stem : null; };
  const stem = pageUrl ? stemOf(pageUrl.pathname) : null;
  if (stem) for (const a of doc.querySelectorAll('a[href]')) {
    let u; try { u = new URL(a.getAttribute('href'), url); } catch { continue; }
    if (u.origin !== pageUrl.origin || String(a.getAttribute('href')).includes('#')) continue;
    const n = seasonFromUrl(u.toString());
    if (n === null || !slugOf(u.pathname).includes(stem)) continue;
    /* the season's own page, not an episode inside it: nothing may
       follow the season's segment but a site engine's id ("10-1-0-834") */
    const segs = slugOf(u.pathname).split('/').filter(Boolean);
    const at = segs.findIndex(sg => SEASON_PATH.test(sg));
    if (segs.slice(at + 1).some(sg => !/^\d+(?:-\d+){2,}$/.test(sg))) continue;
    const key = u.toString().replace(/\/+$/, '');
    if (!out.has(key)) out.set(key, { order: n, title: '', url: u.toString(), kind: 'tv', self: key === page });
  }
  /* one part per season: the page itself first, else the one with the
     shortest address (a season's page, not a page inside it) */
  const byOrder = new Map();
  for (const f of [...out.values()].sort((a, b) => a.order - b.order || (b.self - a.self) || a.url.length - b.url.length)) if (!byOrder.has(f.order)) byOrder.set(f.order, f);
  const list = [...byOrder.values()];
  if (!list.length) return [];
  if (!list.some(f => f.self)) {
    const have = new Set(list.map(f => f.order));
    const top = Math.max(...have, ownSeason || 0);
    const missing = [];
    for (let n = 1; n <= top; n++) if (!have.has(n)) missing.push(n);
    /* the page's own season: the one its title or address names; when
       a link already claims that number it is this very season seen
       from another address, and the page takes its place */
    const mine = ownSeason !== null ? ownSeason : missing.length === 1 ? missing[0] : null;
    if (mine !== null && have.has(mine)) { const twin = list.find(f => f.order === mine); twin.self = true; twin.url = String(url).replace(/#.*$/, ''); }
    else if (mine !== null) list.push({ order: mine, title: '', url: String(url).replace(/#.*$/, ''), kind: 'tv', self: true });
    list.sort((a, b) => a.order - b.order);
  }
  /* a lone season link is a menu item, not a franchise */
  return list.length >= 2 ? list : [];
}

/* A block the page heads "Франшиза", "Все части по порядку", "Порядок
   просмотра", "Хронология", "Franchise", "Watch order": the parts of
   the franchise laid out by the site itself, each with its year, this
   page among them without a link. That is the franchise as the site
   knows it, films and spin-offs included, ordered by year and then as
   the site lists them. Looked at only when no season links say
   otherwise. */
const FRANCHISE_HEAD = /^(франшиза|все части|порядок просмотра|хронология|связанн|franchise|watch order|related)/i;
const YEAR = /^\s*((?:19|20)\d{2})\s*$/;
const kindOfName = name => /фильм|movie|film/i.test(name) ? 'movie' : /\b(ova|ona)\b/i.test(name) ? 'ova' : /спешл|special/i.test(name) ? 'special' : 'tv';
export function franchiseFromBlock(doc, url, title = '', own = {}) {
  const page = (() => { try { const u = new URL(url); return u.origin + u.pathname.replace(/\/+$/, ''); } catch { return url; } })();
  const same = href => { try { const u = new URL(href, url); return u.origin + u.pathname.replace(/\/+$/, ''); } catch { return null; } };
  const heads = [...doc.querySelectorAll('h1, h2, h3, h4, div, span, p')].filter(el => el.children.length <= 1 && FRANCHISE_HEAD.test(textOf(el)) && textOf(el).length < 40);
  for (const head of heads) {
    let up = head;
    for (let depth = 0; depth < 4 && up.parentElement; depth++) {
      up = up.parentElement;
      /* the items: a year each, a link for every part but this page.
         The year may sit a few levels below the item ("Сериал / 2024"
         under the name): the item is the nearest ancestor of the year
         that holds one link, or none. */
      const years = [...up.querySelectorAll('*')].filter(el => !el.children.length && YEAR.test(el.textContent || ''));
      if (!years.length) continue;
      const items = [];
      const yearsIn = el => years.filter(y => el.contains(y)).length;
      for (const y of years) {
        /* up from the year while the element is still about one part
           (holds this year alone), until a link is met; an item without
           a link is the widest such element */
        let item = y.parentElement, prev = null;
        for (let k = 0; k < 5 && item && item !== up && yearsIn(item) === 1; k++) {
          if (item.querySelector('a[href]')) break;
          prev = item; item = item.parentElement;
        }
        if (!item || item === up || yearsIn(item) !== 1) item = prev;
        if (!item) continue;
        const links = [...item.querySelectorAll('a[href]')];
        const hrefs = new Set(links.map(a => same(a.getAttribute('href'))).filter(Boolean));
        if (hrefs.size > 1) continue;   // several parts inside: not one item
        const a = links[0] || null;
        const name = clean(a ? links.map(l => textOf(l) || l.getAttribute('title') || l.querySelector('img')?.getAttribute('alt')).find(Boolean) : (item.textContent || '').replace(y.textContent, ''));
        if (!name) continue;
        const href = a ? [...hrefs][0] : null;
        if (a && !href) continue;
        items.push({ title: name, url: a ? new URL(a.getAttribute('href'), url).toString() : null, href, year: Number(YEAR.exec(y.textContent)[1]), kind: kindOfName(name) });
      }
      if (!items.length) continue;
      /* this page: the item linking to it; else the one item without a
         link (a site leaves the current page unlinked, or the head of
         the franchise); else the one named as the page is; else the
         block names the others only, and the page joins them with
         what it knows of itself */
      let self = items.find(it => it.href === page) || items.find(it => !it.href) || items.find(it => title && it.title.toLowerCase() === String(title).toLowerCase());
      if (!self) { self = { title: String(title || ''), url: null, href: page, year: own.year || null, kind: own.kind || kindOfName(String(title || '')) }; items.push(self); }
      /* a part without a link cannot be looked at, and is left out unless it is this page */
      const parts = items.filter(it => it === self || it.url).map(it => ({ title: it.title, url: it === self ? String(url).replace(/#.*$/, '') : it.url, year: it.year, kind: it.kind, self: it === self }));
      if (parts.length < 2) continue;
      parts.sort((a, b) => (a.year || 9999) - (b.year || 9999));   // stable: the site's order within a year stays; a year unknown goes last
      return parts.map((p, i) => ({ order: i + 1, ...p }));
    }
  }
  return [];
}

/* What the page says of itself in schema.org data (JSON-LD): the year
   it came out and what it is, a series or a film. */
export function findSelf(doc) {
  const out = { year: null, kind: null };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let d; try { d = JSON.parse(s.textContent); } catch { continue; }
    for (const node of (Array.isArray(d) ? d : [d]).flatMap(x => x && x['@graph'] ? x['@graph'] : [x])) {
      if (!node || typeof node !== 'object') continue;
      const type = String(Array.isArray(node['@type']) ? node['@type'][0] : node['@type'] || '');
      if (!/^(TVSeries|TVSeason|Movie|VideoObject|CreativeWorkSeries|Series)$/i.test(type)) continue;
      const date = node.datePublished || node.startDate || node.dateCreated || '';
      const y = /^(19|20)\d{2}/.exec(String(date));
      if (y && !out.year) out.year = Number(y[0]);
      if (!out.kind) out.kind = /Movie/i.test(type) ? 'movie' : /TV|Series/i.test(type) ? 'tv' : null;
    }
  }
  return out;
}

export { titleFromText };
