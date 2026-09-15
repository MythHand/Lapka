# core — ядро Lapka (Node)

Один блок на папку, один интерфейс на блок. Блоки не знают реализаций друг друга,
только интерфейсы. Порядок папок это порядок конвейера из `docs/ARCHITECTURE.md`.

| Папка | Блок | Интерфейс | Состояние |
|---|---|---|---|
| `catalog/` | Каталог: модель (сериал с сезоном, видом и франшизой в порядке просмотра; серии с метками заставок), слияние слоёв, выбор источника и озвучки, снимок на диск | `createSeries`, `merge(series, contribution)`, `pickDub`, `pickSource`, `toSnapshot`/`fromSnapshot` | готов, `test/catalog.test.mjs` |
| `session/` | Сессия: как Lapka ходит в сеть | `createSession({provider})` → `fetch(url, {referer, headers}) → {status, headers, body}`; провайдеры кук по браузерам `cookiesFor(domain)` | `plain` готов, куки браузера — шов |
| `discover/` | Разбор страницы в отчёт: сериал, серии, плееры, переключатели озвучек и плееров | `discover({html, url, profile}) → Report`, `toContribution(report)` | готов для трёх случаев сайта и одной «дикой» страницы, `test/discover.test.mjs` |
| `extract/` | Экстракторы встроенных плееров, по файлу на плеер в `extract/players/` | `match(url)`, `extract(embedUrl, {referer}, session) → {streams, dubs}`; реестр `loadExtractors()` | `generic` (видео в атрибуте, поток в скрипте, список озвучек в скрипте) и `kodik` (путь запроса и сдвиг кодирования читаются из скрипта плеера; ссылки с истечением, `resolve` обновляет; `unfold(embedUrl, ctx, session)` разворачивает embed сериала в серии × озвучки, источник каждой — тот же embed, открытый на серии; несколько сезонов внутри одного embed — шов) готовы. `cvh` (cdnvideohub: плейлист и видео через их API, HLS плюс mp4 по качествам; обёртку сайта `<video-player …>` читает по атрибутам) готов. `aniboom` (HLS из `data-parameters` embed-страницы) готов. `streamtape` (адрес склеен строкой скрипта) готов. Общий экстрактор читает упакованные скрипты (packer) и ответ-плейлист, файлы без расширения по типу/mime/itag: streamwish, mixdrop, mp4upload, zilla, Blogger. `test/hosters.test.mjs`. Alloha — шов: скрипт под javascript-obfuscator, нужен декодер строк. `test/extract.test.mjs`, `test/kodik.test.mjs`, `test/cvh.test.mjs` |
| `deliver/` | Доставка потока в браузер: прокси HLS со сквозной записью в кэш, mp4 с Range; `save.mjs` собирает серию в mp4 из кэша | `createDelivery({session, cache})`: `register`, `/api/stream/<id>.m3u8`, `/<id>/seg?u=`, `/<id>.mp4`; `createSaver().start(streamId, ctx)` → job, `POST /api/save`, `GET /api/save/<job>` | готов; место под фильтр вшитой рекламы есть, фильтр не делается; `test/deliver.test.mjs`, `test/play.test.mjs`, `test/library.test.mjs` |
| `store/` | Папка Lapka: кэш по потокам с лимитом и вытеснением; библиотека как сайдкары на диске; состояние; `config.mjs` помнит выбранную папку в `.dev/config.json`, `POST /api/home?path=` создаёт и переключает её на ходу | `openStore({home})` → `cache.*`; `openLibrary(home)` → `placeFor`, `keepSeries`, `list`, `GET /api/library`, `/api/library/file`; `openState(own)` → позиции, выбор озвучки, настройки, `/api/state*` | готово; знание — шов. Папка на время разработки `.dev/home` в проекте или `LAPKA_HOME`, выбор папки придёт с UI |
| `knowledge/` | Профили сайтов как данные: поставляемые в `profiles/`, выученные позже в папке Lapka | `loadProfiles()`, `profileFor(profiles, url)`; поля `match`, `dub`, `series/episodes/players/dubs` селекторы | поставляемые готовы (`profiles/aniliberty.top.json`); выученные — шов |
| `sites/` | Адаптеры сайтов как код: сайт со своим API, читается через него **поверх** общего разбора, никогда вместо | `match(url)`, `look(url, session) → contribution + seriesUrl + start`; необязательный `fetch(url, {referer}, session)` — как сайт отдаёт свои страницы (фрагмент по заголовку, JSON-обёртка), читается результат общим разбором; реестр `loadSites()` | `aniliberty`, `yummyani`, `animego` готовы; `test/sites.test.mjs`, `test/animego.test.mjs` на снимках |
| `discover/` (переключатели с подписями в атрибутах) | Элемент-носитель адреса может называть озвучку (`data-translation-title`, `data-dubbing`, `data-voice`…) и плеер (`data-provider-title`…) атрибутами, а не текстом; `data-src` — адрес плеера только у iframe/video, у прочего это ленивая картинка | `players[].dubLabel/playerLabel` | готово; `test/animego.test.mjs` |
| `discover/` (отложенные плееры) | Элемент с параметрами запроса вместо адреса (DLE `xfplayer`, `data-params="mod=…-player&…"`) — плеер `kind: deferred`, адрес спрашивается у `/engine/ajax/controller.php` при открытии (`followDeferred` в `lapka.mjs`) | `players[].kind === 'deferred'` | готово; `test/deferred.test.mjs` на снимках jut-su.net |
| `http/` | Маршруты локального сервера, проверка loopback | `startServer({port, webDir, lapka})`; `/api/look?url=` | готов с одним маршрутом |

`lapka.mjs` — оркестратор: блоки, собранные в одно. `look(url)` открывает страницу через
сессию, читает её, с серии поднимается на страницу сериала, открывает каждый встроенный
плеер экстрактором, сливает все вклады в каталог и отмечает здоровье источников.
`main.mjs` — точка входа `npm start`.

«Шов» значит: место и контракт определены, кода ещё нет. Папка появляется вместе с первым
кодом, пустых папок и заглушек в репозитории нет.

Contribution, общий язык всех блоков, описан в `catalog/merge.mjs`.

Браузерная часть живёт в `web/`: `index.html` + `app.js` + `styles.css` + `i18n.js` это плеер,
`inspect.html` инспектор, `play.html` голая страница воспроизведения для тестов.
Плеер работает от каталога: очередь это серии сериала, меню дорожек это озвучки, поток
приходит с `/api/resolve`, позиции и выбор озвучки живут на сервере. Разметка и стили пока
унаследованные, переработка под Lapka — UI-фаза. В восьми языках, кроме русского и
английского, строки про ссылку стоят по-английски до UI-фазы.
