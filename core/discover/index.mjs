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
import { findTitle, findCover, findSeriesUrl, findCurrentEpisode, titleFromText, seasonFromText, seasonFromUrl, tidyTitle, findFranchise, franchiseFromBlock, findSelf } from './series.mjs';
import { numberFromText, numberFromUrl, tailNumberOfUrl, stemOfUrl } from './numbers.mjs';
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
  let episodes = findEpisodes(doc, url, { profile });
  const { players, switches } = findPlayers(doc, url, { profile });
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  /* the series' own name, for a link that carries it: the heading without the episode and the tail */
  const probableSeries = tidyTitle(titleFromText(title[0]?.value || '') || title[0]?.value || '', host).title;
  const seriesUrl = findSeriesUrl(doc, url, probableSeries);
  const current = findCurrentEpisode(doc, url);
  const ownSeason = seasonFromText(title[0]?.value || '') ?? seasonFromUrl(url);
  /* A block the site heads as the franchise is the site's own word,
     with years, films and specials in it; links that only name seasons
     are an inference from the text. The block wins when it knows at
     least as many parts, else the season links. */
  const bySeasons = findFranchise(doc, url, ownSeason, title[0]?.value || '');
  const self = findSelf(doc);
  const byBlock = franchiseFromBlock(doc, url, title[0]?.value || '', self);
  const franchise = byBlock.length && byBlock.length >= bySeasons.length ? byBlock : bySeasons;

  /* No list of episodes, but the page says how many there are: the
     others are the same address with the other numbers. On an episode
     page its own address is the template, and a planned total would
     name episodes not yet out, so only the last one out counts; on a
     series page the link to the last episode out is the template. */
  const sure = current.find(c => c.confidence >= 0.4) || null;
  if (!episodes.items.length) {
    const ownNumber = sure && (numberFromUrl(url) === sure.value || tailNumberOfUrl(url) === sure.value) ? sure.value : null;
    const count = findEpisodeCount(doc, { strict: ownNumber !== null });
    let stem = null;
    if (count && ownNumber !== null && count >= ownNumber) stem = stemOfUrl(url);
    else if (count && ownNumber === null) {
      const origin = (() => { try { return new URL(url).origin; } catch { return null; } })();
      for (const a of doc.querySelectorAll('a[href]')) {
        let u; try { u = new URL(a.getAttribute('href'), url); } catch { continue; }
        if (u.origin !== origin) continue;
        if ((numberFromUrl(u.toString()) ?? tailNumberOfUrl(u.toString())) === count) { stem = stemOfUrl(u.toString()); if (stem) break; }
      }
      /* no such link: the script that draws the list may build the
         address itself, "'…/grand-blue-season-2/' + item.number + '/'" */
      if (!stem) stem = templateFromScripts(doc, url);
    }
    const dated = stem && /\/\d{4}\/\d{2}\/\d{2}\//.test(stem);   // an address with a date in it names one day's page, not a template
    if (count && count <= 2000 && stem && !dated) {
      const origin = new URL(url).origin;
      const items = [];
      for (let n = 1; n <= count; n++) items.push({ number: n, title: '', url: origin + stem.replace('N', String(n)) });
      episodes = { ...episodes, items, by: 'template', confidence: 0.5 };
      steps.push(`Серии по шаблону адреса: ${count}`);
    }
  }

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

  /* the tail a site writes for search engines goes; a year in brackets is the year */
  const tidy = tidyTitle(seriesTitle, host);
  seriesTitle = tidy.title;
  /* "Grand Blue Season 3 11" on the page of episode 11: the bare number at the end is the episode */
  if (kind === 'episode' && sure && new RegExp(`\\s${sure.value}$`).test(seriesTitle)) seriesTitle = seriesTitle.replace(/\s\d+$/, '').trim();
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
    episode: { value: kind === 'episode' ? sure?.value ?? null : null, candidates: current },
    /* a place in a list of seasons is a season; a place in a block ordered
       by year, with films and specials in it, is not, save one thing: the
       page that nothing numbers and that is the earliest series of its
       franchise is the first season, the one sites leave unnumbered */
    season: ownSeason ?? (franchise === bySeasons ? franchise.find(f => f.self)?.order ?? null : firstSeason(franchise)),
    year: self.year ?? tidy.year, kind_: self.kind,
    franchise,
    episodes,
    players, switches,
    steps,
  };
}

