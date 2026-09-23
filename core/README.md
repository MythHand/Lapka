# core — the core of Lapka (Node)

Русская версия: [README.ru.md](README.ru.md)

One block per folder, one interface per block. The blocks know nothing of each
other's implementations, only the interfaces. The order of the folders is the
order of the pipeline: session → discovery → extractors → delivery → storage.

| Folder | Block | Interface | State |
|---|---|---|---|
| `catalog/` | The catalog: the model (a series with its season, kind and franchise in viewing order; episodes with the marks of openings), the merging of layers, the choice of source and dub, the snapshot on disk | `createSeries`, `merge(series, contribution)`, `pickDub`, `pickSource`, `toSnapshot`/`fromSnapshot` | ready, `test/catalog.test.mjs` |
| `session/` | The session: how Lapka goes to the network | `createSession({provider})` → `fetch(url, {referer, headers}) → {status, headers, body}`; cookie providers per browser `cookiesFor(domain)` | `plain` ready, browser cookies are a seam |
| `discover/` | Reading a page into a report: the series, the episodes, the players, the switches of dubs and players | `discover({html, url, profile}) → Report`, `toContribution(report)` | ready for the synthetic site's cases and for pages in the wild, `test/discover.test.mjs` |
| `extract/` | Extractors of embedded players, one file per player in `extract/players/` | `match(url)`, `extract(embedUrl, {referer}, session) → {streams, dubs, subs?}`; the registry `loadExtractors()` | `generic` (a video in an attribute, a stream in a script, a list of dubs in a script) and `kodik` (the request path and the encoding shift are read from the player's own script; links expire, `resolve` refreshes them; `unfold(embedUrl, ctx, session)` unfolds a serial embed into episodes × dubs, the source of each being the same embed opened on that episode; several seasons inside one embed are a seam) are ready. `cvh` (cdnvideohub: playlist and video through their API, HLS plus mp4 by quality; the site's wrapper `<video-player …>` is read by attributes) is ready. `aniboom` (HLS from the embed page's `data-parameters`) is ready. `streamtape` (the address glued from a script string) is ready. The generic extractor reads packed scripts (packer) and playlist answers, files without an extension by type/mime/itag: streamwish, mixdrop, mp4upload, zilla, Blogger. A serial's playlist inside the player's script (`seasons` → `episodes`, VenomPlayer/ortified) unfolds into episodes × dubs (`unfold`), the dubs being audio renditions of one HLS (`stream.audio`), the subtitles from `cc`. `test/hosters.test.mjs`. Alloha is a seam: the script is under javascript-obfuscator, a string decoder is needed. `test/extract.test.mjs`, `test/kodik.test.mjs`, `test/cvh.test.mjs` |
| `deliver/` | Delivering a stream to the browser: an HLS proxy that writes through into the cache, mp4 with Range, subtitles as WebVTT; `save.mjs` assembles an episode into an mp4 from the cache and keeps the line of saves: one job works, the rest wait, with pause, promotion, cancel, mp4 taken up by Range, and resume after a start | `createDelivery({session, cache})`: `register`, `/api/stream/<id>.m3u8`, `/<id>/seg?u=`, `/<id>.mp4`, `/<id>.vtt`; `createSaver()`: `start`, `promote`, `pause`, `pauseAll`, `cancel`, `cancelFor`, `resume` | ready; the place for a filter of baked-in ads is there, the filter is not made; `test/deliver.test.mjs`, `test/play.test.mjs`, `test/library.test.mjs` |
| `store/` | The Lapka folder: a cache per stream with a limit and eviction; the library as sidecars on disk; the state; `config.mjs` remembers the chosen folder in the system's settings place (`systemConfigDir()`, carried over once from the old `.dev/config.json`; `LAPKA_CONFIG` names the file), `POST /api/home?path=` creates and switches it on the fly | `openStore({home})` → `cache.*`; `openLibrary(home)` → `placeFor`, `keepSeries`, `list`, `remove`, `GET /api/library`, `/api/library/file`; `openState(own)` → positions, the dub choice, settings, the save records, `/api/state*` | ready; knowledge is a seam. Until the user chooses, the folder is `.dev/home` in the project (a clone, an archive) or `Lapka` in the home folder (a Lapka run from the npm cache: npx, a global install), `LAPKA_HOME` overrides |
| `knowledge/` | Site profiles as data: the shipped ones in `profiles/`, learned ones later in the Lapka folder | `loadProfiles()`, `profileFor(profiles, url)`; the fields `match`, `dub`, `series/episodes/players/dubs` selectors | the shipped ones ready (`profiles/aniliberty.top.json`); learned ones are a seam |
| `sites/` | Site adapters as code: a site with an API of its own is read through it **on top of** the general reading, never instead of it | `match(url)`, `look(url, session) → contribution + seriesUrl + start`; an optional `fetch(url, {referer}, session)`: how the site hands out its pages (a fragment by header, a JSON wrapper), the result is read by the general reading; the registry `loadSites()` | `aniliberty`, `yummyani`, `animego` ready; `test/sites.test.mjs`, `test/animego.test.mjs` on snapshots |
| `discover/` (switches labelled in attributes) | The element carrying an address may name the dub (`data-translation-title`, `data-dubbing`, `data-voice`…) and the player (`data-provider-title`…) in attributes rather than text; `data-src` is a player's address only on an iframe or a video, elsewhere it is a lazy image | `players[].dubLabel/playerLabel` | ready; `test/animego.test.mjs` |
| `discover/` (deferred players) | An element with request parameters instead of an address (DLE `xfplayer`, `data-params="mod=…-player&…"`) is a player of `kind: deferred`; the address is asked of `/engine/ajax/controller.php` when it is opened (`followDeferred` in `lapka.mjs`) | `players[].kind === 'deferred'` | ready; `test/deferred.test.mjs` on jut-su.net snapshots |
| `http/` | The routes of the local server, the loopback check and the `x-lapka` header on everything that changes the machine | `startServer({port, webDir, ctx})`; `/api/look`, `/api/look/live` (steps as events), `/api/resolve`, `/api/dubs`, `/api/stream/*`, `/api/save*`, `/api/saves*`, `/api/library*`, `/api/home*`, `/api/cache*`, `/api/state*`, `/api/update/*` | ready |
| `update.mjs` | Updating from the settings: the version and the repository from the package, GitHub asked only at the button, the folder pulled (a clone) or the release archive unpacked over it (a ZIP), then `npm install` and a start of the new Lapka by a detached shell, its output in the log beside the settings file | `checkUpdate()`, `runUpdate({tag, onStep})`, `restartAfterExit({port})`, `installKind()` | ready; the live run is seen only at the next release |

`lapka.mjs` is the orchestrator, the blocks put together. `look(url)` opens a
page through the session, reads it, climbs from an episode to the series page,
opens every embedded player with an extractor, merges all contributions into
the catalog and marks the health of the sources. `main.mjs` is the entry point
of `npm start`, the launchers and `npx`; a port already held is said, not thrown: another Lapka
there is handed the browser, another program means another port.

A "seam" means: the place and the contract are defined, the code is not there
yet. A folder appears together with its first code; there are no empty folders
or stubs in the repository.

Contribution, the common language of all blocks, is described in
`catalog/merge.mjs`.

The browser side lives in `web/`: `index.html` + `app.js` + `styles.css` +
`i18n.js` are the player, `inspect.html` the inspector, `play.html` a bare
playback page for tests. The player works off the catalog: the queue is the
episodes of a series, the track menu is the dubs, the stream comes from
`/api/resolve`, positions, the dub choice and the line of saves live on the
server. The interface speaks in two voices: system captions and controls in
the monospace, descriptions in the text face; the Lapka seal is drawn in
characters.
