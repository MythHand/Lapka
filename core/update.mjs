/* ═══════════════════════════════════════════════════════════
   Updating Lapka from the settings.

   The version is the package's; the repository is the package's too, so
   a folder that came as a ZIP knows where its origin is as well as a
   clone does. GitHub is asked only when the button is pressed, never on
   its own: the one request Lapka makes that is not to a site with video.

   Two ways to bring the folder up to date, told apart by the folder:
     git   the folder is a clone: pull, fast-forward only;
     zip   the folder came as an archive: the release archive is
           fetched and unpacked over it, Lapka's own things aside.
   Then what Lapka needs is installed, and Lapka starts itself again:
   a small detached shell waits for this process to end and starts the
   new one the way the launcher does. Settings and the chosen folder
   are outside the program's files and stay.
   ═══════════════════════════════════════════════════════════ */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { systemConfigDir } from './store/config.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = createRequire(import.meta.url)('../package.json');
export const VERSION = pkg.version;
/* "git+https://github.com/MythHand/Lapka.git" → "MythHand/Lapka" */
export const REPO = String(pkg.repository?.url || pkg.homepage || '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/#.*$/, '').split('github.com/')[1] || 'MythHand/Lapka';

/* Lapka's own things in the folder, never overwritten by an archive */
const KEEP = new Set(['.dev', '.git', '.internal', 'node_modules', 'CLAUDE.md']);

const run = (cmd, args, { cwd = ROOT, timeout = 10 * 60 * 1000 } = {}) => new Promise((ok, bad) =>
  execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, shell: process.platform === 'win32' }, (e, out, err) =>
    e ? bad(new Error(String(err || e.message).trim().split('\n').slice(-3).join(' ').slice(0, 300))) : ok(String(out))));

/* 1.10.2 against 1.9.0: by numbers, not by letters */
export function compareVersions(a, b) {
  const p = v => String(v || '').replace(/^v/, '').split('.').map(x => Number(x) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

/* the newest version GitHub knows: the latest release, or failing one, the highest tag */
export async function checkUpdate({ fetch = globalThis.fetch, repo = REPO, current = VERSION } = {}) {
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'Lapka' };
  let tag = null, url = null;
  const rel = await fetch(`${api}/releases/latest`, { headers, signal: AbortSignal.timeout(15000) });
  if (rel.ok) { const j = await rel.json(); tag = j.tag_name || null; url = j.html_url || null; }
  else {
    const tags = await fetch(`${api}/tags?per_page=50`, { headers, signal: AbortSignal.timeout(15000) });
    if (!tags.ok) throw new Error(`GitHub answered ${tags.status}`);
    const names = (await tags.json()).map(t => t.name).filter(n => /^v?\d+(\.\d+)*$/.test(n)).sort((a, b) => compareVersions(b, a));
    tag = names[0] || null;
    if (tag) url = `https://github.com/${repo}/releases/tag/${tag}`;
  }
  const latest = tag ? tag.replace(/^v/, '') : null;
  return { current, latest, tag, url, newer: !!latest && compareVersions(latest, current) > 0 };
}

/* How this Lapka got here: a clone (git), an archive (zip), or the npm
   cache that npx runs from (npx). The npx cache is not a place to update:
   the next `npx` takes the newest by itself. */
export function installKind(root = ROOT) {
  if (fs.existsSync(path.join(root, '.git'))) return 'git';
  if (/[\\/]_npx[\\/]|[\\/]node_modules[\\/]/.test(root)) return 'npx';
  return 'zip';
}
/* the newest version on npm, for a Lapka that runs from there */
export async function checkNpm({ fetch = globalThis.fetch, name = pkg.name, current = VERSION } = {}) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`npm answered ${res.status}`);
  const latest = String((await res.json()).version || '') || null;
  return { current, latest, tag: latest ? 'v' + latest : null, url: `https://www.npmjs.com/package/${name}`, newer: !!latest && compareVersions(latest, current) > 0 };
}

/* Brings the folder to the version tagged, telling each step; leaves the
   process running for the caller to restart. */
export async function runUpdate({ tag, onStep = () => {}, fetch = globalThis.fetch, root = ROOT, repo = REPO } = {}) {
  const kind = installKind(root);
  if (kind === 'git') {
    onStep({ key: 'updFolder' });
    const dirty = (await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root })).trim();
    if (dirty) throw Object.assign(new Error('the folder has changed files, git will not overwrite them; update by hand'), { key: 'dirty' });
    onStep({ key: 'updPull' });
    await run('git', ['pull', '--ff-only'], { cwd: root });
  } else {
    if (!tag) throw Object.assign(new Error('no version to download'), { key: 'noTag' });
    onStep({ key: 'updZip', tag });
    const res = await fetch(`https://github.com/${repo}/archive/refs/tags/${tag}.zip`, { headers: { 'user-agent': 'Lapka' }, signal: AbortSignal.timeout(5 * 60 * 1000), redirect: 'follow' });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for the archive`);
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-update-'));
    const zip = path.join(work, 'lapka.zip');
    await fsp.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    onStep({ key: 'updUnpack' });
    await run('tar', ['-xf', zip, '-C', work]);   // bsdtar reads zip on macOS, Linux and Windows 10+
    const top = (await fsp.readdir(work, { withFileTypes: true })).find(d => d.isDirectory());
    if (!top) throw Object.assign(new Error('the archive holds no folder'), { key: 'noFolder' });
    onStep({ key: 'updReplace' });
    const from = path.join(work, top.name);
    for (const d of await fsp.readdir(from, { withFileTypes: true })) {
      if (KEEP.has(d.name)) continue;
      await fsp.rm(path.join(root, d.name), { recursive: true, force: true });
      await fsp.cp(path.join(from, d.name), path.join(root, d.name), { recursive: true });
    }
    await fsp.rm(work, { recursive: true, force: true });
  }
  onStep({ key: 'updDeps' });
  await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: root });
  return { kind };
}

/* A detached shell that waits for this process to end and starts Lapka
   again the way the launcher does, with the same port; then the caller
   ends this process. What the new Lapka prints goes to the log where the
   system keeps Lapka's settings, as the launcher's does; the program
   folder holds the program only. */
export function restartAfterExit({ port, root = ROOT, own = systemConfigDir() } = {}) {
  const node = process.execPath, main = path.join(root, 'core', 'main.mjs');
  const env = { ...process.env, PORT: String(port) };
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/d', '/c', `timeout /t 2 /nobreak >nul & start "" /b "${node}" "${main}"`], { detached: true, stdio: 'ignore', cwd: root, env, windowsHide: true });
    child.unref();
  } else {
    fs.mkdirSync(own, { recursive: true });
    const log = path.join(own, 'lapka.log');
    const script = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done; nohup "${node}" "${main}" >> "${log}" 2>&1 &`;
    const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore', cwd: root, env });
    child.unref();
  }
}