/* An address the page's script builds for an episode: a string of
   this site, a number-named variable glued after it, sometimes a
   tail. The stem is that string with N where the number goes. */
const BUILDER = /(['"])((?:https?:)?\/\/[^'"\s]+?\/|\/[^'"\s]*?\/)\1\s*\+\s*[\w.$]*(?:number|numero|num|episode|episodio|capitulo|cap|ep)\w*\s*(?:\+\s*(['"])([^'"\s]*)\3)?/i;
function templateFromScripts(doc, url) {
  let origin; try { origin = new URL(url).origin; } catch { return null; }
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = BUILDER.exec(s.textContent || '');
    if (!m) continue;
    let base; try { base = new URL(m[2], url); } catch { continue; }
    if (base.origin !== origin || base.pathname.length < 3) continue;
    return base.pathname + 'N' + (m[4] || '') + base.search;
  }
  return null;
}

/* How many episodes the page says there are: an attribute of the
   list, or words ("Último episodio: … 11", "26 серий", "Episodes: 12"). */
const COUNT_ATTRS = ['data-max-episode', 'data-episodes', 'data-total-episodes', 'data-episode-count', 'data-total'];
function findEpisodeCount(doc, { strict = false } = {}) {
  for (const attr of COUNT_ATTRS) for (const el of doc.querySelectorAll(`[${attr}]`)) { const n = Number(el.getAttribute(attr)); if (Number.isFinite(n) && n > 0) return n; }
  let text = '';
  try { text = (doc.body?.textContent || '').replace(/\s+/g, ' '); } catch { /* an empty document has no body */ }
  /* "Último episodio: Grand Blue Season 3 - 11": the element that says
     so, and the link in it; failing the link, the number that follows */
  const LAST = /^\s*(?:último|ultimo|last)\s+(?:episodio|episode|capítulo|серия)/i;
  for (const el of doc.querySelectorAll('p, div, li, span, dd, td')) {
    if (!LAST.test(el.textContent || '')) continue;
    const a = el.querySelector('a[href]');
    if (a) {
      let u; try { u = new URL(a.getAttribute('href'), doc.URL || 'https://x/'); } catch { u = null; }
      const n = u ? (numberFromUrl(u.toString()) ?? tailNumberOfUrl(u.toString())) : null;
      if (n !== null) return n;
      const m = /(\d{1,4})\s*$/.exec((a.textContent || '').trim()); if (m) return Number(m[1]);
    }
    const m = /(\d{1,4})\b/.exec((el.textContent || '').replace(LAST, '')); if (m) return Number(m[1]);
    break;
  }
  if (strict) return null;
  for (const re of [/\b(\d{1,4})\s*(?:серий|серии|episodes?|episodios?|capítulos?|capitulos?)\b/i, /(?:серий|episodes?|episodios?|capítulos?)\s*[:：]\s*(\d{1,4})\b/i]) {
    const m = re.exec(text); if (m) return Number(m[1]);
  }
  return null;
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
function firstSeason(franchise) {
  const self = franchise.find(f => f.self);
  if (!self || self.kind !== 'tv') return null;
  return franchise.find(f => f.kind === 'tv') === self ? 1 : null;
}

export function toContribution(report, { origin = 'discover:page' } = {}) {
  const c = { origin, series: {}, episodes: [] };
  if (report.title.value) c.series.title = report.title.value;
  if (report.cover.value) c.series.cover = report.cover.value;
  if (report.season !== null && report.season !== undefined) c.series.season = report.season;
  if (report.year) c.series.year = report.year;
  if (report.kind_) c.series.kind = report.kind_;
  if (report.franchise && report.franchise.length) {
    c.series.franchise = report.franchise;
    const self = report.franchise.find(f => f.self);
    if (self && self.kind) c.series.kind = self.kind;   // a film among the parts is a film
  }

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
