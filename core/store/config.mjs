/* ═══════════════════════════════════════════════════════════
   Where the Lapka folder is: the one setting that cannot live inside
   the folder itself.

   It lives where the system keeps a program's settings, so it is the
   same whatever way Lapka was started: from a clone, from a ZIP, or
   through npx from a cache that comes and goes.
     macOS    ~/Library/Application Support/Lapka/config.json
     Windows  %APPDATA%\Lapka\config.json
     Linux    $XDG_CONFIG_HOME/lapka/config.json, ~/.config/lapka/…
   Until 1.1.0 it was .dev/config.json inside the project: found there
   and not yet in the system's place, it is carried over once.
   LAPKA_CONFIG names the file outright (tests, a second Lapka);
   LAPKA_HOME overrides the folder itself.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DEV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.dev');
const OLD_CONFIG_FILE = path.join(DEV, 'config.json');
export function systemConfigDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Lapka');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Lapka');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'lapka');
}
export const CONFIG_FILE = process.env.LAPKA_CONFIG || path.join(systemConfigDir(), 'config.json');

export async function readConfig() {
  try { return JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8')) || {}; } catch { /* not there */ }
  /* the old place, once: what was there goes to the system's place and stays there */
  if (!process.env.LAPKA_CONFIG && OLD_CONFIG_FILE !== CONFIG_FILE) {
    try {
      const old = JSON.parse(await fsp.readFile(OLD_CONFIG_FILE, 'utf8')) || {};
      if (old && typeof old === 'object' && Object.keys(old).length) { await writeConfig(old); return old; }
    } catch { /* nothing old either */ }
  }
  return {};
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
