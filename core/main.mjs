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

export const PORT = Number(process.env.PORT) || 8800;
export const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

export async function start({ port = PORT, home } = {}) {
  const store = await openStore({ home });
  const state = await openState(store.own);
  const library = openLibrary(store.home);
  const session = createSession();
  const delivery = createDelivery({ session, cache: store.cache });
  const saver = createSaver({ delivery, cache: store.cache, library });
  const lapka = await bootLapka({ session, delivery });
  const server = await startServer({ port, webDir: WEB_DIR, lapka, delivery, store, state, library, saver });
  const close = async () => { await server.close(); await state.close(); };
  return { lapka, store, state, library, delivery, saver, ...server, close };
}

if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = await start();
  console.log(`Lapka: ${s.base}\nПапка: ${s.store.home}`);
}
