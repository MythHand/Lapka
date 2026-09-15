/* ═══════════════════════════════════════════════════════════
   Merging contributions into a catalog.

   No single stage knows the whole tree. Page discovery knows the
   series and its episodes and which players are embedded; each
   extractor knows the dubs and streams of one player; a second
   extractor adds more dubs, some of them the same studio again. Each
   of them hands over a contribution: a partial tree in the catalog's
   own shape, plus where it came from.

     { origin: 'discover:page' | 'extract:kodik' | ...,
       series?:  { title?, altTitles?, cover?, year? },
       episodes: [{ number, title?, sourceUrl?,
                    dubs?: [{ name, studio?, lang?, kind?,
                              sources?: [{ player, embedUrl, extractor?,
                                           streams?: [{ kind, url, quality?, headers?, expiresAt? }] }] }] }] }

   Rules: identities match, never positions. Metadata fills gaps and
   never overwrites what is already known, so the first stage to name
   the series names it and a later extractor cannot rename it. Streams
   are the opposite: the newest set replaces the old one, because an
   old stream is a dead stream.
   ═══════════════════════════════════════════════════════════ */
import {
  createEpisode, createDub, createSource, createStream,
  findEpisode, findDub, findSource, dubKey, UNNAMED_DUB,
} from './model.mjs';

const has = v => v !== undefined && v !== null && v !== '';

function fill(target, patch, keys) {
  for (const k of keys) if (!has(target[k]) && has(patch[k])) target[k] = patch[k];
}

function union(list, extra) {
  for (const v of extra || []) if (has(v) && !list.includes(v)) list.push(v);
}

export function merge(series, contribution) {
  const added = { episodes: 0, dubs: 0, sources: 0, streams: 0 };
  const c = contribution || {};

  if (c.series) {
    fill(series, c.series, ['title', 'cover', 'year']);
    union(series.altTitles, c.series.altTitles);
    /* A title that is not the one we already have is still a title. */
    if (has(c.series.title) && c.series.title !== series.title) union(series.altTitles, [c.series.title]);
  }

  for (const ep of c.episodes || []) {
    let episode = findEpisode(series, ep.number);
    if (!episode) { episode = createEpisode(ep); series.episodes.push(episode); added.episodes++; }
    else fill(episode, ep, ['title', 'sourceUrl', 'duration', 'marks']);

    for (const d of ep.dubs || []) {
      /* an unnamed dub whose streams a named dub already has is that
         dub seen twice, not a second one */
      if (dubKey(d.name) === dubKey(UNNAMED_DUB)) {
        const urls = new Set((d.sources || []).flatMap(s => (s.streams || []).map(st => st.url)));
        if (urls.size && episode.dubs.some(x => x.key !== dubKey(UNNAMED_DUB) && x.sources.some(s => s.streams.some(st => urls.has(st.url))))) continue;
      }
      let dub = findDub(episode, d.name);
      if (!dub) { dub = createDub(d); episode.dubs.push(dub); added.dubs++; }
      else fill(dub, d, ['studio', 'lang']);

      for (const s of d.sources || []) {
        let source = findSource(dub, s.player, s.embedUrl);
        if (!source) { source = createSource({ ...s, origin: s.origin || c.origin || null }); dub.sources.push(source); added.sources++; }
        else fill(source, s, ['extractor']);

        if (s.streams && s.streams.length) {
          source.streams = s.streams.map(createStream);
          added.streams += source.streams.length;
        }
      }
    }
  }

  series.episodes.sort((a, b) => a.number - b.number);
  series.provenance.push({ origin: c.origin || 'unknown', at: Date.now(), added });
  series.updatedAt = Date.now();
  return series;
}
