/* ═══════════════════════════════════════════════════════════
   The list of episodes.

   Every link and every <option> on the page is a candidate. A number
   is read from its text or its address. Candidates are grouped by the
   template of their address (digits made anonymous): a real episode
   list is a large group of links to the same kind of page, with
   distinct numbers that mostly follow one another. The best group
   wins; the rest are kept in the report so the inspector can show
   what else was considered.
   ═══════════════════════════════════════════════════════════ */
import { numberFromText, numberFromUrl, titleFromText, template } from './numbers.mjs';
import { textOf } from './text.mjs';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function candidatesFrom(doc, url, profile) {
  const out = [];
  const push = (el, href, text, by) => {
    if (/^\s*#/.test(String(href))) return;   // a link to nowhere on the page is a button (rating stars "1".."10"), not an episode's page
    let abs; try { abs = new URL(href, url).toString(); } catch { return; }
    if (/^(javascript|mailto|tel):/i.test(abs)) return;
    const t = clean(text);
    const number = numberFromText(t) ?? numberFromUrl(abs);
    if (number === null) return;
    out.push({ number, title: titleFromText(t), url: abs, by, where: el.tagName.toLowerCase() });
  };

  if (profile?.episodes?.list) {
    const numAttr = profile.episodes.number;
    for (const el of doc.querySelectorAll(profile.episodes.list)) {
      const href = el.getAttribute('href') ?? el.getAttribute('value') ?? el.getAttribute('data-url') ?? el.getAttribute('data-href');
      if (!href) continue;
      let abs; try { abs = new URL(href, url).toString(); } catch { continue; }
      const raw = numAttr ? el.getAttribute(numAttr) : null;
      const number = raw !== null && raw !== undefined ? Number(raw) : (numberFromText(textOf(el)) ?? numberFromUrl(abs));
      if (!Number.isFinite(number)) continue;
      out.push({ number, title: titleFromText(textOf(el)), url: abs, by: 'profile', where: profile.episodes.list });
    }
    if (out.length) return out;
  }

  for (const a of doc.querySelectorAll('a[href]')) push(a, a.getAttribute('href'), textOf(a), 'link');
  for (const o of doc.querySelectorAll('option[value]')) {
    const v = o.getAttribute('value');
    if (/^\/|^https?:/i.test(v)) push(o, v, textOf(o), 'option');
  }
  for (const el of doc.querySelectorAll('[data-episode][data-url], [data-episode][data-href], [data-episode][data-src]')) {
    const href = el.getAttribute('data-url') || el.getAttribute('data-href') || el.getAttribute('data-src');
    let abs; try { abs = new URL(href, url).toString(); } catch { continue; }
    const number = Number(el.getAttribute('data-episode'));
    if (Number.isFinite(number)) out.push({ number, title: titleFromText(textOf(el)), url: abs, by: 'data-episode', where: el.tagName.toLowerCase() });
  }
  return out;
}

/* How much of a run 1,2,3… the numbers make: 1 for a perfect sequence. */
function sequence(numbers) {
  const s = [...new Set(numbers)].sort((a, b) => a - b);
  if (s.length < 2) return 0;
  const span = s[s.length - 1] - s[0] + 1;
  return s.length / span;
}

export function findEpisodes(doc, url, { profile } = {}) {
  const cands = candidatesFrom(doc, url, profile);
  const groups = new Map();
  for (const c of cands) {
    const key = c.by + ' ' + template(c.url);
    if (!groups.has(key)) groups.set(key, { key, by: c.by, items: new Map() });
    const g = groups.get(key).items;
    /* the same episode linked twice (a strip of numbers and a list)
       is one episode; the longer text is the better title */
    const prev = g.get(c.number);
    if (!prev || c.title.length > prev.title.length) g.set(c.number, c);
  }

  const scored = [...groups.values()].map(g => {
    const items = [...g.items.values()].sort((a, b) => a.number - b.number);
    const seq = sequence(items.map(i => i.number));
    let confidence = g.by === 'profile' ? 1 : 0;
    if (!confidence) {
      if (items.length >= 2) confidence = 0.4;
      if (items.length >= 3) confidence = 0.6;
      confidence += 0.3 * seq;
      if (items.length >= 8 && seq > 0.8) confidence = Math.max(confidence, 0.95);
    }
    return { by: g.by, template: template(items[0].url), count: items.length, sequence: seq, confidence: Math.min(1, confidence), items };
  }).filter(g => g.count >= 2 || g.by === 'profile')
    .sort((a, b) => b.confidence - a.confidence || b.count - a.count);

  const best = scored[0] || null;
  return {
    items: best ? best.items.map(({ number, title, url }) => ({ number, title, url })) : [],
    by: best?.by || null,
    confidence: best?.confidence || 0,
    candidates: scored.map(({ items, ...g }) => g),
  };
}
