/* Where the one setting outside the folder lives: the system's place,
   named through LAPKA_CONFIG here so the test touches nothing of the
   machine's own; the old .dev place carried over once; how a Lapka
   knows the way it got here. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { systemConfigDir, CONFIG_FILE } from '../core/store/config.mjs';
import { installKind, compareVersions, checkNpm } from '../core/update.mjs';

describe('the settings file', () => {
  test('the system\'s place for settings, per platform', () => {
    const dir = systemConfigDir();
    if (process.platform === 'darwin') assert.match(dir, /Library\/Application Support\/Lapka$/);
    else if (process.platform === 'win32') assert.match(dir, /[\\/]Lapka$/);
    else assert.match(dir, /[\\/]lapka$/);
    assert.ok(path.isAbsolute(dir));
  });
  test('the tests point the file elsewhere and read and write it there', async () => {
    assert.ok(process.env.LAPKA_CONFIG, 'npm test names a config file of its own');
    assert.equal(CONFIG_FILE, process.env.LAPKA_CONFIG);
    const { readConfig, writeConfig } = await import('../core/store/config.mjs');
    await writeConfig({ probe: 1 });
    assert.equal((await readConfig()).probe, 1);
    await fsp.rm(CONFIG_FILE, { force: true });
  });
});

describe('how Lapka got here', () => {
  test('a clone, an archive, the npx cache', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-kind-'));
    assert.equal(installKind(tmp), 'zip');
    await fsp.mkdir(path.join(tmp, '.git'));
    assert.equal(installKind(tmp), 'git');
    assert.equal(installKind(path.join(tmp, '.npm', '_npx', 'abc123', 'node_modules', '@mythhand', 'lapka')), 'npx');
    await fsp.rm(tmp, { recursive: true, force: true });
  });
  test('the newest on npm, compared by numbers', async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ version: '1.2.0' }) });
    const r = await checkNpm({ fetch, name: 'lapka', current: '1.1.1' });
    assert.deepEqual([r.latest, r.tag, r.newer], ['1.2.0', 'v1.2.0', true]);
    assert.equal(compareVersions('1.1.1', '1.2.0') < 0, true);
    await assert.rejects(checkNpm({ fetch: async () => ({ ok: false, status: 404 }), name: 'lapka' }), /404/);
  });
});
