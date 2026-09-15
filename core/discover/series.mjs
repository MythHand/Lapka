/* ═══════════════════════════════════════════════════════════
   What series this is, and which of its pages we are on.

   Title, cover, the way up to the series page from an episode page,
   and the number of the episode the page shows. All candidates, each
   with a confidence and the place it was found.
   ═══════════════════════════════════════════════════════════ */
import { numberFromText, numberFromUrl, titleFromText } from './numbers.mjs';
import { textOf } from './text.mjs';

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
  const og = out.find(c => c.by === 'og:title'), head = out.find(c => c.by === 'h1');
  if (og && head && og.value.length > head.value.length && og.value.toLowerCase().startsWith(head.value.toLowerCase() + ' ')) head.confidence = 0.95;
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
export function findSeriesUrl(doc, url) {
  const out = [];
  const page = new URL(url);
  const pagePath = page.pathname.replace(/\/+$/, '');
  const seen = new Set();
  const add = (value, by, confidence, where) => {
    if (!value || seen.has(value)) return;
    seen.add(value); out.push({ value, by, confidence, where });
  };
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
const SEASON = [/(\d{1,2})\s*-?\s*(?:й|ой|ый)?\s*сезон/i, /season\s*(\d{1,2})/i, /(\d{1,2})(?:st|nd|rd|th)\s+season/i, /\bS(\d{1,2})\b(?!\d)/];
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
    let abs; try { abs = new URL(raw, url).toString(); } catch { continue; }
    if (/^(javascript|mailto):/i.test(abs) || abs.includes('#')) continue;
    const key = abs.replace(/\/+$/, '');
    if (!out.has(key)) out.set(key, { order: n, title: text, url: abs, kind: 'tv', self: key === page });
  }
  const list = [...out.values()].sort((a, b) => a.order - b.order);
  if (!list.length) return [];
  if (!list.some(f => f.self)) {
    const have = new Set(list.map(f => f.order));
    const top = Math.max(...have, ownSeason || 0);
    const missing = [];
    for (let n = 1; n <= top; n++) if (!have.has(n)) missing.push(n);
    const mine = ownSeason !== null && !have.has(ownSeason) ? ownSeason : missing.length === 1 ? missing[0] : null;
    if (mine !== null) list.push({ order: mine, title: '', url: String(url).replace(/#.*$/, ''), kind: 'tv', self: true });
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
