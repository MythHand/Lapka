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
import { playerId } from './discover/players.mjs';
import { loadExtractors, extractorFor, closedDoor } from './extract/index.mjs';
import { loadSites, siteFor } from './sites/index.mjs';
import { loadProfiles, profileFor as profileOf } from './knowledge/index.mjs';
import { createSeries, merge, allDubs, findEpisode, markHealth, pickDub, pickSource, bestStream, RETRY_MS, dubKey } from './catalog/index.mjs';

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

  /* A site the adapter knows may fetch its pages its own way: an
     episode that lives in a fragment answered only to a script's
     request, wrapped in JSON. The reading of what comes back stays
     general. */
  /* "?season=N" on a page's address is Lapka's own word for one season of
     a page that holds them all in one player: the site is not asked with
     it (a site answers such an address with a redirect to the bare one),
     and the reading keeps it on the address it was given. */
  const seasonOff = url => { try { const u = new URL(url); const s = u.searchParams.get('season'); if (!s) return { ask: url, season: null }; u.searchParams.delete('season'); return { ask: u.toString(), season: s }; } catch { return { ask: url, season: null }; } };
  const seasonOn = (url, season) => { if (!season) return url; try { const u = new URL(url); u.searchParams.set('season', season); return u.toString(); } catch { return url; } };
  async function readPage(url, referer = null) {
    const { ask, season } = seasonOff(url);
    const site = siteFor(sites, ask);
    const res = site && site.fetch ? await site.fetch(ask, { referer }, session) : await session.fetch(ask, { referer });
    if (res.status >= 400) throw new Error(`${ask} answered ${res.status}`);
    return discover({ html: res.body, url: seasonOn(res.url || ask, season), profile: profileFor(ask) });
  }

  /* One embedded player opened: what it plays, as a contribution for
     this episode. A player the page named a dub for gets its streams
     under that dub; a player that carries its own dub switch brings
     its dubs along; a player that gives nothing is reported as such. */
  /* A deferred player: the site's engine is asked where the player is.
     It answers with JSON that names the address, or with the iframe
     itself, or with the bare address. */
  async function followDeferred(url, pageUrl) {
    const res = await session.fetch(url, { referer: pageUrl, headers: { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json, text/javascript, */*; q=0.01' } });
    if (res.status >= 400) throw new Error(`the site answered ${res.status} for the player`);
    const body = String(res.body || '').trim();
    let found = null;
    try { const j = JSON.parse(body); found = typeof j === 'string' ? j : j.data || j.url || j.src || j.iframe || null; } catch { /* not JSON */ }
    if (!found) found = /<iframe[^>]+src=["']([^"']+)["']/i.exec(body)?.[1] || (/^(https?:)?\/\/\S+$/.test(body) ? body : null);
    if (!found || typeof found !== 'string') throw new Error('the site did not say where the player is');
    return new URL(found.replace(/&amp;/g, '&'), pageUrl).toString();
  }

  async function openPlayer(player, number, pageUrl) {
    if (player.kind === 'deferred') {
      try { const url = await followDeferred(player.url, pageUrl); player = { ...player, url, id: playerId(url, pageUrl), kind: 'iframe', followed: true }; }
      catch (e) { return { player, error: e.message }; }
    }
    const shut = closedDoor(player.url);
    if (shut) return { player, error: shut };
    const x = extractorFor(extractors, player.url);
    if (!x) return { player, error: 'no extractor' };
    try {
      /* a player that holds the whole series: every episode and dub it
         lists comes in, the streams wait until an episode is played */
      if (x.unfold) {
        const got = await x.unfold(player.url, { referer: pageUrl }, session);
        if (got && got.episodes?.length) {
          const episodes = got.episodes.map(e => ({ ...e, sourceUrl: e.sourceUrl || pageUrl,
            dubs: (e.dubs || []).map(d => ({ ...d, sources: d.sources.map(src => ({ player: player.id, extractor: x.name, ...src })) })) }));
          const dubs = new Set(episodes.flatMap(e => e.dubs.map(d => d.name)));
          const contribution = { origin: `extract:${x.name}`, episodes };
          /* every season in one player: this page is the season shown, the
             others are the same address with ?season=N, parts of the franchise */
          if (got.seasons && got.seasons.length > 1 && got.season) {
            const at = n => { const u = new URL(pageUrl); u.searchParams.set('season', String(n)); return u.toString(); };
            contribution.series = { season: got.season, franchise: got.seasons.map(n => ({ order: n, title: '', url: at(n), kind: 'tv', self: n === got.season })) };
          }
          return { player, extractor: x.name, unfolded: { episodes: episodes.length, dubs: dubs.size, seasons: got.seasons ? got.seasons.length : 0 }, contribution };
        }
      }
      /* the site's own player on a page that names no episode and lists
         none holds the whole thing: a film, its one episode. A decorative
         iframe on such a page is left alone. */
      if (number === null) { if (!player.followed) return { player, extractor: x.name, error: 'the page names no episode' }; number = 1; }
      const got = await x.extract(player.url, { referer: pageUrl }, session);
      const source = streams => ({ player: player.id, embedUrl: player.url, extractor: x.name, streams, subs: got.subs || [] });
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
    for (const e of series.episodes) for (const d of e.dubs) for (const s of d.sources) {
      for (const st of s.streams) {
        if (st.id) continue;
        st.id = delivery.register(st, { sourceId: s.id, seriesId: series.id, episode: e.number, dub: d.key });
        st.play = `/api/stream/${st.id}.${st.kind === 'mp4' ? 'mp4' : 'm3u8'}`;
      }
      /* a subtitle track gets an address of ours the same way: the browser takes a text track from its own origin only */
      for (const sb of s.subs || []) {
        if (sb.id) continue;
        sb.id = delivery.register({ kind: 'sub', url: sb.url, headers: sb.headers, format: sb.format }, { sourceId: s.id, seriesId: series.id, episode: e.number, dub: d.key });
        sb.play = `/api/stream/${sb.id}.vtt`;
      }
    }
  }

  /* The players of one episode page, opened, into the series. */
  async function openPlayers(series, report, { onStep = () => {} } = {}) {
    const number = report.episode.value;
    const embeds = report.players.filter(p => !p.stream);
    if (embeds.length) { onStep({ phase: 'players', n: embeds.length }); onStep({ key: 'players', n: embeds.length }); }
    /* each player is said as it answers, not when the last one has */
    const said = r => r.error ? { key: 'playerFail', player: r.player.id, why: r.error }
      : r.unfolded ? { key: 'playerUnfolded', player: r.player.id, episodes: r.unfolded.episodes, dubs: r.unfolded.dubs }
      : { key: 'playerOk', player: r.player.id };
    /* Embeds a player can unfold hold the whole series each: one such
       embed per player is opened first, and the rest of that player's are
       opened only when it did not unfold (a page lists one Kodik season
       embed per dub, sixteen of them, and any one of them names them all). */
    const open = p => openPlayer(p, number, report.url).then(r => { onStep(said(r)); return r; });
    const unfolding = p => !!extractorFor(extractors, p.url)?.unfold;
    const firstOf = new Map();
    const heads = [], tails = [];
    for (const p of embeds) {
      const x = unfolding(p) ? extractorFor(extractors, p.url).name : null;
      if (x && firstOf.has(x)) tails.push(p); else { if (x) firstOf.set(x, p); heads.push(p); }
    }
    const results = await Promise.all(heads.map(open));
    const rest = tails.filter(p => { const x = extractorFor(extractors, p.url).name; const first = results.find(r => r.player === firstOf.get(x)); return !(first && first.unfolded); });
    if (rest.length) results.push(...await Promise.all(rest.map(open)));
    for (const p of tails) if (!results.some(r => r.player === p)) results.push({ player: p, extractor: extractorFor(extractors, p.url).name, error: null, same: true });
    const opened = [];
    for (const r of results) {
      opened.push({ player: r.player.id, url: r.player.url, extractor: r.extractor || null, error: r.error || null, unfolded: r.unfolded || null,
        streams: r.contribution && !r.unfolded ? r.contribution.episodes[0].dubs.reduce((n, d) => n + (d.sources[0].streams || []).length, 0) : 0 });
      if (r.contribution) merge(series, r.contribution);
    }
    const ep = findEpisode(series, number);
    if (ep) for (const d of ep.dubs) for (const s of d.sources) {
      const r = results.find(x => x.player.url === s.embedUrl);
      if (r) markHealth(s, !r.error, r.error);
    }
    const steps = [];
    if (embeds.length) {
      const same = results.filter(r => r.same).length, asked = embeds.length - same;
      const ok = results.filter(r => r.contribution).length;
      steps.push({ key: 'opened', ok, asked, same });
      for (const r of results) if (r.error) steps.push(said(r));
      for (const r of results) if (r.unfolded) steps.push(said(r));
    }
    if (ep) ep.opened = true;
    registerStreams(series);
    return { opened, steps };
  }

  const series = id => seen.get(id) || null;

  /* a series built elsewhere (a snapshot from disk, a test) becomes one Lapka knows */
  function adopt(s) { registerStreams(s); seen.set(s.id, s); return s; }

  /* One episode of a known series, its page read and its players opened. */
  async function openEpisode(seriesId, number) {
    const s = seen.get(seriesId);
    if (!s) throw Object.assign(new Error('unknown series; look at its page first'), { code: 404 });
    const ep = findEpisode(s, number);
    if (!ep) throw Object.assign(new Error('unknown episode'), { code: 404 });
    if (ep.opened) return ep;
    /* an episode without a page of its own has nothing to read */
    if (!ep.sourceUrl || ep.sourceUrl === s.sourceUrl) { ep.opened = true; return ep; }
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
  /* A source's streams, asked for again: the links of some players
     are signed for hours, and a failed stream may only be a stale
     one. Only sources an extractor filled can be refreshed. */
  async function refreshSource(source, ep, s) {
    /* a source that is the episode's own page, or an adapter's word, is
       refreshed by reading that page again: the generic extractor on a
       page that carries every episode's streams would bring them all */
    if (source.player === 'page' || String(source.extractor || '').startsWith('site:')) {
      if (!ep.sourceUrl || ep.sourceUrl === s.sourceUrl) { markHealth(source, false, 'nothing to re-read'); return false; }
      try {
        const before = source.streams.map(st => st.url).join('\n');
        const report = await readPage(ep.sourceUrl, s.sourceUrl);
        if (report.episode.value === null) report.episode.value = ep.number;
        merge(s, toContribution(report));
        const fresh = source.streams.length && source.streams.map(st => st.url).join('\n') !== before;
        markHealth(source, !!source.streams.length, source.streams.length ? null : 'no streams');
        registerStreams(s);
        return fresh;
      } catch (e) { markHealth(source, false, e.message); return false; }
    }
    const x = (source.extractor && extractors.find(e => e.name === source.extractor)) || extractorFor(extractors, source.embedUrl);
    if (!x) { markHealth(source, false, 'no extractor'); return false; }
    try {
      const got = await x.extract(source.embedUrl, { referer: ep.sourceUrl || s.sourceUrl }, session);
      /* a source of one dub takes that dub's streams; a source that is one dub among the embed's takes its own */
      const mine = ep.dubs.find(x => x.sources.includes(source));
      const own = got.dubs?.length && mine ? (got.dubs.find(d => dubKey(d.name) === mine.key) || null) : null;
      const streams = got.dubs?.length ? (own ? own.streams : got.dubs.flatMap(d => d.streams)) : (got.streams || []);
      if (!streams.length) { markHealth(source, false, 'no streams'); return false; }
      source.extractor = source.extractor || x.name;
      source.streams = streams.map(st => ({ ...st, headers: { ...(st.headers || {}) } }));
      source.subs = (got.subs || []).map(sb => ({ ...sb, headers: { ...(sb.headers || {}) } }));
      markHealth(source, true);
      registerStreams(s);
      return true;
    } catch (e) { markHealth(source, false, e.message); return false; }
  }

  const stale = source => source.streams.length && source.streams.every(st => st.expiresAt && st.expiresAt < Date.now());

  async function resolve({ seriesId, number, dubKey = null, avoid = null }) {
    const s = seen.get(seriesId);
    if (!s) throw Object.assign(new Error('unknown series; look at its page first'), { code: 404 });
    const ep = await openEpisode(seriesId, number);
    /* a stream that failed: its source gets one more try with fresh links, then counts as dead */
    if (avoid) for (const d of ep.dubs) for (const src of d.sources) if (src.streams.some(st => st.id === avoid)) {
      /* one fresh try after a failure; a second failure soon after means the source, not the links */
      const again = src.health.retriedAt && Date.now() - src.health.retriedAt < RETRY_MS;
      if (again || !(await refreshSource(src, ep, s))) markHealth(src, false, 'playback failed');
      else if (src.streams.some(st => st.id === avoid)) markHealth(src, false, 'playback failed');
      else src.health.retriedAt = Date.now();
    }
    const dub = pickDub(ep, dubKey ? { name: dubKey } : null);
    let source = dub ? pickSource(dub) : null;
    /* no streams yet, or all of them past their time: ask the player
       now; a player that gives nothing is passed over for the next */
    for (let tries = dub ? dub.sources.length : 0; source && tries > 0 && (!source.streams.length || stale(source)); tries--) {
      if (await refreshSource(source, ep, s)) break;
      const next = pickSource(dub);
      source = next === source ? null : next;
    }
    const stream = source ? bestStream(source) : null;
    return {
      series: { id: s.id, title: s.title },
      episode: { number: ep.number, title: ep.title, sourceUrl: ep.sourceUrl, duration: ep.duration, marks: ep.marks },
      /* alive: not known to be dead; a source not yet asked counts, one that refused does not */
      dubs: ep.dubs.map(d => ({ key: d.key, name: d.name, alive: d.sources.filter(x => x.health.ok !== false).length, sources: d.sources.length })),
      dub: dub ? { key: dub.key, name: dub.name } : null,
      source: source ? { id: source.id, player: source.player, extractor: source.extractor } : null,
      /* the sources that refused, each with its reason: a door that is closed is said so, not left to a spinner */
      dead: dub ? dub.sources.filter(x => x.health.ok === false).map(x => ({ player: x.player, error: x.health.error || '' })) : [],
      stream: stream ? { id: stream.id, kind: stream.kind, quality: stream.quality, play: stream.play, audio: stream.audio || null } : null,
      /* every stream of every live source of the dub: the player offers the qualities across them and may switch the source by picking one */
      streams: dub ? dub.sources.filter(x => x.health.ok !== false).flatMap(x => x.streams.filter(st => st.id).map(st => ({ id: st.id, kind: st.kind, quality: st.quality, play: st.play, player: x.player, sourceId: x.id, audio: st.audio || null }))) : [],
      /* the subtitle tracks the dub's live sources offer, one per language and label */
      subs: dub ? [...new Map(dub.sources.filter(x => x.health.ok !== false).flatMap(x => (x.subs || []).filter(sb => sb.id).map(sb => [`${sb.lang || ''}|${sb.label}`, { id: sb.id, lang: sb.lang, label: sb.label, format: sb.format, default: sb.default, play: sb.play, player: x.player }]))).values()] : [],
    };
  }

  /* Every source of every dub of an episode, opened, a few at a time:
     the audio menu wants to show what each dub can play in. */
  async function openAllSources(seriesId, number, { limit = 4 } = {}) {
    const s = seen.get(seriesId);
    if (!s) throw Object.assign(new Error('unknown series; look at its page first'), { code: 404 });
    const ep = await openEpisode(seriesId, number);
    const todo = ep.dubs.flatMap(d => d.sources).filter(src => !src.streams.length && src.health.ok !== false && !src.opening);
    let i = 0;
    const worker = async () => { while (i < todo.length) { const src = todo[i++]; src.opening = true; try { await refreshSource(src, ep, s); } finally { src.opening = false; } } };
    await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, worker));
    return ep;
  }

  /* what each dub of an episode offers: its live sources and their qualities */
  /* An adaptive HLS names its qualities inside its master playlist
     (RESOLUTION on every variant). Read once per stream, through the
     delivery, so the audio menu can offer them the way it offers a
     player's separate qualities. */
  async function readLevels(st) {
    if (st.kind !== 'hls' || st.quality || st.levels || !st.id || !delivery) return st.levels || null;
    const entry = delivery.get(st.id);
    if (!entry) return null;
    try { st.levels = levelsOfMaster(await delivery.playlist(entry)); }
    catch { st.levels = []; }
    return st.levels;
  }
  async function levelsOf(ep, { limit = 4 } = {}) {
    const todo = ep.dubs.flatMap(d => d.sources.filter(x => x.health.ok !== false)).flatMap(x => x.streams).filter(st => st.kind === 'hls' && !st.quality && !st.levels && st.id);
    let i = 0;
    const worker = async () => { while (i < todo.length) await readLevels(todo[i++]); };
    await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, worker));
    return ep;
  }

  function dubsOf(ep) {
    /* a stream of one quality is that quality; an adaptive one is every variant its master names, else "auto" */
    const entries = (x, st) => {
      const one = q => [q || 'auto', { quality: q, kind: st.kind, player: x.player, id: st.id, play: st.play, level: !!(q && !st.quality) }];
      if (st.quality) return [one(st.quality)];
      if (st.levels && st.levels.length > 1) return st.levels.map(one);
      return [one(null)];
    };
    return ep.dubs.map(d => ({
      key: d.key, name: d.name, kind: d.kind,
      alive: d.sources.filter(x => x.health.ok !== false).length, sources: d.sources.length,
      unopened: d.sources.filter(x => !x.streams.length && x.health.ok !== false).length,
      qualities: [...new Map(d.sources.filter(x => x.health.ok !== false).flatMap(x => x.streams.filter(st => st.id).flatMap(st => entries(x, st))).sort((a, b) => rankQ(b[1]) - rankQ(a[1]))).values()],
    }));
  }
  const rankQ = st => { const m = /(\d{3,4})/.exec(String(st.quality || '')); return m ? Number(m[1]) : st.kind === 'hls' ? 9999 : 0; };
  /* "1280x720" on a variant line is 720p; the list, tallest first, one of each */
  function levelsOfMaster(text) {
    const heights = new Set();
    for (const m of String(text || '').matchAll(/^#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)/gm)) heights.add(Number(m[2]));
    return [...heights].sort((a, b) => b - a).map(h => `${h}p`);
  }

  /* One address in, a catalog and the reports behind it out. */
  async function look(url, { onStep = () => {} } = {}) {
    const reports = [];
    const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
    onStep({ phase: 'page' });
    onStep({ key: 'page', host });
    const first = await readPage(url);
    for (const s of first.steps) onStep(s);
    reports.push(first);

    /* a site Lapka knows through its API adds what the page cannot say */
    const site = siteFor(sites, url);
    let extra = null;
    if (site) {
      try { extra = await site.look(url, session); if (extra) first.steps.push({ key: 'siteKnown', site: site.name }); }
      catch (e) { first.steps.push({ key: 'siteFail', site: site.name, why: e.message }); }
    }

    /* The adapter knows the series page best. Without one, an
       episode page leads up to its series only when it is certainly
       an episode page: one that names its number. A page that only
       looks like one (a decorative iframe, no number) is left alone,
       or the way up ends on a catalog. */
    const certain = first.kind === 'episode' && first.episode.value !== null;
    const seriesUrl = (extra && extra.seriesUrl) || (certain && first.seriesUrl.value) || first.url;
    /* no title yet: the adapter, then the series page, then the episode page fill it in that order */
    const series = createSeries({ sourceUrl: seriesUrl });

    if (certain && seriesUrl !== first.url && !(extra && extra.seriesUrl)) {
      try { reports.push(await readPage(seriesUrl, first.url)); } catch (e) { first.steps.push({ key: 'seriesFail', why: e.message }); }
    }
    /* the adapter names things best, then the series page, then the episode page */
    if (extra) merge(series, extra);
    for (const r of [...reports].reverse()) merge(series, toContribution(r));
    /* the part that is this series is at the series' address, whatever page named it */
    for (const f of series.franchise) if (f.self) f.url = series.sourceUrl;

    /* a step is a key with its parts (the words are the interface's, in its language); the same step from two reports is said once */
    const steps = [...new Map(reports.flatMap(r => r.steps).map(s => [JSON.stringify(s), s])).values()];
    let opened = [];
    const number = first.episode.value;
    /* the players are opened for a page that names its episode, and
       for one whose player may hold the whole series: a deferred one,
       or one its extractor can unfold */
    const whole = first.players.some(p => p.kind === 'deferred' || extractorFor(extractors, p.url)?.unfold);
    if (first.kind === 'episode' && (number !== null || whole)) {
      const got = await openPlayers(series, first, { onStep });
      opened = got.opened; steps.push(...got.steps);
    }

    /* every stream we now hold gets an address the player can ask for */
    registerStreams(series);
    seen.set(series.id, series);

    const startAt = first.kind === 'episode' && number !== null ? number : extra && extra.start != null ? extra.start : null;
    return { series, reports, opened, steps, dubs: allDubs(series).map(d => d.name),
      start: startAt !== null ? { episode: startAt } : null };
  }

  return { look, readPage, context, series, adopt, openEpisode, openAllSources, levelsOf, dubsOf, levelsOfMaster, resolve, session, extractors, sites, profiles };
}

