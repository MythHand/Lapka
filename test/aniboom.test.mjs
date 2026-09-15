/* The AniBoom extractor on a saved embed page: the HLS address out of data-parameters, with the headers the CDN wants. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import aniboom, { readEmbed } from '../core/extract/players/aniboom.mjs';
import { loadExtractors, extractorFor } from '../core/extract/index.mjs';

const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'aniboom', 'embed.html'), 'utf8');
const EMBED = 'https://aniboom.one/embed/9ZLq9oYXN5G?episode=1&translation=18';

describe('AniBoom', () => {
  test('the embed names its HLS and its DASH', () => {
    const e = readEmbed(page);
    assert.match(e.hls.src, /\/master\.m3u8$/);
    assert.match(e.dash.src, /\.mpd$/);
    assert.match(e.errorPage, /^\/video-error\//);
    assert.equal(readEmbed('<html></html>'), null);
  });
  test('extracted: one adaptive HLS stream, the embed as the referer', async () => {
    const session = { fetch: async url => ({ status: 200, url, body: page, headers: {}, cookies: [] }) };
    const got = await aniboom.extract(EMBED, { referer: 'https://animego.me/' }, session);
    assert.equal(got.streams.length, 1);
    assert.deepEqual([got.streams[0].kind, got.streams[0].quality], ['hls', null]);
    assert.deepEqual(got.streams[0].headers, { referer: 'https://aniboom.one/', origin: 'https://aniboom.one' });
    await assert.rejects(aniboom.extract(EMBED, {}, { fetch: async url => ({ status: 200, url, body: '<html>', headers: {}, cookies: [] }) }), /no player/);
  });
  test('the registry knows the host', async () => {
    assert.equal(extractorFor(await loadExtractors(), EMBED).name, 'aniboom');
  });
});
