/* ═══════════════════════════════════════════════════════════
   Lapka itself: the blocks wired into one thing.

   Given an address, it fetches the page through the session, reads
   it, and if the page turns out to be one episode, goes up to the
   series page and reads that too. Then every player the episode page
   embeds is opened by an extractor, and what it plays lands in the
   catalog as streams. What Lapka learned is one catalog; what it saw
   stays in the reports.
   ═══════════════════════════════════════════════════════════ */
import { createSession } from './session/index.mjs';
import { discover, toContribution, UNNAMED_DUB } from './discover/index.mjs';
import { loadExtractors, extractorFor } from './extract/index.mjs';
import { loadSites, siteFor } from './sites/index.mjs';
import { loadProfiles, profileFor as profileOf } from './knowledge/index.mjs';
import { createSeries, merge, allDubs, findEpisode, markHealth, pickDub, pickSource, bestStream } from './catalog/index.mjs';

export async function bootLapka(opts = {}) {
  return createLapka({ extractors: await loadExtractors(), sites: await loadSites(), profiles: await loadProfiles(), ...opts });
}

export function createLapka({ session = createSession(), profiles = [], extractors = [], sites = [], delivery = null } = {}) {
  /* every series looked at this run, so a stream id can be traced back
     to its series, episode, dub and source when the user saves it */
  const seen = new Map();
  function context(streamId) {
    const entry = delivery && delivery.get(streamId);
    if (!entry) return null;
    const series = seen.get(entry.meta.seriesId);
    if (!series) return null;
    const episode = series.episodes.find(e => e.number === entry.meta.episode);
    const dub = episode && episode.dubs.find(d => d.key === entry.meta.dub);
    const source = dub && dub.sources.find(s => s.id === entry.meta.sourceId);
    const stream = source && source.streams.find(st => st.id === streamId);
    return stream ? { series, episode, dub, source, stream } : null;
  }

  const profileFor = url => profileOf(profiles, url);

  async function readPage(url, referer = null) {
    const res = await session.fetch(url, { referer });
    if (res.status >= 400) throw new Error(`${url} answered ${res.status}`);
    return discover({ html: res.body, url: res.url || url, profile: profileFor(url) });
  }

  /* One embedded player opened: what it plays, as a contribution for
     this episode. A player the page named a dub for gets its streams
     under that dub; a player that carries its own dub switch brings
     its dubs along; a player that gives nothing is reported as such. */
  async function openPlayer(player, number, pageUrl) {
    const x = extractorFor(extractors, player.url);
    if (!x) return { player, error: 'no extractor' };
    try {
      const got = await x.extract(player.url, { referer: pageUrl }, session);
      const source = streams => ({ player: player.id, embedUrl: player.url, extractor: x.name, streams });
      let dubs;
      if (got.dubs?.length) dubs = got.dubs.map(d => ({ name: d.name, sources: [source(d.streams)] }));
      else if (got.streams?.length) dubs = [{ name: player.dubLabel || UNNAMED_DUB, sources: [source(got.streams)] }];
      else return { player, extractor: x.name, error: 'no streams' };
      return { player, extractor: x.name, contribution: { origin: `extract:${x.name}`, episodes: [{ number, dubs }] } };
    } catch (e) {
      return { player, extractor: x.name, error: e.message };
    }
  }

  /* Streams get an address the player can ask for. */
  function registerStreams(series) {
    if (!delivery) return;
    for (const e of series.episodes) for (const d of e.dubs) for (const s of d.sources) for (const st of s.streams) {
      if (st.id) continue;
      st.id = delivery.register(st, { sourceId: s.id, seriesId: series.id, episode: e.number, dub: d.key });
      st.play = `/api/stream/${st.id}.${st.kind === 'mp4' ? 'mp4' : 'm3u8'}`;
    }
  }

  /* The players of one episode page, opened, into the series. */
  async function openPlayers(series, report) {
    const number = report.episode.value;
    const embeds = report.players.filter(p => !p.stream);
    const results = await Promise.all(embeds.map(p => openPlayer(p, number, report.url)));
    const opened = [];
    for (const r of results) {
      opened.push({ player: r.player.id, url: r.player.url, extractor: r.extractor || null, error: r.error || null,
        streams: r.contribution ? r.contribution.episodes[0].dubs.reduce((n, d) => n + d.sources[0].streams.length, 0) : 0 });
      if (r.contribution) merge(series, r.contribution);
    }
    const ep = findEpisode(series, number);
    if (ep) for (const d of ep.dubs) for (const s of d.sources) {
      const r = results.find(x => x.player.url === s.embedUrl);
      if (r) markHealth(s, !r.error, r.error);
    }
    const steps = [];
    if (embeds.length) {
      const ok = results.filter(r => r.contribution).length;
      steps.push(ok === embeds.length ? `Открыла ${embeds.length} ${plural(embeds.length, 'плеер', 'плеера', 'плееров')}, потоки есть`
        : `Открыла ${ok} из ${embeds.length} ${plural(embeds.length, 'плеера', 'плееров', 'плееров')}`);
      for (const r of results) if (r.error) steps.push(`${r.player.id}: ${r.error}`);
    }
    if (ep) ep.opened = true;
    registerStreams(series);
    return { opened, steps };
  }

  const series = id => seen.get(id) || null;

  /* One episode of a known series, its page read and its players opened. */
  async function openEpisode(seriesId, number) {
    const s = seen.get(seriesId);
    if (!s) throw Object.assign(new Error('unknown series; look at its page first'), { code: 404 });
    const ep = findEpisode(s, number);
    if (!ep) throw Object.assign(new Error('unknown episode'), { code: 404 });
    if (ep.opened) return ep;
    if (!ep.sourceUrl) { ep.opened = true; return ep; }
    const report = await readPage(ep.sourceUrl, s.sourceUrl);
    if (report.kind === 'episode' && report.episode.value === null) report.episode.value = number;
    merge(s, toContribution(report));
    if (report.kind === 'episode') await openPlayers(s, report);
    ep.opened = true;
    registerStreams(s);
    return ep;
  }

  /* What to play: the episode opened if it is not yet, the dub the
     user wants or the nearest thing to it, a live source, its best
     stream. `avoid` is a stream that just failed: its source is
     marked dead and another is picked. */
  async function resolve({ seriesId, number, dubKey = null, avoid = null }) {
    const s = seen.get(seriesId);
    if (!s) throw Object.assign(new Error('unknown series; look at its page first'), { code: 404 });
    const ep = await openEpisode(seriesId, number);
    if (avoid) for (const d of ep.dubs) for (const src of d.sources) if (src.streams.some(st => st.id === avoid)) markHealth(src, false, 'playback failed');
    const dub = pickDub(ep, dubKey ? { name: dubKey } : null);
    const source = dub ? pickSource(dub) : null;
    const stream = source ? bestStream(source) : null;
    return {
      series: { id: s.id, title: s.title },
      episode: { number: ep.number, title: ep.title, sourceUrl: ep.sourceUrl },
      dubs: ep.dubs.map(d => ({ key: d.key, name: d.name, alive: d.sources.filter(x => x.health.ok !== false && x.streams.length).length, sources: d.sources.length })),
      dub: dub ? { key: dub.key, name: dub.name } : null,
      source: source ? { id: source.id, player: source.player, extractor: source.extractor } : null,
      stream: stream ? { id: stream.id, kind: stream.kind, quality: stream.quality, play: stream.play } : null,
    };
  }

  /* One address in, a catalog and the reports behind it out. */
  async function look(url) {
    const reports = [];
    const first = await readPage(url);
    reports.push(first);

    /* a site Lapka knows through its API adds what the page cannot say */
    const site = siteFor(sites, url);
    let extra = null;
    if (site) {
      try { extra = await site.look(url, session); if (extra) first.steps.push(`Сайт знаком: ${site.name}`); }
      catch (e) { first.steps.push(`${site.name}: ${e.message}`); }
    }

    const seriesUrl = (first.kind === 'episode' && first.seriesUrl.value) || (extra && extra.seriesUrl) || first.url;
    /* no title yet: the adapter, then the series page, then the episode page fill it in that order */
    const series = createSeries({ sourceUrl: seriesUrl });

    if (first.kind === 'episode' && seriesUrl !== first.url) {
      try { reports.push(await readPage(seriesUrl, first.url)); } catch (e) { first.steps.push(`Страница сериала не открылась: ${e.message}`); }
    }
    /* the adapter names things best, then the series page, then the episode page */
    if (extra) merge(series, extra);
    for (const r of [...reports].reverse()) merge(series, toContribution(r));

    const steps = [...new Set(reports.flatMap(r => r.steps))];
    let opened = [];
    const number = first.episode.value;
    if (first.kind === 'episode' && number !== null) {
      const got = await openPlayers(series, first);
      opened = got.opened; steps.push(...got.steps);
    }

    /* every stream we now hold gets an address the player can ask for */
    registerStreams(series);
    seen.set(series.id, series);

    const startAt = first.kind === 'episode' && number !== null ? number : extra && extra.start != null ? extra.start : null;
    return { series, reports, opened, steps, dubs: allDubs(series).map(d => d.name),
      start: startAt !== null ? { episode: startAt } : null };
  }

  return { look, readPage, context, series, openEpisode, resolve, session, extractors, sites, profiles };
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
