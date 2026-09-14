/* ═══════════════════════════════════════════════════════════
   Known dubbing studios.

   A dub arrives under whatever name the page or the player gave it:
   "AniLibria", "Анилибрия", "AniLibria.TV", "[AniLibria]". These are
   one studio, and the user expects one row in the audio menu, not
   three. The table maps the spellings we have met to one key.

   This is an amplifier, not a requirement: a name that is not in the
   table still becomes a dub, keyed by its normalised spelling. The
   table only makes known studios merge across players and sites.
   ═══════════════════════════════════════════════════════════ */

export const STUDIOS = [
  { key: 'anilibria',  name: 'AniLibria',  names: ['anilibria', 'анилибрия', 'anilibriatv'] },
  { key: 'anidub',     name: 'AniDub',     names: ['anidub', 'анидаб'] },
  { key: 'dreamcast',  name: 'Dream Cast', names: ['dreamcast', 'дримкаст'] },
  { key: 'jam',        name: 'JAM',        names: ['jam', 'jamclub', 'джем'] },
  { key: 'animevost',  name: 'AnimeVost',  names: ['animevost', 'анимевост'] },
  { key: 'studioband', name: 'StudioBand', names: ['studioband', 'студиябэнд'] },
  { key: 'anistar',    name: 'AniStar',    names: ['anistar', 'анистар'] },
  { key: 'shizaproject', name: 'SHIZA Project', names: ['shizaproject', 'shiza', 'шиза'] },
  { key: 'original',   name: 'Original',   names: ['original', 'оригинал', 'raw', 'japanese', 'японский'] },
  { key: 'subtitles',  name: 'Субтитры',   names: ['subtitles', 'субтитры', 'sub', 'субы'] },
];

const byName = new Map();
for (const s of STUDIOS) for (const n of s.names) byName.set(n, s);

/* Lower-case, no accents on Latin letters, no punctuation, no spaces.
   "AniLibria.TV" and "[Анилибрия]" both survive this as something the
   table knows. Only Latin letters lose their marks: in Cyrillic the
   mark is the letter, and "й" must not turn into "и". */
export function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/(?<=[a-zA-Z])[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function studioFor(name) {
  return byName.get(normalizeName(name)) || null;
}
