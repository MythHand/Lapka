# core — ядро Lapka (Node)

Один блок на папку, один интерфейс на блок. Блоки не знают реализаций друг друга,
только интерфейсы. Порядок папок это порядок конвейера из `docs/ARCHITECTURE.md`.

| Папка | Блок | Интерфейс | Состояние |
|---|---|---|---|
| `catalog/` | Каталог: модель (сериал с сезоном, видом и франшизой в порядке просмотра; серии с метками заставок), слияние слоёв, выбор источника и озвучки, снимок на диск | `createSeries`, `merge(series, contribution)`, `pickDub`, `pickSource`, `toSnapshot`/`fromSnapshot` | готов, `test/catalog.test.mjs` |
| `session/` | Сессия: как Lapka ходит в сеть | `createSession({provider})` → `fetch(url, {referer, headers}) → {status, headers, body}`; провайдеры кук по браузерам `cookiesFor(domain)` | `plain` готов, куки браузера — шов |
| `discover/` | Разбор страницы в отчёт: сериал, серии, плееры, переключатели озвучек и плееров | `discover({html, url, profile}) → Report`, `toContribution(report)` | готов для трёх случаев сайта и одной «дикой» страницы, `test/discover.test.mjs` |
| `extract/` | Экстракторы встроенных плееров, по файлу на плеер в `extract/players/` | `match(url)`, `extract(embedUrl, {referer}, session) → {streams, dubs}`; реестр `loadExtractors()` | `generic` (видео в атрибуте, поток в скрипте, список озвучек в скрипте) и `kodik` (путь запроса и сдвиг кодирования читаются из скрипта плеера; ссылки с истечением, `resolve` обновляет) готовы. `cvh` (cdnvideohub: плейлист и видео через их API, HLS плюс mp4 по качествам) готов. Alloha — шов: скрипт под javascript-obfuscator, нужен декодер строк. `test/extract.test.mjs`, `test/kodik.test.mjs`, `test/cvh.test.mjs` |
| `deliver/` | Доставка потока в браузер: прокси HLS со сквозной записью в кэш, mp4 с Range; `save.mjs` собирает серию в mp4 из кэша | `createDelivery({session, cache})`: `register`, `/api/stream/<id>.m3u8`, `/<id>/seg?u=`, `/<id>.mp4`; `createSaver().start(streamId, ctx)` → job, `POST /api/save`, `GET /api/save/<job>` | готов; место под фильтр вшитой рекламы есть, фильтр не делается; `test/deliver.test.mjs`, `test/play.test.mjs`, `test/library.test.mjs` |
| `store/` | Папка Lapka: кэш по потокам с лимитом и вытеснением; библиотека как сайдкары на диске; состояние; `config.mjs` помнит выбранную папку в `.dev/config.json`, `POST /api/home?path=` создаёт и переключает её на ходу | `openStore({home})` → `cache.*`; `openLibrary(home)` → `placeFor`, `keepSeries`, `list`, `GET /api/library`, `/api/library/file`; `openState(own)` → позиции, выбор озвучки, настройки, `/api/state*` | готово; знание — шов. Папка на время разработки `.dev/home` в проекте или `LAPKA_HOME`, выбор папки придёт с UI |
| `knowledge/` | Профили сайтов как данные: поставляемые в `profiles/`, выученные позже в папке Lapka | `loadProfiles()`, `profileFor(profiles, url)`; поля `match`, `dub`, `series/episodes/players/dubs` селекторы | поставляемые готовы (`profiles/aniliberty.top.json`); выученные — шов |
| `sites/` | Адаптеры сайтов как код: сайт со своим API, читается через него **поверх** общего разбора, никогда вместо | `match(url)`, `look(url, session) → contribution + seriesUrl + start`; реестр `loadSites()` | `aniliberty` и `yummyani` готовы; `test/sites.test.mjs` на снимках |
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
