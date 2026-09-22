/* Updating from the settings: the version compared by numbers, GitHub
   asked for the latest release or the highest tag, the folder told
   apart as a clone or an archive. The update itself is not run here:
   it would pull this very repository. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, checkUpdate, installKind, REPO, VERSION } from '../core/update.mjs';

describe('the update', () => {
  test('versions compare by numbers', () => {
    assert.ok(compareVersions('1.10.0', '1.9.3') > 0);
    assert.ok(compareVersions('v1.1.0', '1.1.0') === 0);
    assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
    assert.ok(compareVersions('2', '1.99.99') > 0);
  });
  test('the repository comes from the package', () => {
    assert.equal(REPO, 'MythHand/Lapka');
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(installKind(), 'git');
  });
  test('the latest release, or the highest tag when there is no release', async () => {
    const asked = [];
    const rel = async (url) => { asked.push(url); return { ok: true, json: async () => ({ tag_name: 'v1.2.0', html_url: 'https://github.com/MythHand/Lapka/releases/tag/v1.2.0' }) }; };
    const a = await checkUpdate({ fetch: rel, current: '1.0.0' });
    assert.deepEqual([a.latest, a.tag, a.newer], ['1.2.0', 'v1.2.0', true]);
    const tags = async (url) => /releases\/latest/.test(url) ? { ok: false, status: 404 } : { ok: true, json: async () => [{ name: 'v1.0.0' }, { name: 'v1.1.0' }, { name: 'rc' }, { name: 'v0.9.0' }] };
    const b = await checkUpdate({ fetch: tags, current: '1.1.0' });
    assert.deepEqual([b.latest, b.newer, b.url], ['1.1.0', false, 'https://github.com/MythHand/Lapka/releases/tag/v1.1.0']);
    await assert.rejects(checkUpdate({ fetch: async () => ({ ok: false, status: 500 }), current: '1.0.0' }), /500/);
  });
});
