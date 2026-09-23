/* npm test, the same on every system: the tests get a settings file of
   their own in the temp folder, so nothing is written into the place
   where the machine keeps Lapka's settings; then node --test as before. */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const files = fs.readdirSync('test').filter(f => f.endsWith('.test.mjs')).map(f => path.join('test', f));
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, LAPKA_CONFIG: process.env.LAPKA_CONFIG || path.join(os.tmpdir(), 'lapka-test-config.json') } });
child.on('exit', code => process.exit(code ?? 1));
