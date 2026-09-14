/* ═══════════════════════════════════════════════════════════
   Lapka itself: the blocks wired into one thing.

   Given an address, it fetches the page through the session, reads
   it, and if the page turns out to be one episode, goes up to the
   series page and reads that too. What it learned lands in one
   catalog; what it saw stays in the reports.
   ═══════════════════════════════════════════════════════════ */
import { createSession } from './session/index.mjs';
import { discover, toContribution } from './discover/index.mjs';
import { createSeries, merge, allDubs } from './catalog/index.mjs';

export function createLapka({ session = createSession(), profiles = [] } = {}) {
  const profileFor = url => {
    let host; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
    return profiles.find(p => p.match === host || (p.match instanceof RegExp && p.match.test(url))) || null;
  };

  async function readPage(url, referer = null) {
    const res = await session.fetch(url, { referer });
    if (res.status >= 400) throw new Error(`${url} answered ${res.status}`);
    return discover({ html: res.body, url: res.url || url, profile: profileFor(url) });
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

    /* one status line: the episode page's steps, then what the series page added */
    const steps = [...new Set(reports.flatMap(r => r.steps))];
    return { series, reports, steps, dubs: allDubs(series).map(d => d.name) };
  }

  return { look, readPage, session };
}
