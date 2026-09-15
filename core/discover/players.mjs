/* ═══════════════════════════════════════════════════════════
   The players on the page, and the switches that drive them.

   A player is anything that can play: an iframe, a <video>, a stream
   address sitting in a script, an og:video. A switch is a group of
   siblings that each carry an address to load into the player: dub
   tabs, a player selector, sometimes both. Which of the two a group is
   comes from its labels and attributes: "Плеер 2" and data-player mean
   players; a studio name means dubs; a group that says nothing is
   taken for dubs, because that is what most switches are.

   Each embed is identified by its player: the host it comes from, or
   for the site's own embeds the path they live under. One Kodik
   serves fifty sites, and one page can carry three players.
   ═══════════════════════════════════════════════════════════ */
import { studioFor } from '../catalog/studios.mjs';
import { textOf } from './text.mjs';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const EMBED_ATTRS = ['data-embed', 'data-src', 'data-url', 'data-iframe', 'data-player-url', 'data-link', 'data-file', 'data-video'];
const STREAM_RE = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?|(?<![\w/])\/[^\s"'<>\\]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?/g;
const PLAYER_WORDS = /\b(?:плеер|player|источник|source|сервер|server)\b/i;

/* A player the page fetches after it loads: the element carries the
   parameters of a request instead of an address, and the site's
   engine answers with the embed's address. DLE's xfplayer is the
   common case: data-params="mod=kodik-player&url=1&action=iframe&id=31"
   is answered by /engine/ajax/controller.php with those parameters.
   Such a player is deferred: the address is asked for when it is
   opened, not while the page is read. */
const DEFERRED = [{
  attr: 'data-params', when: /(^|&)mod=[\w-]*player/i,
  url: (v, page) => new URL('/engine/ajax/controller.php?' + v, page).toString(),
  id: v => ((/(^|&)mod=([\w-]+?)(-player)?(&|$)/i.exec(v) || [])[2] || 'player').toLowerCase(),
}];

export const streamKind = u => /\.m3u8(\?|$)/i.test(u) ? 'hls' : /\.mpd(\?|$)/i.test(u) ? 'dash' : /\.mp4(\?|$)/i.test(u) ? 'mp4' : null;

/* "720p" in the file name, or a bare 480/720/1080 as a folder of the
   path: the two ways a CDN names a quality. */
export function qualityOf(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const segs = u.pathname.split('/').filter(Boolean);
  const name = (segs.pop() || '').replace(/\.[a-z0-9]+$/i, '');
  /* a whole token of the name, "720p" or "720", never digits inside a hash */
  for (const tok of name.split(/[-_. ]+/)) {
    const m = /^(\d{3,4})p?$/i.exec(tok);
    if (m && Number(m[1]) >= 240 && Number(m[1]) <= 4320) return `${m[1]}p`;
  }
  const fromPath = segs.map(Number).reverse().find(n => [240, 360, 480, 540, 720, 1080, 1440, 2160, 4320].includes(n));
  return fromPath ? `${fromPath}p` : null;
}

export function playerId(embedUrl, pageUrl) {
  let u, p;
  try { u = new URL(embedUrl); p = new URL(pageUrl); } catch { return 'unknown'; }
  const host = u.hostname.replace(/^www\./, '');
  if (host !== p.hostname.replace(/^www\./, '')) return host;
  const parts = u.pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2).join('/') : parts[0] || 'page';
}

function embedOf(el, url) {
  for (const a of EMBED_ATTRS) {
    const v = el.getAttribute(a);
    if (v && /[/.]/.test(v) && !/^#/.test(v)) { try { return new URL(v, url).toString(); } catch { /* not an address */ } }
  }
  return null;
}

export function findPlayers(doc, url, { profile } = {}) {
  const players = [];
  const switches = [];
  const seen = new Map();
  const add = (embed, kind, where, extra = {}) => {
    if (!embed) return null;
    let p = seen.get(embed);
    if (!p) {
      p = { id: playerId(embed, url), kind, url: embed, dubLabel: null, playerLabel: null, stream: streamKind(embed), where };
      seen.set(embed, p); players.push(p);
    }
    if (extra.dubLabel && !p.dubLabel) p.dubLabel = extra.dubLabel;
    if (extra.playerLabel && !p.playerLabel) p.playerLabel = extra.playerLabel;
    return p;
  };
  const abs = v => { try { return v ? new URL(v, url).toString() : null; } catch { return null; } };

  /* what is on the page right now */
  for (const f of doc.querySelectorAll('iframe')) add(abs(f.getAttribute('src') || f.getAttribute('data-src')), 'iframe', 'iframe');
  for (const v of doc.querySelectorAll('video')) {
    add(abs(v.getAttribute('src') || v.getAttribute('data-src')), 'video', 'video');
    for (const s of v.querySelectorAll('source')) add(abs(s.getAttribute('src')), 'video', 'video source');
  }
  add(abs(doc.querySelector('meta[property="og:video"], meta[property="og:video:url"]')?.getAttribute('content')), 'og', 'meta[og:video]');
  for (const d of DEFERRED) for (const el of doc.querySelectorAll(`[${d.attr}]`)) {
    const v = el.getAttribute(d.attr) || '';
    if (!d.when.test(v)) continue;
    let u; try { u = d.url(v, url); } catch { continue; }
    const p = add(u, 'deferred', `[${d.attr}]`);
    if (p) p.id = d.id(v);
  }
  for (const s of doc.querySelectorAll('script:not([src])')) {
    for (const m of s.textContent.matchAll(STREAM_RE)) add(abs(m[0]), 'script', 'script');
  }

  /* the switches: siblings that carry an address each */
  const groups = new Map();
  const carriers = profile?.dubs?.list || profile?.players?.list
    ? [...doc.querySelectorAll([profile?.dubs?.list, profile?.players?.list].filter(Boolean).join(','))]
    : [...doc.querySelectorAll(EMBED_ATTRS.map(a => `[${a}]`).join(','))];
  for (const el of carriers) {
    const embed = embedOf(el, url) || abs(el.getAttribute('href'));
    if (!embed) continue;
    const parent = el.parentNode;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push({ el, embed, label: textOf(el) || clean(el.getAttribute('title')) });
  }

  for (const [parent, items] of groups) {
    const labels = items.map(i => i.label);
    const saysPlayer = items.some(i => i.el.hasAttribute('data-player')) || labels.some(l => PLAYER_WORDS.test(l));
    const saysStudio = labels.some(l => studioFor(l));
    let kind = saysStudio ? 'dubs' : saysPlayer ? 'players' : 'dubs';
    if (profile?.players?.list && parent.querySelector(profile.players.list)) kind = 'players';
    if (profile?.dubs?.list && parent.querySelector(profile.dubs.list)) kind = 'dubs';
    const scope = parent.getAttribute('data-for') || parent.getAttribute('data-player') || null;
    const where = parent.tagName.toLowerCase() + (parent.id ? '#' + parent.id : parent.className ? '.' + String(parent.className).split(/\s+/)[0] : '');
    switches.push({ kind, scope, where, items: items.map(i => ({ label: i.label, url: i.embed })) });
    for (const i of items) {
      const p = add(i.embed, 'switch', where, kind === 'dubs' ? { dubLabel: i.label } : { playerLabel: i.label });
      if (p && kind === 'dubs' && scope) p.scope = scope;
    }
  }

  return { players, switches };
}
