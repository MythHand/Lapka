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

/* an address hidden in base64 (plain or URL-safe), or null */
export function urlFromBase64(v) {
  const s = String(v || '').trim();
  if (!/^[A-Za-z0-9+/_-]{12,}={0,2}$/.test(s) || /^https?:/i.test(s)) return null;
  try {
    const d = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').trim();
    return /^https?:\/\/\S+$/i.test(d) ? d : /^\/\/\S+$/.test(d) ? 'https:' + d : null;
  } catch { return null; }
}
