/* ═══════════════════════════════════════════════════════════
   Extractors: from an embedded player to its streams.

   One file per player under players/. Each exports:

     name            'kodik', 'generic', …
     match(url)      does this extractor speak this player's language
     extract(embedUrl, context, session) → {
       streams: [{ kind, url, quality?, headers? }],   what the embed plays as it is
       dubs:    [{ name, streams: [...] }],             if the embed carries a dub switch of its own
       subs:    [{ url, lang?, label?, format?, default? }],   subtitle tracks the embed offers
     }

   The registry loads the folder at start and asks the extractors in
   order: the ones that name a player first, the generic one last.
   Adding a player is adding a file.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function loadExtractors(dir = path.join(HERE, 'players')) {
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.mjs')).sort();
  const list = [];
  for (const f of files) {
    const m = await import(pathToFileURL(path.join(dir, f)).href);
    const x = m.default || m;
    if (typeof x.match !== 'function' || typeof x.extract !== 'function' || !x.name) throw new Error(`extractor ${f} is missing name, match or extract`);
    list.push(x);
  }
  /* generic last, whatever the file order */
  list.sort((a, b) => (a.name === 'generic') - (b.name === 'generic'));
  return list;
}

export function extractorFor(extractors, url) {
  return extractors.find(x => x.match(url)) || null;
}

/* Doors known to be closed: players no extractor can open, tried and
   documented (YouTube needs a browser's proof-of-work and a decoded
   player script). Asking them costs a request and, when the host is
   slow or unreachable, the whole connection timeout, once per page of
   a franchise. They are refused at once and said so. */
const CLOSED_DOORS = [
  { host: /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i, why: 'закрытая дверь: YouTube играет только в браузере' },
];
export function closedDoor(url) {
  let host; try { host = new URL(url).hostname; } catch { return null; }
  return CLOSED_DOORS.find(d => d.host.test(host))?.why || null;
}
