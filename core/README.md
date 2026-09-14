# core — ядро Lapka (Node)

Один блок на папку, один интерфейс на блок. Блоки не знают реализаций друг друга,
только интерфейсы. Порядок папок это порядок конвейера из `docs/ARCHITECTURE.md`.

| Папка | Блок | Интерфейс | Состояние |
|---|---|---|---|
| `catalog/` | Каталог: модель, слияние слоёв, выбор источника и озвучки, снимок на диск | `createSeries`, `merge(series, contribution)`, `pickDub`, `pickSource`, `toSnapshot`/`fromSnapshot` | готов, `test/catalog.test.mjs` |
| `session/` | Сессия: как Lapka ходит в сеть | `createSession({provider})` → `fetch(url, {referer, headers}) → {status, headers, body}`; провайдеры кук по браузерам `cookiesFor(domain)` | `plain` готов, куки браузера — шов |
| `discover/` | Разбор страницы в отчёт: сериал, серии, плееры, переключатели озвучек и плееров | `discover({html, url, profile}) → Report`, `toContribution(report)` | готов для трёх случаев сайта и одной «дикой» страницы, `test/discover.test.mjs` |
| `extract/` | Экстракторы встроенных плееров, по файлу на плеер в `extract/players/` | `match(url)`, `extract(embedUrl, context, session) → contribution` | шов |
| `deliver/` | Доставка потока в браузер: прокси HLS и mp4, ремукс через ffmpeg | `/api/stream/<id>` | шов |
| `store/` | Папка Lapka: библиотека и кэш как один файл с флагом `pinned`, состояние, знание | `openFolder(path)`, `place(file, {pinned})`, `state`, `knowledge` | шов |
| `knowledge/` | Профили сайтов, поставляемые и выученные; здоровье источников | профиль как данные, см. `docs/ARCHITECTURE.md` §4 и §8 | шов |
| `http/` | Маршруты локального сервера, проверка loopback | `startServer({port, webDir, lapka})`; `/api/look?url=` | готов с одним маршрутом |

`lapka.mjs` — оркестратор: блоки, собранные в одно. `look(url)` открывает страницу через
сессию, читает её, с серии поднимается на страницу сериала, сливает оба вклада в каталог.
`main.mjs` — точка входа `npm start`.

«Шов» значит: место и контракт определены, кода ещё нет. Папка появляется вместе с первым
кодом, пустых папок и заглушек в репозитории нет.

Contribution, общий язык всех блоков, описан в `catalog/merge.mjs`.

Браузерная часть живёт в `web/`. Пока там только `inspect.html` — инспектор (§8 архитектуры),
плеер появится при нарезке `app.js`.
