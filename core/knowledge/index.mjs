/* ═══════════════════════════════════════════════════════════
   Knowledge: profiles of sites, as data.

   A profile is a hint to the general reading of a page: which
   elements are the episodes, the dubs, the players, what to call a
   dub the page does not name. Shipped ones live in profiles/ at the
   root; learned ones will live in the Lapka folder under
   .lapka/knowledge/ and have the same shape.

     { "match": "host",               the host, without www
       "dub": "AniLibria",            the name for a dub the page does not name
       "series":   { "title": css },
       "episodes": { "list": css, "number": attr },
       "players":  { "list": css },
       "dubs":     { "list": css } }
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHIPPED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'profiles');

export async function loadProfiles(dirs = [SHIPPED]) {
  const out = [];
  for (const dir of dirs) {
    for (const f of (await fsp.readdir(dir).catch(() => [])).filter(f => f.endsWith('.json')).sort()) {
      const p = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      if (!p.match) throw new Error(`profile ${f} has no match`);
      out.push(p);
    }
  }
  return out;
}

export function profileFor(profiles, url) {
  let host; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  return profiles.find(p => p.match === host || host.endsWith('.' + p.match)) || null;
}
