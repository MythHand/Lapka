#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   Lapka by its short name.

   `npx -y lapka` is this file. It holds no Lapka of its own: it asks
   npm to run the newest @mythhand/lapka, the package the player is
   published as, and hands it the terminal, the environment (PORT,
   LAPKA_HOME…) and the arguments. So the short name never falls
   behind the player: what runs is whatever is newest on npm.
   ═══════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';

const args = ['exec', '--yes', '--package=@mythhand/lapka@latest', '--', 'lapka', ...process.argv.slice(2)];
/* under npx the npm that started this file is known; by hand, the npm on the path */
const npm = process.env.npm_execpath;
const run = npm
  ? spawnSync(process.execPath, [npm, ...args], { stdio: 'inherit' })
  : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(run.status ?? 1);
