# The synthetic anime site

Русская версия: [README.ru.md](README.ru.md)

Lapka is developed against these pages, not against other people's sites.

- `cases.mjs` is the list of cases. One case per way a real site is built: how
  the episodes are listed, where the dub switch lives, how many players there
  are and how they are embedded. A new case appears only when a page turns up
  that the old ones do not cover.
- `render.mjs` is the HTML of the pages. Ordinary markup with no hints for
  Lapka: og tags, an h1, a list of links, a select, data attributes on the
  switches, an iframe.
- `serve.mjs` is the server. The pages are rendered on the fly, the video comes
  from ffmpeg fixtures.

To look at it with your own eyes:

```bash
node test/site/serve.mjs
```

`SITE_SLOW_MS=3000` before the command delays every video file by three
seconds: that is how pauses, the line and the cancelling of saves are tried by
hand.

`test/site.test.mjs` walks the whole site and checks that every link, embed and
stream the pages refer to answers. It guards against the cases and the
rendering drifting apart as they grow.
