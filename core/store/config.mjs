/* ═══════════════════════════════════════════════════════════
   Where the Lapka folder is: the one setting that cannot live inside
   the folder itself.

   During development it is kept in .dev/config.json inside the
   project, so nothing lands elsewhere on the machine. LAPKA_HOME
   still overrides everything. Later this moves to the system's
   place for such things, with the user's say.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.dev');
export const CONFIG_FILE = process.env.LAPKA_CONFIG || path.join(DEV, 'config.json');

export async function readConfig() {
  try { return JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8')) || {}; } catch { return {}; }
}

export async function writeConfig(patch) {
  const cur = await readConfig();
  const next = { ...cur, ...patch };
  await fsp.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fsp.writeFile(CONFIG_FILE + '.part', JSON.stringify(next, null, 1));
  await fsp.rename(CONFIG_FILE + '.part', CONFIG_FILE);
  return next;
}

/* Is this a folder Lapka can use: existing or creatable, writable. */
/* The folder the user points at is theirs; Lapka keeps to a folder of
   its own inside it, named Lapka, unless the one pointed at is named so
   already. The name is the sign: a Lapka folder is called Lapka.
   Nothing is ever renamed. */
export async function homeInside(dir) {
  const abs = path.resolve(String(dir || ''));
  return path.basename(abs).toLowerCase() === 'lapka' ? abs : path.join(abs, 'Lapka');
}

export async function checkHome(dir) {
  const abs = path.resolve(String(dir || ''));
  if (!abs || abs === path.parse(abs).root) return { ok: false, path: abs, why: 'root' };
  let existed = true;
  try { await fsp.access(abs); } catch { existed = false; }
  try {
    await fsp.mkdir(abs, { recursive: true });
    const probe = path.join(abs, '.lapka-write-test');
    await fsp.writeFile(probe, ''); await fsp.rm(probe);
  } catch (e) { return { ok: false, path: abs, why: e.code || e.message, existed }; }
  return { ok: true, path: abs, existed };
}
