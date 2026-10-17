/* ═══════════════════════════════════════════════════════════
   Warming: an episode pulled into the cache ahead of the player.

   A player asks for the next half minute; on a line that lags, or an
   origin that drops out, the picture stops with it. Warmed, the whole
   episode is pulled into the cache while the first minute plays, piece
   by piece, one at a time, and the player then reads from the disk:
   what the origin does after that is not seen.

   One episode warms at a time: asked for another, the one under way is
   let go (the piece in flight finishes, the rest stay unasked). The pull
   is paced to twice the speed of watching: enough to run ahead, not a
   second full-speed client at an origin that counts them. MP4 is
   not warmed: the browser reads it by ranges and the cache does not
   hold it. Nothing is kept beyond the cache's own limit: the pieces
   are ordinary cache files, evicted as any other.
   ═══════════════════════════════════════════════════════════ */
import { reasonOf } from '../reasons.mjs';
import { segmentsOf, timedPiecesOf } from './pieces.mjs';

/* the pull is paced: never faster than this many seconds of video per second of pulling,
   so the warming is a second viewer beside the player, not a flood at the origin */
export const PACE = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createWarmer({ delivery, cache }) {
  const cacheOf = () => (typeof cache === 'function' ? cache() : cache);
  let current = null;      // the job under way or the last one: { streamId, level, state, done, total, error, hits }
  let stop = null;         // lets the job under way go

  /* the job, as the page reads it */
  const view = () => current ? { streamId: current.streamId, level: current.level, state: current.state, done: current.done, total: current.total, error: current.error || null } : null;

  function warm(streamId, { level = null } = {}) {
    level = Number(level) || null;
    const entry = delivery.get(streamId);
    if (!entry) throw Object.assign(new Error('unknown stream'), { code: 404, reason: { key: 'noStream' } });
    if (entry.stream.kind !== 'hls') return { streamId, state: 'skipped', done: 0, total: 0, error: null };
    /* the same episode, the same quality, the same address: already at it, or already done;
       a stream signed anew since is read again, its pieces found on the disk or fetched */
    if (current && current.streamId === streamId && current.level === level && current.url === entry.stream.url && (current.state === 'working' || current.state === 'done')) return view();
    if (stop) stop();
    const job = { streamId, level, url: entry.stream.url, state: 'working', done: 0, total: 0, error: null };
    let gone = false;
    stop = () => { gone = true; if (job.state === 'working') job.state = 'stopped'; };
    current = job;
    (async () => {
      const pieces = timedPiecesOf(await segmentsOf(delivery, entry, entry.stream.url, 0, level));
      job.total = pieces.length;
      const c = cacheOf();
      const began = Date.now();
      let pulled = 0;   // seconds of video fetched from the origin, the cache's own not counted
      for (const { url, seconds } of pieces) {
        if (gone) return;
        if (!(await c.has(entry.id, delivery.nameFor(entry, url)))) {
          await delivery.piece(entry, url, 'warm');
          pulled += seconds;
          const due = began + pulled / PACE * 1000;
          if (Date.now() < due) await sleep(due - Date.now());
        }
        if (gone) return;
        job.done++;
      }
      job.state = 'done';
    })().catch(e => { if (!gone) { job.state = 'error'; job.error = reasonOf(e); } });
    return view();
  }

  function stopNow() { if (stop) stop(); stop = null; return view(); }

  return { warm, stop: stopNow, job: view };
}
