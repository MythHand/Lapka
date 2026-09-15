/* ═══════════════════════════════════════════════════════════
   The Kodik extractor, on a saved embed and a played-back answer.

   The embed page and the player script are the real ones; the
   answer of the stream endpoint is built here from a known address
   with the encoding the script describes, so that the decoding and
   the whole request are checked without the network. Then the way
   through resolve(): a source with no streams yet asks the player;
   a stream that failed is asked for again before its source is
   given up on.
   ═══════════════════════════════════════════════════════════ */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kodik, { decodeLink, readScript, readEmbed } from '../core/extract/players/kodik.mjs';
import { loadExtractors, extractorFor } from '../core/extract/index.mjs';
import { createLapka } from '../core/lapka.mjs';
import { createSeries, merge } from '../core/catalog/index.mjs';

const SNAP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'snapshots', 'kodik');
const page = fs.readFileSync(path.join(SNAP, 'embed.html'), 'utf8');
const script = fs.readFileSync(path.join(SNAP, 'app.player_single.js'), 'utf8');
const EMBED = 'https://kodikplayer.com/season/3207/710acb8a606c0b7f0ed82ace7f632311/720p?translations=false&only_episode=true&only_season=true&episode=1';
const LINK = '//cloud.example/useruploads/abc/720.mp4:hls:manifest.m3u8';

/* the inverse of the player's decoding: base64, then letters shifted back */
const encodeLink = (url, shift) => Buffer.from(url).toString('base64').replace(/[a-zA-Z]/g, c => {
  const bottom = c <= 'Z' ? 65 : 97;
  let n = c.charCodeAt(0) - shift;
  if (n < bottom) n += 26;
  return String.fromCharCode(n);
});

/* a session that plays the snapshots and answers the stream request; it records what it was asked */
function fakeSession({ fail = false } = {}) {
  const asked = [];
  return {
    asked,
    fetch: async (url, opts = {}) => {
      asked.push({ url, ...opts });
      const u = new URL(url);
      if (u.pathname.startsWith('/season/')) return { status: 200, url, body: page, headers: {}, cookies: ['__ddg1_=abc; Domain=.kodikplayer.com; Path=/', '_mail_id=xyz; path=/'] };
      if (u.pathname.startsWith('/assets/js/app.player_single.')) return { status: 200, url, body: script, headers: {}, cookies: [] };
      if (u.pathname === '/ftor' && opts.method === 'POST') {
        if (fail) return { status: 500, url, body: '<html>Error</html>', headers: {}, cookies: [] };
        const links = { 360: [{ src: encodeLink(LINK.replace('720', '360'), 18), type: 'application/x-mpegURL' }], 720: [{ src: encodeLink(LINK, 18), type: 'application/x-mpegURL' }] };
        return { status: 200, url, body: JSON.stringify({ links, domain: 'old.yummyani.me' }), headers: {}, cookies: [] };
      }
      return { status: 404, url, body: '', headers: {}, cookies: [] };
    },
  };
}

describe('reading Kodik', () => {
  test('the embed page: the video, the signatures, the script', () => {
    const e = readEmbed(page);
    assert.equal(e.type, 'seria');
    assert.equal(e.hash, '710acb8a606c0b7f0ed82ace7f632311');
    assert.equal(e.id, '42969');
    assert.equal(e.signed.d, 'old.yummyani.me');
    assert.match(e.signed.d_sign, /^[a-f0-9]{64}:\d+$/);
    assert.equal(e.signed.ref, 'https://old.yummyani.me/');
    assert.match(e.script, /app\.player_single\.[a-f0-9]+\.js$/);
  });
  test('the script: the endpoint and the shift', () => {
    assert.deepEqual(readScript(script), { endpoint: '/ftor', shift: 18 });
    assert.deepEqual(readScript('nothing here'), { endpoint: '/ftor', shift: 18 });
  });
  test('a link decodes back to its address, whatever the shift', () => {
    for (const shift of [13, 18, 5]) assert.equal(decodeLink(encodeLink(LINK, shift), shift), LINK);
    assert.equal(decodeLink('//already.plain/x.m3u8', 18), '//already.plain/x.m3u8');
  });
  test('the registry puts kodik before generic and matches its hosts', async () => {
    const list = await loadExtractors();
    assert.equal(extractorFor(list, EMBED).name, 'kodik');
    assert.equal(extractorFor(list, 'https://kodik.info/seria/1/abc/720p').name, 'kodik');
    assert.equal(extractorFor(list, 'https://aniqit.com/seria/1/abc/720p').name, 'kodik');
    assert.equal(extractorFor(list, 'https://other.example/embed').name, 'generic');
  });
});

