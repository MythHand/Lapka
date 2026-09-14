/* ═══════════════════════════════════════════════════════════
   What of a catalog goes to disk.

   Everything except streams. A stream URL is signed for an hour and
   for one IP; written to disk it is a lie by the time it is read back.
   Sources stay, with their health: that is how Lapka remembers which
   player was answering last time. Provenance stays, for the inspector.
   ═══════════════════════════════════════════════════════════ */
import { createSeries } from './model.mjs';

export const SNAPSHOT_V = 1;

export function toSnapshot(series) {
  return {
    v: SNAPSHOT_V,
    id: series.id,
    sourceUrl: series.sourceUrl,
    title: series.title,
    altTitles: [...series.altTitles],
    cover: series.cover,
    year: series.year,
    updatedAt: series.updatedAt,
    provenance: series.provenance.map(p => ({ ...p, added: { ...p.added } })),
    episodes: series.episodes.map(e => ({
      number: e.number, title: e.title, sourceUrl: e.sourceUrl, duration: e.duration,
      dubs: e.dubs.map(d => ({
        key: d.key, name: d.name, studio: d.studio, lang: d.lang, kind: d.kind,
        sources: d.sources.map(s => ({
          id: s.id, player: s.player, embedUrl: s.embedUrl, extractor: s.extractor, origin: s.origin,
          health: { ...s.health },
        })),
      })),
    })),
  };
}

export function fromSnapshot(snap) {
  if (!snap || snap.v !== SNAPSHOT_V) throw new Error(`unknown snapshot version ${snap && snap.v}`);
  const series = createSeries({ sourceUrl: snap.sourceUrl, title: snap.title, altTitles: snap.altTitles, cover: snap.cover, year: snap.year });
  series.updatedAt = snap.updatedAt || series.updatedAt;
  series.provenance = (snap.provenance || []).map(p => ({ ...p }));
  series.episodes = (snap.episodes || []).map(e => ({
    number: e.number, title: e.title || '', sourceUrl: e.sourceUrl || null, duration: e.duration || null,
    dubs: (e.dubs || []).map(d => ({
      key: d.key, name: d.name, studio: d.studio || null, lang: d.lang || null, kind: d.kind || 'dub',
      sources: (d.sources || []).map(s => ({
        id: s.id, player: s.player, embedUrl: s.embedUrl, extractor: s.extractor || null, origin: s.origin || null,
        health: { ok: null, checkedAt: null, error: null, ...(s.health || {}) },
        streams: [],
      })),
    })),
  }));
  return series;
}
