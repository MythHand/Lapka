/* ═══════════════════════════════════════════════════════════
   The folder, the way the system handles folders.

   Lapka is a local program, so choosing a folder is the system's own
   dialog, and looking into one is the system's own file manager: a
   web page cannot do either, the server can. macOS and Windows have
   the dialog built in; Linux has it when zenity is installed.
   ═══════════════════════════════════════════════════════════ */
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd, args, timeout = 5 * 60 * 1000) => new Promise((ok, bad) =>
  execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (e, out, err) => e ? bad(Object.assign(e, { stderr: String(err || '') })) : ok(String(out))));

const has = cmd => ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'].some(d => { try { return fs.statSync(`${d}/${cmd}`).isFile(); } catch { return false; } });

export function canPick() {
  return process.platform === 'darwin' || process.platform === 'win32' || (process.platform === 'linux' && has('zenity'));
}
export function canOpen() {
  return process.platform === 'darwin' || process.platform === 'win32' || (process.platform === 'linux' && has('xdg-open'));
}

/* the system's folder dialog; null when the user cancelled */
export async function pickFolder({ prompt = 'Lapka', start = null } = {}) {
  if (process.platform === 'darwin') {
    const at = start && fs.existsSync(start) ? ` default location POSIX file ${JSON.stringify(start)}` : '';
    try {
      const out = await run('osascript', ['-e', `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)}${at})`]);
      return out.trim().replace(/\/+$/, '') || null;
    } catch (e) {
      if (/User canceled|-128/.test(e.stderr || e.message)) return null;
      throw new Error(e.stderr?.trim() || e.message);
    }
  }
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = ${JSON.stringify(prompt)}; ${start ? `$d.SelectedPath = ${JSON.stringify(start)};` : ''} if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }`;
    const out = await run('powershell', ['-NoProfile', '-STA', '-Command', ps]);
    return out.trim() || null;
  }
  if (process.platform === 'linux' && has('zenity')) {
    try { return (await run('zenity', ['--file-selection', '--directory', `--title=${prompt}`, ...(start ? [`--filename=${start}/`] : [])])).trim() || null; }
    catch (e) { if (e.code === 1) return null; throw e; }
  }
  throw new Error('no folder dialog on this system');
}

/* the folder, shown in the file manager */
/* an address opened in the person's browser, the way the launchers do it */
export async function openUrl(url) {
  if (process.platform === 'darwin') return run('open', [url], 10000);
  if (process.platform === 'win32') return run('cmd', ['/c', 'start', '', url], 10000).catch(() => {});
  if (process.platform === 'linux' && has('xdg-open')) return run('xdg-open', [url], 10000);
  throw new Error('no browser opener on this system');
}

export async function openFolder(dir) {
  if (process.platform === 'darwin') return run('open', [dir], 10000);
  if (process.platform === 'win32') return run('explorer', [dir], 10000).catch(() => {});   // explorer exits 1 even when it opened
  if (process.platform === 'linux' && has('xdg-open')) return run('xdg-open', [dir], 10000);
  throw new Error('no file manager on this system');
}
