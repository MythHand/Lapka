/* ═══════════════════════════════════════════════════════════
   HTML for the synthetic site.

   Plain string templates. The markup is deliberately the ordinary
   kind: og tags, an h1, a list of links, a select, a few data-
   attributes on the switches, an iframe. Nothing here is a hint to
   Lapka; if a page needs Lapka-specific markup to be understood, the
   discovery is wrong, not the page.
   ═══════════════════════════════════════════════════════════ */
import { CASES, embedUrl, slug } from './cases.mjs';

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const page = ({ title, head = '', body }) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:site_name" content="Синтетический сайт">
${head}
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem}
iframe,video{width:100%;aspect-ratio:16/9;background:#000;border:0}
.tabs button,.players button{margin:0 .3rem .3rem 0}.on{font-weight:700}</style>
</head>
<body>
${body}
</body>
</html>
`;

export function renderHome() {
  const items = CASES.map(c => `<li><a href="/s/${c.id}/">${esc(c.title)}</a> — <small>${esc(c.device)}</small></li>`).join('\n');
  return page({ title: 'Синтетический аниме-сайт', body: `<h1>Синтетический аниме-сайт</h1>\n<ul>\n${items}\n</ul>` });
}

const episodes = c => Array.from({ length: c.episodes }, (_, i) => i + 1);

/* a season of a series: its own page, its own episodes, links to the other seasons */
const seasonsNav = (c, season) => c.layout.seasons
  ? `<div class="seasons">${Array.from({ length: c.layout.seasons }, (_, i) => i + 1).map(n =>
      n === season ? `<b>${n} сезон</b>` : `<a href="/s/${c.id}/${n === 1 ? '' : 'season-' + n + '/'}">${n} сезон</a>`).join(' ')}</div>`
  : '';
const seasonTitle = (c, season) => c.layout.seasons && season > 1 ? `${c.title} ${season} сезон` : c.title;

export function renderSeries(c, season = 1) {
  const head = `<meta property="og:image" content="/media/cover-${c.id}.jpg">`;
  const prefix = season > 1 ? `/s/${c.id}/season-${season}` : `/s/${c.id}`;
  const title = seasonTitle(c, season);
  const list = c.layout.episodes === 'select'
    ? `<select id="episodes" onchange="location.href=this.value">\n${episodes(c).map(n => `<option value="${prefix}/ep-${n}">${n} серия</option>`).join('\n')}\n</select>`
    : `<ul class="episodes">\n${episodes(c).map(n => `<li><a href="${prefix}/ep-${n}">${n} серия</a></li>`).join('\n')}\n</ul>`;
  return page({ title, head, body: `<h1>${esc(title)}</h1>\n<p class="meta">Год: 2024 · Серий: ${c.episodes}</p>\n${seasonsNav(c, season)}\n<h2>Серии</h2>\n${list}` });
}

export function renderEpisode(c, ep, season = 1) {
  const title = `${seasonTitle(c, season)} — ${ep} серия`;
  const prefix = season > 1 ? `/s/${c.id}/season-${season}` : `/s/${c.id}`;
  let player = '';

  if (c.layout.player === 'video') {
    player = `<video controls><source src="/media/hls/index.m3u8" type="application/vnd.apple.mpegurl"></video>`;
  } else if (c.layout.player === 'iframe') {
    const [p] = c.players;
    const tabs = c.dubs[p].map((d, i) =>
      `<button data-embed="${embedUrl(p, c, ep, d)}"${i ? '' : ' class="on"'}>${esc(d)}</button>`).join('\n');
    player = `<div class="tabs" id="dubs">\n${tabs}\n</div>\n<iframe id="player" src="${embedUrl(p, c, ep, c.dubs[p][0])}" allowfullscreen></iframe>`;
  } else if (c.layout.player === 'iframe-switch') {
    const first = (p) => c.dubs[p][0];
    const switcher = c.players.map((p, i) =>
      `<button data-player="${p}" data-embed="${embedUrl(p, c, ep, first(p))}"${i ? '' : ' class="on"'}>Плеер ${i + 1}</button>`).join('\n');
    /* alpha has one embed per dub, so its dubs are tabs on the page,
       shown for that player only; beta carries its own dubs inside */
    const dubTabs = c.players.filter(p => p === 'alpha').map(p =>
      `<div class="tabs" data-for="${p}">\n${c.dubs[p].map((d, i) =>
        `<button data-embed="${embedUrl(p, c, ep, d)}"${i ? '' : ' class="on"'}>${esc(d)}</button>`).join('\n')}\n</div>`).join('\n');
    player = `<div class="players" id="players">\n${switcher}\n</div>\n${dubTabs}\n<iframe id="player" src="${embedUrl(c.players[0], c, ep, first(c.players[0]))}" allowfullscreen></iframe>`;
  }

  const nav = episodes(c).map(n => n === ep ? `<b>${n}</b>` : `<a href="${prefix}/ep-${n}">${n}</a>`).join(' ');
  const body = `<p><a href="${prefix}/">← ${esc(seasonTitle(c, season))}</a></p>\n<h1>${esc(title)}</h1>\n${player}\n<p class="nav">Серии: ${nav}</p>
<script>
document.querySelectorAll('[data-embed]').forEach(b => b.addEventListener('click', () => {
  document.getElementById('player').src = b.dataset.embed;
  b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
}));
</script>`;
  return page({ title, body });
}

/* alpha: the stream is a plain <video src>; the dub is in the URL. */
export function renderEmbedAlpha(c, ep, dubSlug) {
  const dub = c.dubs.alpha.find(d => slug(d) === dubSlug);
  if (!dub) return null;
  return page({ title: `alpha · ${c.id} ${ep} ${dub}`, body:
    `<video id="v" controls src="/media/native.mp4" data-dub="${esc(dub)}"></video>` });
}

/* beta: the stream is in a script, the dubs are a select of its own. */
export function renderEmbedBeta(c, ep) {
  const dubs = c.dubs.beta.map(d => ({ id: slug(d), name: d, file: '/media/hls/index.m3u8' }));
  const options = dubs.map((d, i) => `<option value="${d.id}"${i ? '' : ' selected'}>${esc(d.name)}</option>`).join('\n');
  return page({ title: `beta · ${c.id} ${ep}`, body: `<select id="dub">\n${options}\n</select>
<video id="v" controls></video>
<script>
var player = { episode: ${ep}, file: "/media/hls/index.m3u8", dubs: ${JSON.stringify(dubs)} };
document.getElementById('dub').addEventListener('change', function () {
  player.file = player.dubs.find(function (d) { return d.id === this.value; }.bind(this)).file;
});
</script>` });
}
