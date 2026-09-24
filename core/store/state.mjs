/* ═══════════════════════════════════════════════════════════
   State: what the user did, remembered.

   Where each episode was left, which episodes were watched to the end,
   which dub the user chose for a series, the settings, and the links
   pasted, each with the title and the cover of the series it opened.
   One JSON file, written whole and atomically, a little after the last
   change rather than on every tick of the clock.
   Keys are catalog identities, never paths; the history alone is keyed
   by the link as it was pasted.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';

export const STATE_V = 1;
const POS_KEEP = 500;
const HISTORY_KEEP = 200;

export async function openState(own) {
  const file = path.join(own, 'state.json');
  let data = { v: STATE_V, positions: {}, watched: {}, dubs: {}, settings: {}, saves: {}, history: {} };
  try {
    const got = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (got && got.v === STATE_V) data = { ...data, ...got, history: got.history || {} };
  } catch { /* first start */ }

  let timer = null, writing = null;
  const flush = async () => {
    clearTimeout(timer); timer = null;
    await (writing = fsp.writeFile(file + '.part', JSON.stringify(data, null, 1)).then(() => fsp.rename(file + '.part', file)));
  };
  const soon = () => { if (!timer) timer = setTimeout(() => flush().catch(() => {}), 500); };

  const posKey = (seriesId, episode, dub) => `${seriesId}/${episode}/${dub}`;

  return {
    file,
    get: () => data,
    position(seriesId, episode, dub) { return data.positions[posKey(seriesId, episode, dub)]?.t ?? null; },
    /* the duration goes along, so a row can show where the episode was left before it is ever opened again */
    setPosition(seriesId, episode, dub, seconds, duration = 0) {
      const k = posKey(seriesId, episode, dub);
      if (seconds === null) delete data.positions[k];
      else data.positions[k] = { t: Math.max(0, Number(seconds) || 0), d: Math.max(0, Number(duration) || 0), at: Date.now() };
      /* the oldest are let go, so the file does not grow with every episode ever watched */
      const keys = Object.keys(data.positions);
      if (keys.length > POS_KEEP) for (const k of keys.sort((a, b) => data.positions[a].at - data.positions[b].at).slice(0, keys.length - POS_KEEP)) delete data.positions[k];
      soon();
    },
    /* an episode watched to its end, whatever the dub; kept for good, unlike the positions */
    watched(seriesId, episode) { return !!data.watched[`${seriesId}/${episode}`]; },
    setWatched(seriesId, episode, on = true) {
      const k = `${seriesId}/${episode}`;
      if (on) data.watched[k] = { at: Date.now() }; else delete data.watched[k];
      soon();
    },
    dub(seriesId) { return data.dubs[seriesId] || null; },
    setDub(seriesId, dubKey) { if (dubKey) data.dubs[seriesId] = dubKey; else delete data.dubs[seriesId]; soon(); },
    setting(k) { return data.settings[k]; },
    /* saves that were asked for and are not done: series/episode/dub → what is known about them */
    saves() { return { ...data.saves }; },
    setSave(key, rec) { data.saves[key] = { ...(data.saves[key] || {}), ...rec, at: Date.now() }; soon(); },
    clearSave(key) { delete data.saves[key]; soon(); },
    setSetting(k, v) { if (v === undefined) delete data.settings[k]; else data.settings[k] = v; soon(); },
    /* The links pasted, oldest first: the link as typed, the series it
       opened (its id, title, kind, year, season, episode count), the cover
       kept as a file of Lapka's own, and when. Pasted again, a link moves
       to the end with what it opened now. */
    history() { return Object.values(data.history).sort((a, b) => a.at - b.at); },
    remember(rec) {
      const url = String(rec.url || '').trim();
      if (!url) return null;
      const entry = { url, seriesId: rec.seriesId || null, title: rec.title || '', kind: rec.kind || null, year: rec.year || null, season: rec.season || null, episodes: Number(rec.episodes) || 0, cover: rec.cover || null, coverFile: rec.coverFile || null, at: Date.now() };
      data.history[url] = entry;
      const keys = Object.keys(data.history);
      if (keys.length > HISTORY_KEEP) for (const k of keys.sort((a, b) => data.history[a].at - data.history[b].at).slice(0, keys.length - HISTORY_KEEP)) delete data.history[k];
      soon();
      return entry;
    },
    /* what was noted about watching: positions, watched marks, dub choices, the links pasted. Settings and save records stay. */
    notes() { return Object.keys(data.positions).length + Object.keys(data.watched).length + Object.keys(data.dubs).length + Object.keys(data.history).length; },
    forget() { data.positions = {}; data.watched = {}; data.dubs = {}; data.history = {}; soon(); },
    flush,
    close: async () => { if (timer) await flush(); else if (writing) await writing; },
  };
}
