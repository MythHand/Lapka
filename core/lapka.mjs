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
import { createSeries, merge, allDubs, findEpisode, markHealth } from './catalog/index.mjs';

export async function bootLapka(opts = {}) {
  return createLapka({ extractors: await loadExtractors(), ...opts });
}

export function createLapka({ session = createSession(), profiles = [], extractors = [], delivery = null } = {}) {
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

  const profileFor = url => {
    let host; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
    return profiles.find(p => p.match === host || (p.match instanceof RegExp && p.match.test(url))) || null;
  };

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

  /* One address in, a catalog and the reports behind it out. */
  async function look(url) {
    const reports = [];
    const first = await readPage(url);
    reports.push(first);

    const seriesUrl = first.kind === 'episode' && first.seriesUrl.value ? first.seriesUrl.value : first.url;
    const series = createSeries({ sourceUrl: seriesUrl, title: first.title.value });

    if (first.kind === 'episode' && first.seriesUrl.value) {
      try { reports.push(await readPage(first.seriesUrl.value, first.url)); } catch (e) { first.steps.push(`Страница сериала не открылась: ${e.message}`); }
    }
    /* the series page names the series best; the episode page adds its dubs */
    for (const r of [...reports].reverse()) merge(series, toContribution(r));

    const steps = [...new Set(reports.flatMap(r => r.steps))];
    const opened = [];
    const number = first.episode.value;
    if (first.kind === 'episode' && number !== null) {
      const embeds = first.players.filter(p => !p.stream);
      const results = await Promise.all(embeds.map(p => openPlayer(p, number, first.url)));
      for (const r of results) {
        opened.push({ player: r.player.id, url: r.player.url, extractor: r.extractor || null, error: r.error || null,
          streams: r.contribution ? r.contribution.episodes[0].dubs.reduce((n, d) => n + d.sources[0].streams.length, 0) : 0 });
        if (r.contribution) merge(series, r.contribution);
      }
      /* health: a player that answered with streams is alive, one that did not is not */
      const ep = findEpisode(series, number);
      if (ep) for (const d of ep.dubs) for (const s of d.sources) {
        const r = results.find(x => x.player.url === s.embedUrl);
        if (r) markHealth(s, !r.error, r.error);
      }
      if (embeds.length) {
        const ok = results.filter(r => r.contribution).length;
        steps.push(ok === embeds.length ? `Открыла ${embeds.length} ${plural(embeds.length, 'плеер', 'плеера', 'плееров')}, потоки есть`
          : `Открыла ${ok} из ${embeds.length} ${plural(embeds.length, 'плеера', 'плееров', 'плееров')}`);
        for (const r of results) if (r.error) steps.push(`${r.player.id}: ${r.error}`);
      }
    }

    /* every stream we now hold gets an address the player can ask for */
    if (delivery) for (const e of series.episodes) for (const d of e.dubs) for (const s of d.sources) for (const st of s.streams) {
      st.id = delivery.register(st, { sourceId: s.id, seriesId: series.id, episode: e.number, dub: d.key });
      st.play = `/api/stream/${st.id}.${st.kind === 'mp4' ? 'mp4' : 'm3u8'}`;
    }
    seen.set(series.id, series);

    return { series, reports, opened, steps, dubs: allDubs(series).map(d => d.name) };
  }

  return { look, readPage, context, session, extractors };
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
