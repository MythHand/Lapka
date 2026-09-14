/* ═══════════════════════════════════════════════════════════
   What series this is, and which of its pages we are on.

   Title, cover, the way up to the series page from an episode page,
   and the number of the episode the page shows. All candidates, each
   with a confidence and the place it was found.
   ═══════════════════════════════════════════════════════════ */
import { numberFromText, numberFromUrl, titleFromText } from './numbers.mjs';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

/* "Название — Сайт", "Название | Сайт", "Название - смотреть онлайн" */
const stripSite = t => clean(t).split(/\s+[|—–]\s+|\s+-\s+/)[0]
  .replace(/\s*(?:смотреть|онлайн|бесплатно|все серии|watch online).*$/i, '').trim();

export function findTitle(doc, { profile } = {}) {
  const out = [];
  const add = (value, by, confidence, where) => { value = clean(value); if (value) out.push({ value, by, confidence, where }); };
  if (profile?.series?.title) for (const el of doc.querySelectorAll(profile.series.title)) add(el.textContent, 'profile', 1, profile.series.title);
  add(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'), 'og:title', 0.9, 'meta[property="og:title"]');
  const h1 = doc.querySelector('h1'); if (h1) add(h1.textContent, 'h1', 0.8, 'h1');
  add(stripSite(doc.querySelector('title')?.textContent), 'title', 0.5, 'title');
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
  const h1 = clean(doc.querySelector('h1')?.textContent);
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

export { titleFromText };
