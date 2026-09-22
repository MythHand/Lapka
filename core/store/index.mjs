/* ═══════════════════════════════════════════════════════════
   The Lapka folder.

   One folder holds everything: the library, the cache, the state,
   what Lapka has learned. It is the user's folder, readable without
   Lapka: series in folders of their own, files with human names.
   Lapka's own things live under .lapka/.

     Lapka/
       <series>/…                         pinned files and their sidecars
       .lapka/cache/<stream>/<name>        segments and playlists as they passed through
       .lapka/state.json                  positions, choices, settings
       .lapka/knowledge/                  learned profiles, reports, health

   The cache is one folder per stream. Eviction is by stream, oldest
   use first, until under the limit, and never a stream used in the
   last few minutes: that one is being watched. A file in the cache is
   the same bytes that would be saved; saving is moving them out from
   under this rule.
   ═══════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GB = 1024 ** 3;
export const HOT_MS = 10 * 60 * 1000;
const LIMIT_MIN_GB = 1;

/* Where the Lapka folder is. Choosing it is the user's, at first
   start, and that comes with the UI; until then it is inside the
   project, under .dev/, so nothing lands anywhere else on the
   machine. LAPKA_HOME overrides. */
export function defaultHome() {
  return process.env.LAPKA_HOME || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.dev', 'home');
}

export async function openStore({ home = defaultHome(), limitGb = 24 } = {}) {
  const own = path.join(home, '.lapka');
  const cacheDir = path.join(own, 'cache');
  const limitFile = path.join(own, 'limit.json');
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.mkdir(path.join(own, 'knowledge'), { recursive: true });

  let limit = Math.max(LIMIT_MIN_GB, Number(limitGb) || 24) * GB;
  try { limit = Math.max(LIMIT_MIN_GB * GB, Number(JSON.parse(await fsp.readFile(limitFile, 'utf8')).gb) * GB); } catch { /* not set yet */ }

  const used = new Map();           // stream id → last use, ms
  const safeName = s => String(s).replace(/[^\w.-]/g, '_').slice(0, 120);

  const cache = {
    dir: cacheDir,
    /* where a stream's things go */
    dirFor(streamId) { return path.join(cacheDir, safeName(streamId)); },
    fileFor(streamId, name) { return path.join(cacheDir, safeName(streamId), safeName(name)); },
    touch(streamId, at = Date.now()) { used.set(streamId, at); },
    async has(streamId, name) { try { return (await fsp.stat(cache.fileFor(streamId, name))).size > 0; } catch { return false; } },
    async read(streamId, name) { return fsp.readFile(cache.fileFor(streamId, name)); },
    /* written to a side name and renamed: a reader never sees half a file */
    async write(streamId, name, bytes) {
      const dir = cache.dirFor(streamId);
      await fsp.mkdir(dir, { recursive: true });
      const file = cache.fileFor(streamId, name);
      await fsp.writeFile(file + '.part', bytes);
      await fsp.rename(file + '.part', file);
      cache.touch(streamId);
      evictSoon();
    },
    /* What the cache holds, and how far it could grow: the disk's free
       space plus what it already takes is the top of the scale. */
    async stat() {
      let bytes = 0, streams = 0, files = 0;
      for (const d of await fsp.readdir(cacheDir).catch(() => [])) {
        const dir = path.join(cacheDir, d);
        let n = 0;
        for (const f of await fsp.readdir(dir).catch(() => [])) { try { bytes += (await fsp.stat(path.join(dir, f))).size; n++; } catch { /* gone */ } }
        if (n) { streams++; files += n; }
      }
      let free = null, total = null, max = null;
      try { const st = await fsp.statfs(cacheDir); free = st.bavail * st.bsize; total = st.blocks * st.bsize; max = bytes + free; } catch { /* no statfs here */ }
      return { bytes, streams, files, limit, min: LIMIT_MIN_GB * GB, free, total, max, dir: cacheDir };
    },
    /* everything but the stream being watched */
    async clear(keep = null) {
      let freed = 0, dropped = 0;
      for (const d of await fsp.readdir(cacheDir).catch(() => [])) {
        if (keep && d === safeName(keep)) continue;
        const dir = path.join(cacheDir, d);
        for (const f of await fsp.readdir(dir).catch(() => [])) { try { freed += (await fsp.stat(path.join(dir, f))).size; } catch { /* gone */ } }
        await fsp.rm(dir, { recursive: true, force: true }); dropped++; used.delete(d);
      }
      return { bytes: freed, files: dropped };
    },
    limit: () => limit,
    async setLimit(gb) {
      limit = Math.max(LIMIT_MIN_GB, Number(gb) || LIMIT_MIN_GB) * GB;
      await fsp.writeFile(limitFile, JSON.stringify({ gb: limit / GB }));
      await evict();
      return limit;
    },
    evict,
    async drop(streamId) { await fsp.rm(cache.dirFor(streamId), { recursive: true, force: true }); used.delete(streamId); },
  };

  let evicting = null;
  function evictSoon() { if (!evicting) evicting = evict().catch(() => {}).finally(() => { evicting = null; }); }

  async function evict({ now = Date.now(), limit: cap = limit } = {}) {
    const entries = [];
    let total = 0;
    for (const d of await fsp.readdir(cacheDir).catch(() => [])) {
      const dir = path.join(cacheDir, d);
      let bytes = 0, mtime = 0;
      for (const f of await fsp.readdir(dir).catch(() => [])) {
        try { const st = await fsp.stat(path.join(dir, f)); bytes += st.size; mtime = Math.max(mtime, st.mtimeMs); } catch { /* gone */ }
      }
      total += bytes;
      entries.push({ id: d, dir, bytes, last: Math.max(mtime, used.get(d) || 0) });
    }
    entries.sort((a, b) => a.last - b.last);
    const dropped = [];
    for (const e of entries) {
      if (total <= cap) break;
      if (now - e.last < HOT_MS) continue;
      await fsp.rm(e.dir, { recursive: true, force: true });
      total -= e.bytes; dropped.push(e.id);
    }
    return { bytes: total, dropped };
  }

  /* what the folder takes apart from the cache: the files kept and Lapka's own notes */
  async function weigh(dir = home) {
    let bytes = 0;
    for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, d.name);
      if (p === cacheDir) continue;
      if (d.isDirectory()) bytes += await weigh(p);
      else if (d.isFile()) { try { bytes += (await fsp.stat(p)).size; } catch { /* gone */ } }
    }
    return bytes;
  }
  /* what Lapka learned about sites, dropped; the folder stays for what comes next */
  async function forgetKnowledge() {
    const dir = path.join(own, 'knowledge');
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
  }

  return { home, own, cache, weigh, forgetKnowledge };
}

export const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
