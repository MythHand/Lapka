/* ═══════════════════════════════════════════════════════════
   What a script holds, read without running it.

   Object literals, whether JSON or JavaScript; scripts packed the
   way Dean Edwards' packer does (eval(function(p,a,c,k,e,d)…), the
   dress of half the video hosters); addresses hidden in base64.
   ═══════════════════════════════════════════════════════════ */

/* Object literals in a script: keys without quotes, single quotes,
   trailing commas are all made into JSON before parsing. One flat
   object at a time; nested ones are found by the outer scan as their
   own flat objects. */
export function objectsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\{[^{}]*\}/g)) {
    const raw = m[0]
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_, s) => JSON.stringify(s))
      .replace(/,\s*}/g, '}');
    try { const o = JSON.parse(raw); if (o && typeof o === 'object') out.push(o); } catch { /* not an object we can read */ }
  }
  return out;
}

/* A packed script unpacked: the payload's words put back from the
   dictionary, the way the packer's own decoder does it. Every packed
   block in the text, in order. */
const PACKED = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/gs;
const unescapeJs = s => s.replace(/\\(['"\\/])/g, '$1').replace(/\\n/g, '\n');
export function unpacked(text) {
  const out = [];
  for (const m of String(text || '').matchAll(PACKED)) {
    const p = unescapeJs(m[1]), a = Number(m[2]), c = Number(m[3]), k = unescapeJs(m[4]).split('|');
    const enc = n => (n < a ? '' : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    const dict = new Map();
    for (let i = 0; i < c; i++) { const key = enc(i); dict.set(key, k[i] || key); }
    out.push(p.replace(/\b\w+\b/g, w => dict.get(w) ?? w));
  }
  return out;
}

/* The page's data as a framework packs it. Next.js writes what the
   page's components get as strings pushed into self.__next_f (the
   app router) or as one JSON in a script named __NEXT_DATA__ (the
   pages router). Decoded and joined, it is a text like any script's,
   with the objects the page is drawn from inside it. */
const NEXT_PUSH = /self\.__next_f\.push\(\[\s*1\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
export function payloadsIn(doc) {
  const out = [];
  const pushed = [];
  for (const s of doc.querySelectorAll('script:not([src])')) {
    for (const m of (s.textContent || '').matchAll(NEXT_PUSH)) { try { pushed.push(JSON.parse(m[1])); } catch { /* not a string we can read */ } }
  }
  if (pushed.length) out.push(pushed.join(''));
  const data = doc.querySelector('script#__NEXT_DATA__');
  if (data && data.textContent) out.push(data.textContent);
  return out;
}

/* Arrays of objects in a text, each found by matching its brackets
   (strings skipped), read as JSON. Only arrays that open on an object
   count, and only up to a size: a page's data, not a bundle. */
const ARRAY_MAX = 2 * 1024 * 1024;
export function arraysIn(text) {
  const t = String(text || '');
  const out = [];
  let from = 0;
  while (from < t.length) {
    const at = t.indexOf('[{', from);
    if (at < 0) break;
    let depth = 0, inStr = false, end = -1;
    for (let i = at; i < t.length && i - at < ARRAY_MAX; i++) {
      const c = t[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) { from = at + 2; continue; }
    try { const a = JSON.parse(t.slice(at, end + 1)); if (Array.isArray(a) && a.length && a.every(x => x && typeof x === 'object' && !Array.isArray(x))) out.push(a); }
    catch { /* not JSON: an array of JavaScript, skipped */ }
    from = at + 2;   // arrays inside this one are found on their own
  }
  return out;
}

/* an address hidden in base64 (plain or URL-safe), or null */
export function urlFromBase64(v) {
  const s = String(v || '').trim();
  if (!/^[A-Za-z0-9+/_-]{12,}={0,2}$/.test(s) || /^https?:/i.test(s)) return null;
  try {
    const d = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').trim();
    return /^https?:\/\/\S+$/i.test(d) ? d : /^\/\/\S+$/.test(d) ? 'https:' + d : null;
  } catch { return null; }
}
