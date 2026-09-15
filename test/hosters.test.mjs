/* ═══════════════════════════════════════════════════════════
   The video hosters half the world's anime sites embed, read on
   saved embed pages: streamwish and mixdrop keep their addresses in
   a packed script, mp4upload in a plain one, zilla answers with the
   playlist itself, streamtape glues its address in a line of script.
   Snapshots: test/snapshots/hosters.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import generic from '../core/extract/players/generic.mjs';
import streamtape, { readLink } from '../core/extract/players/streamtape.mjs';
import { unpacked, urlFromBase64 } from '../core/discover/objects.mjs';
import { loadExtractors, extractorFor } from '../core/extract/index.mjs';

const SNAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'hosters');
const snap = f => fs.readFileSync(path.join(SNAP, f), 'utf8');
const serving = (file, url) => ({ fetch: async u => ({ status: 200, url: url || u, body: snap(file), headers: {}, cookies: [] }) });

describe('what a script hides', () => {
  test('a packed script unpacks to what the hoster wrote', () => {
    const [js] = unpacked(snap('streamwish.html'));
    assert.match(js, /"hls2":"https:\/\/[^"]+master\.m3u8\?/);
    assert.deepEqual(unpacked('nothing packed here'), []);
  });
  test('an address in base64 is an address', () => {
    assert.equal(urlFromBase64('aHR0cHM6Ly9tZWRpYWZpcmUuY29tL2ZpbGUvN2U1YzQ5M3g4cnBrdXBwLwo='), 'https://mediafire.com/file/7e5c493x8rpkupp/');
    assert.equal(urlFromBase64('https://plain.example/x'), null);
    assert.equal(urlFromBase64('not base64 at all'), null);
  });
});

describe('the hosters through the general extractor', () => {
  test('streamwish: an HLS master out of the packed script, the embed as the referer', async () => {
    const got = await generic.extract('https://sfastwish.com/e/x3vpcf66yioy', { referer: 'https://jkanime.net/' }, serving('streamwish.html', 'https://flaswish.com/e/x3vpcf66yioy'));
    const hls = got.streams.filter(s => s.kind === 'hls');
    assert.ok(hls.length >= 1);
    assert.match(hls[0].url, /cdn-centaurus\.com\/hls2\/.*master\.m3u8\?t=/);
    assert.equal(hls[0].headers.referer, 'https://flaswish.com/e/x3vpcf66yioy');
  });
  test('mixdrop: an mp4 out of the packed script', async () => {
    const got = await generic.extract('https://mixdrop.top/e/r6wjqww0bv4n0kl', {}, serving('mixdrop.html', 'https://miixdrop.top/e/r6wjqww0bv4n0kl'));
    assert.ok(got.streams.some(s => s.kind === 'mp4' && /^https:\/\/\w+\.mxcontent\.net\/v2\/r6wjqww0bv4n0kl\.mp4\?s=/.test(s.url)), JSON.stringify(got.streams));
  });
  test('mp4upload: an mp4 named by its type, with no extension of its own', async () => {
    const got = await generic.extract('https://www.mp4upload.com/embed-fc8poyk5tit7.html', {}, serving('mp4upload.html'));
    assert.deepEqual(got.streams.map(s => [s.kind, /mp4upload\.com:183\/d\//.test(s.url)]), [['mp4', true]]);
  });
  test('an embed that answers with the playlist itself is the stream', async () => {
    const got = await generic.extract('https://player.zilla-networks.com/m3u8/954d027f725373d7ef0f72caad8532bc', {}, serving('zilla.m3u8'));
    assert.deepEqual(got.streams.map(s => [s.kind, s.url, s.headers.referer]), [['hls', 'https://player.zilla-networks.com/m3u8/954d027f725373d7ef0f72caad8532bc', 'https://player.zilla-networks.com/']]);
  });
});

describe('streamtape', () => {
  test('the address glued from the pieces the page holds', () => {
    assert.equal(readLink(snap('streamtape.html')), 'https://streamtape.com/get_video?xcdid=wYM2ZbzQVlujO3&expires=1789539748&ip=FOSOERySD0SYFxf&token=l-BgshXTFAps');
    assert.equal(readLink('<html></html>'), null);
  });
  test('extracted: one mp4 asked as a stream; the registry knows the host', async () => {
    const got = await streamtape.extract('https://streamtape.com/e/wYM2ZbzQVlujO3/x.mp4', {}, serving('streamtape.html'));
    assert.deepEqual([got.streams[0].kind, got.streams[0].url.endsWith('&stream=1'), got.streams[0].headers.referer], ['mp4', true, 'https://streamtape.com/']);
    assert.equal(extractorFor(await loadExtractors(), 'https://streamtape.com/e/abc').name, 'streamtape');
  });
});
