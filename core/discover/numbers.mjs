/* ═══════════════════════════════════════════════════════════
   Reading an episode number out of text or a URL.

   Pages say it every way: "1 серия", "Серия 1", "1-я серия",
   "Episode 12", "Ep. 3", "12 話", a bare "3" in a strip of numbers,
   "ep-3", "episode_12", "s01e04", "?episode=7" in the address.
   ═══════════════════════════════════════════════════════════ */

const WORD = '(?:серия|серии|сер\\.?|эпизод|episode|ep\\.?|話)';
const TEXT_AFTER = new RegExp(`(?:^|[^\\d])(\\d{1,4})(?:\\s*-?\\s*[яй])?\\s*${WORD}(?![\\p{L}])`, 'iu');
const TEXT_BEFORE = new RegExp(`${WORD}\\s*[#№]?\\s*(\\d{1,4})(?![\\d])`, 'iu');
const BARE = /^\s*[#№]?\s*(\d{1,4})\s*$/;
const URL_NUM = /(?:^|[/_\-=?&.])(?:s\d{1,2}e|ep|episode|seriya|serie|series|e)[-_/=]?(\d{1,4})(?![\d])/i;

export function numberFromText(text) {
  const t = String(text || '').trim();
  let m = TEXT_AFTER.exec(t) || TEXT_BEFORE.exec(t);
  if (m) return Number(m[1]);
  /* a bare number, unless it is a year: nothing calls episode 2024 by
     its number alone */
  m = BARE.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1900 && n <= 2100 ? null : n;
}

export function numberFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const m = URL_NUM.exec(u.pathname + u.search);
  return m ? Number(m[1]) : null;
}

/* The text with its episode number taken out: what is left is the
   title, if the page gave one. "3 серия — Возвращение" → "Возвращение". */
export function titleFromText(text) {
  return String(text || '')
    .replace(TEXT_AFTER, ' ').replace(TEXT_BEFORE, ' ')
    .replace(/^[\s\-–—:·|]+|[\s\-–—:·|]+$/g, '')
    .trim();
}

/* The address with its digits made anonymous: two links with the same
   template are two of the same thing. */
export const template = url => String(url).replace(/\d+/g, '#');
