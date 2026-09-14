/* ═══════════════════════════════════════════════════════════
   The synthetic site is consistent with itself.

   A crawl from the front page: every link, iframe, data-embed,
   <video src>, <source src> and script `file:` must answer. Every
   case must show as many episodes as it declares, and every dub it
   declares must be reachable from the episode page, on it or inside
   its player. When a case is added and the render forgets half of
   it, this is what says so.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build, haveFfmpeg } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { CASES, slug } from './site/cases.mjs';

const ffmpeg = await haveFfmpeg();
let site;

before(async () => {
  if (!ffmpeg) return;
  const fx = await build();
  site = await startSite({ media: fx.show });
});
after(async () => { if (site) await site.close(); });

const text = async p => {
  const r = await fetch(site.base + p);
  assert.equal(r.status, 200, `${p} answered ${r.status}`);
  return r.text();
};

/* Everything a page points at, whatever the attribute. */
const refs = html => {
  const out = new Set();
  const re = /(?:href|src|value|data-embed|content)="([^"]+)"|(?:file|"file"):\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const v = m[1] || m[2];
    if (v && v.startsWith('/')) out.add(v);
  }
  return [...out];
};

describe('synthetic site', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  test('every reference on every page answers', async () => {
    const seen = new Set();
    const queue = ['/'];
    while (queue.length) {
      const p = queue.shift();
      if (seen.has(p)) continue;
      seen.add(p);
      const r = await fetch(site.base + p);
      assert.equal(r.status, 200, `${p} answered ${r.status}`);
      const type = r.headers.get('content-type') || '';
      if (type.startsWith('text/html')) for (const ref of refs(await r.text())) queue.push(ref);
      else if (type.includes('mpegurl')) {
        for (const line of (await r.text()).split('\n'))
          if (line && !line.startsWith('#')) queue.push('/media/hls/' + line.trim());
      }
    }
    assert.ok(seen.size > 30, `crawled only ${seen.size} urls`);
    assert.ok([...seen].some(p => p.endsWith('.ts')), 'no HLS segment was reached');
    assert.ok([...seen].some(p => p.endsWith('.mp4')), 'no mp4 was reached');
  });

  test('every case lists the episodes it declares', async () => {
    for (const c of CASES) {
      const html = await text(`/s/${c.id}/`);
      const links = [...html.matchAll(new RegExp(`/s/${c.id}/ep-(\\d+)`, 'g'))].map(m => Number(m[1]));
      assert.deepEqual([...new Set(links)].sort((a, b) => a - b), Array.from({ length: c.episodes }, (_, i) => i + 1), c.id);
      assert.match(html, /og:title/);
      assert.match(html, /<h1>/);
    }
  });

  test('every declared dub is reachable from the episode page', async () => {
    for (const c of CASES) {
      for (let ep = 1; ep <= c.episodes; ep++) {
        const html = await text(`/s/${c.id}/ep-${ep}`);
        const embeds = refs(html).filter(r => r.startsWith('/embed/'));
        const found = new Set();
        for (const p of c.players) for (const d of c.dubs[p]) if (html.includes(`>${d}<`)) found.add(d);
        for (const e of embeds) {
          const inner = await text(e);
          for (const p of c.players) for (const d of c.dubs[p]) if (inner.includes(`data-dub="${d}"`) || inner.includes(`"name":"${d}"`)) found.add(d);
          /* alpha embeds only show one dub each; the tabs on the page name the rest */
          const m = /^\/embed\/alpha\/[a-z]+-\d+-([a-z0-9]+)$/.exec(e);
          if (m) for (const d of c.dubs.alpha) if (slug(d) === m[1]) found.add(d);
        }
        const declared = new Set(c.players.flatMap(p => c.dubs[p]));
        for (const d of declared) assert.ok(found.has(d), `${c.id} ep-${ep}: dub "${d}" not reachable`);
        if (c.layout.dubs === 'none') assert.equal(embeds.length, 0, `${c.id} has no players but embeds`);
      }
    }
  });

  test('unknown pages are 404, not something else', async () => {
    for (const p of ['/s/nope/', '/s/links/ep-9', '/embed/alpha/links-1-nobody', '/embed/beta/links-1', '/media/../fixtures.mjs', '/media/hls/../../server.mjs'])
      assert.equal((await fetch(site.base + p)).status, 404, p);
  });
});
