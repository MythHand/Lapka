/* Lapka, started by hand or by `npm start`. */
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
import { readConfig, writeConfig, checkHome } from './store/config.mjs';

export const PORT = Number(process.env.PORT) || 8800;
export const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

/* everything that lives in the Lapka folder, opened */
async function openHome(home, delivery) {
  const store = await openStore({ home });
  const state = await openState(store.own);
  const library = openLibrary(store.home);
  const saver = createSaver({ delivery, cache: store.cache, library });
  return { home: store.home, store, state, library, saver };
}

export async function start({ port = PORT, home, webDir = WEB_DIR } = {}) {
  /* a folder given here (by a test, by a script) is this run's alone
     and is never written into the config; the config is for the
     folder the user chose in the settings */
  const explicit = !!home;
  home = home || (await readConfig()).home || undefined;
  const session = createSession();
  const ctx = { session };
  const delivery = createDelivery({ session, cache: () => ctx.store.cache });
  Object.assign(ctx, await openHome(home, delivery));
  ctx.delivery = delivery;
  ctx.lapka = await bootLapka({ session, delivery });
  /* the folder can change while running: the user picks another one */
  ctx.switchHome = async dir => {
    const check = await checkHome(dir);
    if (!check.ok) throw Object.assign(new Error(check.why), { code: 400 });
    const old = ctx.state;
    Object.assign(ctx, await openHome(check.path, delivery));
    await old.close().catch(() => {});
    if (!explicit && !process.env.LAPKA_HOME) await writeConfig({ home: check.path });
    return check;
  };
  const server = await startServer({ port, webDir, ctx });
  const close = async () => { await server.close(); await ctx.state.close(); };
  return { ctx, get lapka() { return ctx.lapka; }, get store() { return ctx.store; }, get state() { return ctx.state; }, get library() { return ctx.library; }, get delivery() { return ctx.delivery; }, get saver() { return ctx.saver; }, ...server, close };
}

if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = await start();
  console.log(`Lapka: ${s.base}\nПапка: ${s.ctx.home}`);
}
