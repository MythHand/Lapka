/* ═══════════════════════════════════════════════════════════
   The library: pinned episodes as files with human names.

     Lapka/
       <Series title>/
         series.json                             the catalog snapshot
         cover.jpg
         03 · Episode title [AniLibria].mp4       the episode
         03 · Episode title [AniLibria].json      its sidecar

   The sidecar is what makes the file findable again: which series,
   which episode, which dub, where it came from. The library is the
   set of sidecars on disk; nothing else is kept about it, so the
   folder can be moved, copied or half-deleted and Lapka still reads
   what is there.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { toSnapshot } from '../catalog/snapshot.mjs';

export const SIDECAR_V = 1;

/* A name a file system and a person both accept. */
export function safeName(s, max = 80) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '·').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, max) || 'Без названия';
}

export function fileNameFor(series, episode, dub, ext = 'mp4') {
  const n = String(episode.number).padStart(2, '0');
  const title = episode.title ? ` · ${safeName(episode.title, 60)}` : '';
  return `${n}${title} [${safeName(dub.name, 40)}].${ext}`;
}

export function openLibrary(home) {
  const seriesDir = series => path.join(home, safeName(series.title || series.id));
  const inside = p => { const r = path.resolve(p); return r === path.resolve(home) || r.startsWith(path.resolve(home) + path.sep); };

  return {
    home, seriesDir, inside,

    /* where an episode's file will go, and the sidecar beside it */
    placeFor(series, episode, dub, ext) {
      const dir = seriesDir(series);
      const file = path.join(dir, fileNameFor(series, episode, dub, ext));
      return { dir, file, sidecar: file.replace(/\.[^.]+$/, '.json') };
    },

    /* the series folder with its snapshot and cover, made or refreshed */
    async keepSeries(series, cover = null) {
      const dir = seriesDir(series);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'series.json'), JSON.stringify(toSnapshot(series), null, 1));
      if (cover) await fsp.writeFile(path.join(dir, 'cover.jpg'), cover).catch(() => {});
      return dir;
    },

    async writeSidecar(sidecarPath, info) {
      await fsp.writeFile(sidecarPath, JSON.stringify({ v: SIDECAR_V, ...info }, null, 1));
    },

    /* the given episodes of a series taken off the disk, file and sidecar;
       the series folder goes with them when no episode is left in it */
    async remove(seriesId, episodes) {
      const eps = new Set(episodes.map(Number));
      const s = (await this.list()).find(x => x.id === seriesId);
      if (!s) return { removed: 0 };
      let removed = 0;
      for (const e of s.episodes) {
        if (!eps.has(Number(e.episode))) continue;
        await fsp.rm(e.path, { force: true }).catch(() => {});
        await fsp.rm(e.path.replace(/\.[^.]+$/, '.json'), { force: true }).catch(() => {});
        removed++;
      }
      const left = (await this.list()).find(x => x.id === seriesId);
      if (!left || !left.episodes.length) await fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {});
      return { removed, dir: s.dir };
    },

    /* every pinned episode on disk, by series */
    async list() {
      const out = new Map();
      for (const d of await fsp.readdir(home, { withFileTypes: true }).catch(() => [])) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        const dir = path.join(home, d.name);
        let snapshot = null;
        try { snapshot = JSON.parse(await fsp.readFile(path.join(dir, 'series.json'), 'utf8')); } catch { /* a folder without a snapshot still counts */ }
        const episodes = [];
        for (const f of await fsp.readdir(dir).catch(() => [])) {
          if (!f.endsWith('.json') || f === 'series.json') continue;
          try {
            const side = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
            if (side.v !== SIDECAR_V) continue;
            const file = path.join(dir, side.file);
            const st = await fsp.stat(file).catch(() => null);
            if (!st) continue;
            episodes.push({ ...side, path: file, size: st.size });
          } catch { /* not ours */ }
        }
        if (!episodes.length && !snapshot) continue;
        const id = snapshot?.id || episodes[0]?.seriesId || d.name;
        out.set(id, { id, title: snapshot?.title || episodes[0]?.seriesTitle || d.name, dir, snapshot, cover: path.join(dir, 'cover.jpg'), episodes: episodes.sort((a, b) => a.episode - b.episode) });
      }
      return [...out.values()];
    },
  };
}
