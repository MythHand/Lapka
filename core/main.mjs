/* Lapka, started by hand or by `npm start`. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLapka } from './lapka.mjs';
import { startServer } from './http/server.mjs';

export const PORT = Number(process.env.PORT) || 8800;
export const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

export async function start({ port = PORT } = {}) {
  const lapka = createLapka();
  const server = await startServer({ port, webDir: WEB_DIR, lapka });
  return { lapka, ...server };
}

if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = await start();
  console.log(`Lapka: ${s.base}`);
}