describe('extracting from Kodik', () => {
  test('asks the player the way its own script does and returns the qualities', async () => {
    const session = fakeSession();
    const got = await kodik.extract(EMBED, { referer: 'https://old.yummyani.me/' }, session);
    assert.deepEqual(got.streams.map(s => [s.kind, s.quality, s.url]), [
      ['hls', '360p', 'https://cloud.example/useruploads/abc/360.mp4:hls:manifest.m3u8'],
      ['hls', '720p', 'https://cloud.example/useruploads/abc/720.mp4:hls:manifest.m3u8'],
    ]);
    assert.equal(got.streams[0].headers.referer, 'https://kodikplayer.com/');
    assert.ok(got.streams[0].expiresAt > Date.now());
    const post = session.asked.find(a => a.method === 'POST');
    const form = new URLSearchParams(post.body);
    assert.equal(post.url, 'https://kodikplayer.com/ftor');
    assert.equal(form.get('hash'), '710acb8a606c0b7f0ed82ace7f632311');
    assert.equal(form.get('id'), '42969');
    assert.equal(form.get('type'), 'seria');
    assert.equal(form.get('ref'), 'https://old.yummyani.me/');
    assert.equal(form.get('d'), 'old.yummyani.me');
    assert.ok(form.get('d_sign') && form.get('pd_sign') && form.get('ref_sign'));
    assert.equal(post.headers.cookie, '__ddg1_=abc; _mail_id=xyz');
    assert.equal(post.headers.origin, 'https://kodikplayer.com');
  });
  test('a player that refuses is an error, not an empty answer', async () => {
    await assert.rejects(kodik.extract(EMBED, {}, fakeSession({ fail: true })), /answered 500/);
  });
});

describe('through resolve()', () => {
  /* a series the adapter would have given: a source with no streams yet */
  const seriesWithKodik = () => {
    const s = createSeries({ sourceUrl: 'https://old.yummyani.me/catalog/item/x' });
    merge(s, { origin: 'site:test', series: { title: 'X' }, episodes: [{ number: 1, sourceUrl: 'https://old.yummyani.me/catalog/item/x',
      dubs: [{ name: 'AniLibria', sources: [{ player: 'kodik', embedUrl: EMBED, extractor: 'kodik' }] }] }] });
    s.episodes[0].opened = true;
    return s;
  };
  const delivery = { register: () => 'id' + Math.random().toString(36).slice(2, 8), get: () => null };

  test('a source without streams asks the player when it is picked; a failed stream is asked for again, then given up on', async () => {
    const session = fakeSession();
    const lapka = createLapka({ session, extractors: await loadExtractors(), delivery });
    const s = lapka.adopt(seriesWithKodik());
    const r = await lapka.resolve({ seriesId: s.id, number: 1 });
    assert.equal(r.dub.name, 'AniLibria');
    assert.equal(r.source.player, 'kodik');
    assert.equal(r.stream.quality, '720p');
    assert.ok(session.asked.some(a => a.method === 'POST'));
    /* the second time it is not asked again */
    const n = session.asked.length;
    await lapka.resolve({ seriesId: s.id, number: 1 });
    assert.equal(session.asked.length, n);
    /* a stream that failed: asked once more, and since the same links come back under new ids, the source lives on with them */
    const r2 = await lapka.resolve({ seriesId: s.id, number: 1, avoid: r.stream.id });
    assert.ok(session.asked.length > n);
    assert.equal(r2.source.player, 'kodik');
    assert.notEqual(r2.stream.id, r.stream.id);
  });

  test('a player that refuses leaves the source dead and the dub without a stream', async () => {
    const session = fakeSession({ fail: true });
    const lapka = createLapka({ session, extractors: await loadExtractors(), delivery });
    const s = lapka.adopt(seriesWithKodik());
    const r = await lapka.resolve({ seriesId: s.id, number: 1 });
    assert.equal(r.stream, null);
    assert.equal(r.dubs[0].alive, 0);
  });
});
