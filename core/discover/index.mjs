/* ═══════════════════════════════════════════════════════════
   Discovery: from one page to a report, from a report to a
   contribution.

   The report is what Lapka saw: every candidate, with its confidence
   and where it was found. It is kept, shown in the inspector and fed
   to whoever writes a profile. The contribution is what Lapka is sure
   enough of to put in the catalog. The two are separate on purpose:
   the report may be rich and wrong, the catalog must be sparse and
   right.
   ═══════════════════════════════════════════════════════════ */
import { parseHTML } from 'linkedom';
import { findTitle, findCover, findSeriesUrl, findCurrentEpisode, titleFromText } from './series.mjs';
import { numberFromText } from './numbers.mjs';
import { findEpisodes } from './episodes.mjs';
import { findPlayers, qualityOf } from './players.mjs';
import { template } from './numbers.mjs';
import { UNNAMED_DUB } from '../catalog/model.mjs';

export { UNNAMED_DUB };

export function discover({ html, url, profile = null }) {
  const { document: doc } = parseHTML(String(html));
  const steps = [];

  const title = findTitle(doc, { profile });
  const cover = findCover(doc, url);
  const episodes = findEpisodes(doc, url, { profile });
  const { players, switches } = findPlayers(doc, url, { profile });
  const seriesUrl = findSeriesUrl(doc, url);
  const current = findCurrentEpisode(doc, url);

  /* A player element on the page makes it an episode page. Streams
     found only in scripts do not: a series page may carry the
     streams of every episode in its data. There the list of
     episodes decides, unless the page names which episode it is. */
  const inline = players.some(p => p.kind !== 'script');
  const kind = inline ? 'episode'
    : episodes.items.length >= 2 && !current.length ? 'series'
    : players.length ? 'episode'
    : episodes.items.length ? 'series' : 'unknown';

  /* On an episode page the heading carries the episode; the series is
     what is left. Parts split by a dash or a bar: the part with the
     episode goes, and the series is the first part unless the episode
     came first, then it is the last ("Episode 8 | its name | Series"). */
  const titleValue = title[0]?.value || '';
  let seriesTitle = titleValue;
  if (kind === 'episode' && titleValue) {
    const parts = titleValue.split(/\s+[—–|]\s+/);
    const hasNumber = p => numberFromText(p) !== null;
    const rest = parts.filter(p => !hasNumber(p));
    if (parts.length > 1 && rest.length) seriesTitle = hasNumber(parts[0]) ? rest[rest.length - 1] : rest[0];
    else seriesTitle = titleFromText(parts[0]) || titleValue;
  }

  if (seriesTitle) steps.push(`Сериал: ${seriesTitle}`);
  if (episodes.items.length) steps.push(`Нашла ${episodes.items.length} ${plural(episodes.items.length, 'серию', 'серии', 'серий')}`);
  const dubLabels = [...new Set(players.filter(p => p.dubLabel).map(p => p.dubLabel))];
  const ids = [...new Set(players.map(p => p.id))];
  if (players.length) steps.push(`Нашла ${ids.length} ${plural(ids.length, 'плеер', 'плеера', 'плееров')}`);
  if (dubLabels.length) steps.push(`Нашла ${dubLabels.length} ${plural(dubLabels.length, 'озвучку', 'озвучки', 'озвучек')}`);
  const pending = players.filter(p => !p.dubLabel && !p.stream);
  if (pending.length && dubLabels.length) steps.push(`${pending.length} ${plural(pending.length, 'плеер ждёт', 'плеера ждут', 'плееров ждут')} экстрактор`);
  if (kind === 'unknown') steps.push('Не нашла на странице ни серий, ни плеера');

  return {
    url, kind, profile: profile?.match || null, defaultDub: profile?.dub || null,
    title: { value: seriesTitle, candidates: title },
    cover: { value: cover[0]?.value || null, candidates: cover },
    seriesUrl: { value: kind === 'episode' ? seriesUrl[0]?.value || null : null, candidates: seriesUrl },
    episode: { value: kind === 'episode' ? current[0]?.value ?? null : null, candidates: current },
    episodes,
    players, switches,
    steps,
  };
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* The catalog gets: the series, its episodes, and for the episode on
   this page every player the page named a dub for, plus a stream that
   sits right on the page. A player the page did not name a dub for is
   not guessed at; it waits in the report for an extractor. */
export function toContribution(report, { origin = 'discover:page' } = {}) {
  const c = { origin, series: {}, episodes: [] };
  if (report.title.value) c.series.title = report.title.value;
  if (report.cover.value) c.series.cover = report.cover.value;

  for (const e of report.episodes.items) c.episodes.push({ number: e.number, title: e.title || undefined, sourceUrl: e.url });

  if (report.kind === 'episode' && report.episode.value !== null) {
    const number = report.episode.value;
    let ep = c.episodes.find(e => e.number === number);
    if (!ep) { ep = { number, sourceUrl: report.url }; c.episodes.push(ep); }
    ep.dubs = ep.dubs || [];
    const dub = name => { let d = ep.dubs.find(x => x.name === name); if (!d) { d = { name, sources: [] }; ep.dubs.push(d); } return d; };

    const named = report.players.filter(p => p.dubLabel);
    const direct = ownStreams(report.players.filter(p => p.stream && !p.dubLabel), number);
    const unnamedEmbeds = report.players.filter(p => !p.dubLabel && !p.stream);

    for (const p of named) dub(p.dubLabel).sources.push({ player: p.id, embedUrl: p.url, streams: p.stream ? [{ kind: p.stream, url: p.url, quality: qualityOf(p.url) }] : undefined });
    /* a stream on the page itself, nobody named it: the page is the
       player, and the dub is what the profile calls it, if anything */
    if (direct.length && !named.length && !unnamedEmbeds.length) {
      const d = dub(report.defaultDub || UNNAMED_DUB);
      d.sources.push({ player: 'page', embedUrl: report.url, streams: direct.map(p => ({ kind: p.stream, url: p.url, quality: qualityOf(p.url) })) });
    }
    if (!ep.dubs.length) delete ep.dubs;
  }
  return c;
}

/* A page may carry the streams of every episode of the series in its
   data. The ones that name this episode as a folder of their path,
   while their look-alikes name other numbers, are this episode's;
   the rest belong to the others. */
function ownStreams(streams, number) {
  if (streams.length < 2 || number === null) return streams;
  const segs = u => { try { return new URL(u).pathname.split('/'); } catch { return []; } };
  const mine = streams.filter(p => segs(p.url).includes(String(number)));
  if (!mine.length) return streams;
  const shapes = new Set(mine.map(p => template(segs(p.url).join('/'))));
  const rivals = streams.filter(p => !mine.includes(p) && shapes.has(template(segs(p.url).join('/'))));
  return rivals.length ? mine : streams;
}

export { findTitle, findCover, findSeriesUrl, findCurrentEpisode, findEpisodes, findPlayers };
