/* ═══════════════════════════════════════════════════════════
   Driving the real page in a real browser.

   The player is one file of DOM code with no module boundary, so there
   is nothing to import and assert against. What can be done is to run
   it the way it actually runs and then measure the result, which is
   also the only way to catch what the suite is for here: layout that
   collapses, icons that come out the wrong size, menus that paint over
   each other. None of that is visible to a unit test.

   The trick is that the page under test is the real index.html with one
   script appended. It is copied to a temporary directory together with
   the styles, the code and the fonts, so the files being tested are
   byte for byte the ones that ship, and nothing in the project is
   modified to make testing possible.

   Chrome writes the page out and then lingers, so we wait for the dump
   and stop it ourselves rather than waiting for it to exit.
   ═══════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const WEB = path.join(ROOT, 'web');

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  return CHROMES.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

const CLIENT = ['index.html', 'styles.css', 'app.js', 'i18n.js'];
const FONTS = ['assets/fonts/FixelDisplay', 'assets/fonts/Inter'];

/* Errors are collected from the head, before app.js runs: installed at
   the end of the body, the listener would miss anything the player
   throws on the way up, which is exactly what wants catching. */
/* Transitions are switched off for the whole page. Under a virtual time
   budget the browser does not advance the animation clock, so anything
   that slides into place stays frozen at its starting position: the
   queue panel measured as parked off-screen at -101% even though it was
   open. Layout tests want the settled state, not a frame of the
   animation. */
const STILL = `
<style>*, *::before, *::after{ transition:none !important; animation:none !important; }</style>`;

const CATCH = `
<script>
window.__errors = [];
addEventListener('error', e => window.__errors.push(String(e.message)));
addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));
</script>`;

/* Real time for the page. Under a virtual time budget the page clock
   stands still only while a request is in flight; the rest of the time
   it races ahead of anything the browser does in real time. Opening a
   video is such a thing: on a CI runner it took a few hundred real
   milliseconds, and in that time the page clock ran through the whole
   budget and the test stalled with the video still opening. So the
   page can ask this server for a pause, and the request, held open for
   that long, holds the clock with it. One server per test process, on
   a port the system picks. */
let holding = null;
const holdServer = () => holding ||= new Promise(resolve => {
  const srv = http.createServer((req, res) => {
    const ms = Math.min(1000, Number(new URL(req.url, 'http://h').searchParams.get('ms')) || 0);
    setTimeout(() => res.writeHead(204, { connection: 'close' }).end(), ms);
  });
  srv.listen(0, '127.0.0.1', () => { srv.unref(); resolve(srv.address().port); });
});

/* The report goes into the page as text, because --dump-dom is the only
   channel out of headless Chrome that needs no debugging protocol. */
const report = (budget, hold) => `
<script>
window.__report = obj => {
  const pre = document.createElement('pre');
  pre.id = 'lapka-test-out';
  pre.textContent = JSON.stringify(obj);
  document.body.append(pre);
};
/* The player boots asynchronously, so the script waits for it to
   settle. Timers only, no requestAnimationFrame: under a virtual time
   budget the browser stops scheduling frames once it considers the page
   done, and a script that waits for the next frame then waits forever.
   Timers keep advancing, so a plain timeout is the reliable one. */
window.__settled = () => new Promise(r => setTimeout(r, 50));
/* For waiting on the video: a turn of the page clock, then a real pause
   with the clock held (see holdServer), so that the browser gets real
   time to open the file before the budget is spent. */
window.__tick = async () => {
  await window.__settled();
  await fetch('http://127.0.0.1:${hold}/?ms=25', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
};

/* A step marker and a watchdog. Without them a page script that stops
   halfway reports nothing at all, and the failure reads as a broken
   harness instead of naming the step that hung. A step can also leave
   window.__state behind, a function saying what it is waiting on, so
   that a stall on a machine nobody can look at (a CI runner) says more
   than the name of the step. */
window.__step = name => { window.__at = name; };
window.__at = 'start';
setTimeout(() => {
  if (document.getElementById('lapka-test-out')) return;
  let state = null;
  try { state = window.__state ? window.__state() : null; } catch (e) { state = String(e); }
  window.__report({ stalled: window.__at, state, errors: window.__errors });
}, ${Math.max(1000, budget - 1500)});   // inside the budget, or it never fires
</script>`;

/* The failure message for a page that stalled: the step, the state the
   step said it was in, and whatever the page threw on the way. */
