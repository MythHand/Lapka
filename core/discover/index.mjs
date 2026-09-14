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
import { findEpisodes } from './episodes.mjs';
import { findPlayers } from './players.mjs';

/* What a page with one player and no dub switch offers: a dub Lapka
   cannot name. The user sees this name until an extractor does better. */
export const UNNAMED_DUB = 'Основной';

export function discover({ html, url, profile = null }) {
  const { document: doc } = parseHTML(String(html));
  const steps = [];

  const title = findTitle(doc, { profile });
  const cover = findCover(doc, url);
  const episodes = findEpisodes(doc, url, { profile });
  const { players, switches } = findPlayers(doc, url, { profile });
  const seriesUrl = findSeriesUrl(doc, url);
  const current = findCurrentEpisode(doc, url);

  const kind = players.length ? 'episode' : episodes.items.length ? 'series' : 'unknown';

  /* on an episode page the heading carries the number; the series title is what is left */
  const titleValue = title[0]?.value || '';
  const seriesTitle = kind === 'episode' ? (titleFromText(titleValue.split(/\s+[—–|]\s+/)[0]) || titleValue) : titleValue;

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
    url, kind, profile: profile?.match || null,
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
    const direct = report.players.filter(p => p.stream && !p.dubLabel);
    const unnamedEmbeds = report.players.filter(p => !p.dubLabel && !p.stream);

    for (const p of named) dub(p.dubLabel).sources.push({ player: p.id, embedUrl: p.url, streams: p.stream ? [{ kind: p.stream, url: p.url }] : undefined });
    /* a stream on the page itself, nobody named it: the page is the player */
    if (direct.length && !named.length && !unnamedEmbeds.length) {
      const d = dub(UNNAMED_DUB);
      d.sources.push({ player: 'page', embedUrl: report.url, streams: direct.map(p => ({ kind: p.stream, url: p.url })) });
    }
    if (!ep.dubs.length) delete ep.dubs;
  }
  return c;
}

export { findTitle, findCover, findSeriesUrl, findCurrentEpisode, findEpisodes, findPlayers };
