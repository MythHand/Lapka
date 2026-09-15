/* ═══════════════════════════════════════════════════════════
   Reading an episode number out of text or a URL.

   Pages say it every way: "1 серия", "Серия 1", "1-я серия",
   "Episode 12", "Ep. 3", "12 話", a bare "3" in a strip of numbers,
   "ep-3", "episode_12", "s01e04", "?episode=7" in the address.
   ═══════════════════════════════════════════════════════════ */

const WORD = '(?:серия|серии|сер\\.?|эпизод|episode|ep\\.?|episodio|capítulo|capitulo|cap\\.?|話)';
const TEXT_AFTER = new RegExp(`(?:^|[^\\d])(\\d{1,4})(?:\\s*-?\\s*[яй])?\\s*${WORD}(?![\\p{L}])`, 'iu');
const TEXT_BEFORE = new RegExp(`${WORD}\\s*[#№]?\\s*(\\d{1,4})(?![\\d])`, 'iu');
const BARE = /^\s*[#№]?\s*(\d{1,4})\s*$/;
const URL_NUM = /(?:^|[/_\-=?&.])(?:s\d{1,2}e|ep|episode|episodio|capitulo|seriya|serie|series|e)[-_/=]?(\d{1,4})(?![\dA-Za-z])/i;

/* The number and the word it goes with. Russian says both "3 серия"
   and "Серия 3"; English says "Episode 13", so in "Part 3 Episode 13"
   the number after the word is the one: an English word takes what
   follows it. */
function episodeMatch(t) {
  const after = TEXT_AFTER.exec(t), before = TEXT_BEFORE.exec(t);
  if (after && before) return /episode|episodio|cap[íi]tulo|\bep\b|ep\.|cap\./i.test(after[0]) ? before : after;
  return after || before;
}
export function numberFromText(text) {
  const t = String(text || '').trim();
  let m = episodeMatch(t);
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

/* "/grand-blue-season-3/11/": a bare number as the last part of the
   path. A weak sign on its own (an id looks the same), taken with
   others. */
export function tailNumberOfUrl(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const m = /^(\d{1,4})$/.exec(segs[segs.length - 1]);
  return m ? Number(m[1]) : null;
}

/* The address with its episode number blanked: what one series'
   episodes share. "/dr-stone-part-3-episode-13-english-subbed/" and
   "/one-piece-episode-1178-english-subbed/" have one shape but two
   stems. Null when the address carries no number. */
export function stemOfUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = u.pathname + u.search;
  const m = URL_NUM.exec(path);
  if (!m) {
    const tail = /^((?:\/[^/]+){1,})\/(\d{1,4})\/?$/.exec(u.pathname);
    return tail ? tail[1] + '/N/' + u.search : null;
  }
  const at = m.index + m[0].lastIndexOf(m[1]);
  return path.slice(0, at) + 'N' + path.slice(at + m[1].length);
}

/* The text with its episode number taken out: what is left is the
   title, if the page gave one. "3 серия — Возвращение" → "Возвращение". */
const DURATION = /(?:^|\s)\d{1,2}:\d{2}(?::\d{2})?(?=\s|$)/g;
export function titleFromText(text) {
  if (BARE.test(text)) return '';
  const t = String(text || '');
  const m = episodeMatch(t);
  return (m ? t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length) : t)
    .replace(DURATION, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:·|]+|[\s\-–—:·|]+$/g, '')
    .trim();
}

/* The address with every segment that carries a number, a uuid or a
   hash made anonymous: two links with the same template are two of
   the same thing. Whole segments, not digits: a uuid has a different
   pattern of digits in every link, and then nothing matches anything. */
export function template(url) {
  let u; try { u = new URL(url); } catch { return String(url).replace(/[^/?&=#]*\d[^/?&=#]*/g, '#'); }
  const path = u.pathname.split('/').map(seg => /\d/.test(seg) ? '#' : seg).join('/');
  const search = u.search.replace(/\d+/g, '#');
  return u.origin + path + search;
}
