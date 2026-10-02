/* ═══════════════════════════════════════════════════════════
   The journal: lapka.log beside the settings file.

   The launchers and the restart after an update already write there.
   The page adds to it on one occasion only: a wait that does not end
   (a source that gives nothing for half a minute). Then it sends what
   it saw happen, event by event, and the lines go here with the time,
   so a hang can be read afterwards instead of recalled. Nothing is
   ever sent anywhere: the file is the user's, on their disk.

   What is written is kept clean of addresses: a line that carries one
   has it cut out. The file is capped: past a megabyte the older half
   goes, at the start of an entry, and the newer half stays.
   ═══════════════════════════════════════════════════════════ */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE } from './config.mjs';

export const JOURNAL_FILE = path.join(path.dirname(CONFIG_FILE), 'lapka.log');
export const JOURNAL_CAP = 1024 * 1024;
const MAX_LINES = 120, MAX_LINE = 400;

/* the lines as they are kept: strings only, cut to a length, every address replaced by its mark */
export function cleanLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.slice(-MAX_LINES).map(l => String(l ?? '').replace(/\s+/g, ' ').replace(/https?:\/\/\S+|\/api\/\S+/gi, '[url]').trim().slice(0, MAX_LINE)).filter(Boolean);
}

export async function appendJournal(head, lines, { file = JOURNAL_FILE, cap = JOURNAL_CAP, now = new Date() } = {}) {
  const clean = cleanLines(lines);
  const stamp = now.toISOString();
  const text = [`${stamp} ${String(head || 'note').replace(/\s+/g, ' ').slice(0, 200)}`, ...clean.map(l => `  ${l}`), ''].join('\n');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, text, 'utf8');
  /* past the cap, the older half goes */
  const size = (await fsp.stat(file)).size;
  if (size > cap) {
    const all = await fsp.readFile(file, 'utf8');
    /* at the start of an entry (a stamped line, not an indented one) past the middle */
    const m = /\n(?=\S)/g; m.lastIndex = Math.floor(all.length / 2);
    const cut = m.exec(all);
    await fsp.writeFile(file, cut ? all.slice(cut.index + 1) : '', 'utf8');
  }
  return clean.length;
}