export const stalledAt = r => 'the page script stopped at: ' + r.stalled + '\n' +
  JSON.stringify({ state: r.state, errors: r.errors }, null, 2);

/* Copies the shipping files next to a page that carries the test
   script. Returns the directory. */
export async function stage(name, script, { fonts = false, seed = null, budget = 5000 } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-ui-' + name + '-'));
  for (const f of CLIENT) await fsp.copyFile(path.join(WEB, f), path.join(dir, f));
  if (fonts) for (const f of FONTS)
    await fsp.cp(path.join(WEB, f), path.join(dir, f), { recursive: true });

  /* Anything the player is supposed to remember has to be in storage
     before app.js runs, so the seed goes into the head. Setting it from
     the test script instead would mean a second page load. */
  const primed = seed ? `
<script>
try { for (const [k, v] of ${JSON.stringify(Object.entries(seed))}) localStorage.setItem(k, v); }
catch (e) { /* storage refused, the test will say so */ }
</script>` : '';

  let html = await fsp.readFile(path.join(dir, 'index.html'), 'utf8');
  /* function replacements: a string one would read $$ and $& in the
     test script as patterns of its own */
  html = html.replace('</head>', () => STILL + CATCH + primed + '\n</head>');
  /* The script is wrapped rather than trusted to report by itself: when
     it throws halfway through, an unwrapped one reports nothing at all
     and the failure reads as "the page said nothing", which points at
     the harness instead of at the line that broke. */
  const wrapped = '<script>(async () => { try {\n' + script +
    '\n} catch (e) { window.__report({ fatal: String((e && e.stack) || e),' +
    ' errors: window.__errors }); } })();</script>';
  const tail = report(budget, await holdServer()) + '\n' + wrapped + '\n</body>';
  html = html.replace('</body>', () => tail);
  await fsp.writeFile(path.join(dir, 'index.html'), html, 'utf8');
  return dir;
}

/* Runs Chrome over a URL and hands back whatever the page reported. */
export async function visit(url, { width = 1280, height = 800, budget = 5000 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome found; set CHROME to its path');

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pip-player-chrome-'));
  const dump = path.join(work, 'dump.html');
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    /* Pinned to English. The player picks its language from the browser,
       so without this the suite would boot in whatever locale the
       machine happens to have and the language tests would compare a
       translation against itself. */
    '--lang=en-US', '--accept-lang=en-US,en',
    /* Nothing clicks play in a headless browser. */
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + path.join(work, 'profile'),
    '--window-size=' + width + ',' + height,
    '--virtual-time-budget=' + budget,
    '--dump-dom', url,
  ], { stdio: ['ignore', fs.openSync(dump, 'w'), 'ignore'] });

  try {
    for (let i = 0; i < 600; i++) {
      const st = await fsp.stat(dump).catch(() => null);
      if (st && st.size > 0) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const html = await fsp.readFile(dump, 'utf8');
    const m = /<pre id="lapka-test-out">([\s\S]*?)<\/pre>/.exec(html);
    if (!m) throw new Error('the page reported nothing; it probably threw before the test ran');
    const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return JSON.parse(unescape(m[1]));
  } finally {
    /* Chrome is still flushing its profile when it is killed, so the
       directory refuses to go on the first try. Cleaning up a temporary
       folder is not worth failing a test over: wait for the process to
       actually be gone, retry a few times, then leave it to the system. */
    const gone = new Promise(r => child.once('exit', r));
    child.kill('SIGKILL');
    await Promise.race([gone, new Promise(r => setTimeout(r, 2000))]);
    for (let i = 0; i < 5; i++) {
      try { await fsp.rm(work, { recursive: true, force: true }); break; }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
  }
}

/* The player has to work opened straight from a file, so most of the
   interface tests need no server at all. */
/* The page, served by Lapka itself from the staged copy, with a folder
   of its own for the cache and the state. The test's page script gets
   `site`, the address of the synthetic site, as a literal. */
export async function openLapka(name, script, { site = '', home = null, ...opts } = {}) {
  const { start } = await import('../core/main.mjs');
  const dir = await stage(name, `const site = ${JSON.stringify(site)};\n` + script, opts);
  const ownHome = !home;
  if (!home) home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-home-'));
  const lapka = await start({ port: 0, home, webDir: dir });
  try {
    return await visit(lapka.base + '/' + (opts.query || ''), opts);
  } finally {
    await lapka.close();
    if (!process.env.KEEP_STAGE) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (ownHome) await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
    }
  }
}
