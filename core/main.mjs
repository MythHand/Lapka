#!/usr/bin/env node
/* Lapka, started by hand, by `npm start`, by a launcher, or as a command
   through npx. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootLapka } from './lapka.mjs';
import { startServer } from './http/server.mjs';
import { openStore } from './store/index.mjs';
import { openState } from './store/state.mjs';
import { openLibrary } from './store/library.mjs';
import { createDelivery } from './deliver/index.mjs';
import { createSaver } from './deliver/save.mjs';
import { createSession } from './session/index.mjs';
import fs from 'node:fs';
import { readConfig, writeConfig, checkHome, homeInside } from './store/config.mjs';
import { openUrl } from './store/folder.mjs';

export const PORT = Number(process.env.PORT) || 8800;
export const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

/* The contents of one Lapka folder carried into another: renamed
   where the disk allows, copied and removed where it does not; the
   old folder is removed once it is empty. Nested folders are refused. */
async function moveHome(from, to) {
  const a = path.resolve(from), b = path.resolve(to);
  if (b.startsWith(a + path.sep) || a.startsWith(b + path.sep)) throw Object.assign(new Error('one folder is inside the other'), { code: 400 });
  const fsp = await import('node:fs/promises');
  let moved = 0;
  for (const name of await fsp.readdir(a).catch(() => [])) {
    const src = path.join(a, name), dst = path.join(b, name);
    try { await fsp.rename(src, dst); }
    catch (e) {
      if (e.code === 'EXDEV' || e.code === 'ENOTEMPTY' || e.code === 'EEXIST') { await fsp.cp(src, dst, { recursive: true, force: false, errorOnExist: false }); await fsp.rm(src, { recursive: true, force: true }); }
      else throw e;
    }
    moved++;
  }
  if (!(await fsp.readdir(a).catch(() => ['x'])).length) await fsp.rmdir(a).catch(() => {});
  return moved;
}

/* everything that lives in the Lapka folder, opened */
async function openHome(home, delivery) {
  const store = await openStore({ home });
  const state = await openState(store.own);
  const library = openLibrary(store.home);
  const saver = createSaver({ delivery, cache: store.cache, library, state });
  return { home: store.home, store, state, library, saver };
}

export async function start({ port = PORT, home, webDir = WEB_DIR } = {}) {
  /* a folder given here (by a test, by a script) is this run's alone
     and is never written into the config; the config is for the
     folder the user chose in the settings */
  const explicit = !!home;
  home = home || (process.env.LAPKA_HOME ? undefined : (await readConfig()).home) || undefined;
  const session = createSession();
  const ctx = { session };
  const delivery = createDelivery({ session, cache: () => ctx.store.cache });
  Object.assign(ctx, await openHome(home, delivery));
  ctx.delivery = delivery;
  ctx.lapka = await bootLapka({ session, delivery });
  /* the folder can change while running: the user picks another one */
  ctx.switchHome = async (dir, { move = false } = {}) => {
    const check = await checkHome(await homeInside(dir));
    if (!check.ok) throw Object.assign(new Error(check.why), { code: 400 });
    const old = ctx.state;
    const from = ctx.home;
    await old.close().catch(() => {});
    /* the files go along: every series folder and Lapka's own things, then the emptied old folder goes */
    if (move && from && path.resolve(from) !== path.resolve(check.path)) check.moved = await moveHome(from, check.path);
    Object.assign(ctx, await openHome(check.path, delivery));
    if (!explicit && !process.env.LAPKA_HOME) await writeConfig({ home: check.path });
    return check;
  };
  const server = await startServer({ port, webDir, ctx });
  ctx.port = server.port || port;   // the one really listened on, for starting again after an update
  /* saves cut short last time are taken up again, a moment after start, unless switched off */
  ctx.resumeSaves = () => (ctx.state.setting('autoResume') === 'off' ? Promise.resolve([]) : ctx.saver.resume(ctx.lapka));
  /* A save cut short is taken up again while Lapka runs: a moment
     after start, and then whenever a save has failed, with a pause
     that grows while the failures go on (a network that is down stays
     down for a while) and resets once one succeeds. */
  if (!process.env.NODE_TEST_CONTEXT) {
    let wait = 30 * 1000;
    const tick = async () => {
      const pending = Object.values(ctx.state.saves());
      const active = [...ctx.saver.jobs.values()].some(j => j.state === 'working' || j.state === 'queued');
      if (pending.length && !active) {
        const out = await ctx.resumeSaves().catch(() => []);
        wait = out.some(r => r.state === 'done') ? 30 * 1000 : Math.min(wait * 2, 10 * 60 * 1000);
      } else wait = 30 * 1000;
      setTimeout(tick, wait).unref();
    };
    setTimeout(tick, 4000).unref();
  }
  const close = async () => { await server.close(); await ctx.state.close(); };
  /* asked from the page: the state is written down, then the process ends; the answer goes out first */
  ctx.quit = () => { setTimeout(async () => { try { await ctx.state.close(); } catch (_) {} process.exit(0); }, 150); };
  return { ctx, get lapka() { return ctx.lapka; }, get store() { return ctx.store; }, get state() { return ctx.state; }, get library() { return ctx.library; }, get delivery() { return ctx.delivery; }, get saver() { return ctx.saver; }, ...server, close };
}

/* Run as a program (node core/main.mjs, npm start, a launcher, npx): the
   server is started and said; when the terminal is a person's own and
   nothing asked otherwise, the browser is opened on it, as the launchers
   do. LAPKA_NO_OPEN keeps the browser shut (the launchers open it
   themselves; tests never get here). A bin symlink resolves to this file. */
const asProgram = !process.env.NODE_TEST_CONTEXT && process.argv[1] && (() => { try { return fileURLToPath(import.meta.url) === fs.realpathSync(path.resolve(process.argv[1])); } catch { return false; } })();
if (asProgram) {
  const s = await start();
  console.log(`Lapka: ${s.base}\nFolder: ${s.ctx.home}`);
  if (!process.env.LAPKA_NO_OPEN && process.stdout.isTTY) openUrl(s.base).catch(() => {});
}
