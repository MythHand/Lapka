/* ═══════════════════════════════════════════════════════════
   State: what the user did, remembered.

   Where each episode was left, which dub the user chose for a series,
   the settings. One JSON file, written whole and atomically, a little
   after the last change rather than on every tick of the clock.
   Keys are catalog identities, never paths.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';

export const STATE_V = 1;
const POS_KEEP = 500;

export async function openState(own) {
  const file = path.join(own, 'state.json');
  let data = { v: STATE_V, positions: {}, dubs: {}, settings: {}, saves: {} };
  try {
    const got = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (got && got.v === STATE_V) data = { ...data, ...got };
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
    setPosition(seriesId, episode, dub, seconds) {
      const k = posKey(seriesId, episode, dub);
      if (seconds === null) delete data.positions[k];
      else data.positions[k] = { t: Math.max(0, Number(seconds) || 0), at: Date.now() };
      /* the oldest are let go, so the file does not grow with every episode ever watched */
      const keys = Object.keys(data.positions);
      if (keys.length > POS_KEEP) for (const k of keys.sort((a, b) => data.positions[a].at - data.positions[b].at).slice(0, keys.length - POS_KEEP)) delete data.positions[k];
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
    flush,
    close: async () => { if (timer) await flush(); else if (writing) await writing; },
  };
}
