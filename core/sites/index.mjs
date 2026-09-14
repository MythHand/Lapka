/* ═══════════════════════════════════════════════════════════
   Site adapters: knowledge of one site, as code.

   A profile is a hint in data and covers most sites. Some sites are
   better read through what they offer themselves: a public API that
   names the episodes, the studio and the streams in one answer. An
   adapter does that, and only that. It never replaces the general
   reading of the page: the page is read first, the adapter's
   contribution merges on top, and without the adapter the page still
   plays. One file per site under sites/, loaded at start.

     name              'aniliberty'
     match(url)        is this the site
     look(url, session) → { origin, seriesUrl?, start?, series?, episodes? }
                       the same contribution shape the catalog merges,
                       plus the series page's address and the episode
                       the link pointed at, when the adapter knows them
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function loadSites(dir = HERE) {
  const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.mjs') && f !== 'index.mjs').sort();
  const list = [];
  for (const f of files) {
    const m = await import(pathToFileURL(path.join(dir, f)).href);
    const x = m.default || m;
    if (typeof x.match !== 'function' || typeof x.look !== 'function' || !x.name) throw new Error(`site adapter ${f} is missing name, match or look`);
    list.push(x);
  }
  return list;
}

export function siteFor(sites, url) {
  return sites.find(s => { try { return s.match(url); } catch { return false; } }) || null;
}
