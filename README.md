# Local PIP Player <a href="https://mythhand.space/#gh-light-mode-only"><img src="assets/logo.svg" alt="MythHand" height="40" align="right"></a><a href="https://mythhand.space/#gh-dark-mode-only"><img src="assets/logo-white.svg" alt="MythHand" height="40" align="right"></a>

[![node ≥18](https://img.shields.io/badge/node-%E2%89%A518-3a3a3a?style=flat-square&labelColor=555)](https://nodejs.org/)
[![built with Claude Opus 5](https://img.shields.io/badge/built%20with-Claude%20Opus%205-3a3a3a?style=flat-square&labelColor=555)](https://www.anthropic.com/claude/opus)

A local browser player for watching in Picture-in-Picture.

The player is for watching a series in the browser’s Picture-in-Picture: a
window with no frames and no extra shell, pinned on the screen. Episodes play
one after another, the chosen dub and subtitles carry over to the next ones,
and episodes can be switched right from that window.

There is no library and no accounts. This is a local tool: MKV, AVI and the
rest are handled by a server on your own machine, nothing goes to the network.

The code is written with Claude Opus 5 in Claude Code. Idea, design and
hands-on testing: Dimbo.

Русская версия: [README.ru.md](README.ru.md)

![Main screen: the queue and the player](assets/play.png)

> MKV audio is usually AC-3 or DTS, which the browser will not decode: the
> picture plays, the sound is silent. Picking another track does not help
> either, Chrome has no way to switch the tracks of a local file. A local
> server running your own ffmpeg re-encodes just the track you picked and
> passes the video through untouched.

## Running it

Tested in Chrome. Extended Picture-in-Picture is built on the Document
Picture-in-Picture API, which Chrome has since version 116.

Without the local server: open `index.html` and drop files or a folder onto
the window. It plays what the browser can play on its own.

With the local server:

```bash
node server.mjs      # or npm start
```

Then open `http://127.0.0.1:8777`. Needs Node 18+ and `ffmpeg` with `ffprobe`
on `PATH`. macOS, Windows, Linux. `start.command` and `start.bat` start the
server and open the page on a double click, `start.sh` does the same from a
terminal.

| | without the local server | with the local server |
|---|---|---|
| MP4, MOV, WebM | plays | plays, the file is served as it is |
| MKV | picture; sound if the track is AAC, MP3, Opus, Vorbis or FLAC | video copied, sound re-encoded to AAC |
| HEVC | depends on the computer | re-encoded to H.264 |
| TS, FLV, MPG, WMV, AVI | does not open | remuxed or re-encoded |

Only with the local server: audio track choice, subtitles, the disk browser,
the queue coming back after a reload, the cache.

## Picture-in-Picture

- Browser mode: a window with no address bar, browser controls. Previous and
  next work through the Media Session API.
- Extended mode: the video goes into the floating window with the seek bar,
  episode switching, volume, audio track and subtitle pickers. The main window
  stays fully working: speed, repeat, auto-advance, the queue, the settings
  and fullscreen remain there. A change in one window shows in the other at
  once.
  - Hotkeys work inside the floating window too.
- In both modes the main window shows a placeholder with a “Bring it back”
  button where the video was. If the queue was closed, it opens in the main
  window while Picture-in-Picture is on, so episodes can be switched from
  there, and closes again once the floating window is closed.

> Removing the site address bar from the top of the window in extended mode
> did not work out: Chrome draws it itself. That is why browser mode is the
> default.

![Choosing the Picture-in-Picture mode](assets/pip-select.png)

## Sound and subtitles

- The track list shows language, studio name, codec, channel layout, bitrate
  and sample rate.
- The audio track choice survives switching files. It looks for the same set
  of tracks first, then a matching language and studio, then language alone.
- Text subtitles (SRT, ASS, SSA, WebVTT, mov_text) are converted to WebVTT and
  attached to the video. The browser understands only WebVTT and does not read
  subtitles inside an MKV at all, so the server extracts them.
- Image subtitles (PGS from Blu-ray, VOBSUB from DVD) are listed but cannot be
  picked. Each line in them is stored as a picture, it does not turn into
  text, and burning it into the frame means re-encoding the whole video.
- The subtitle choice survives the same way. Size, backing and height are
  adjustable.
- Track choice and subtitles work only with the local server.

![Choosing the audio track](assets/audio.png)

![Choosing subtitles](assets/sub.png)

## The local ffmpeg server

- One ffmpeg pass per file and track: the video is stream-copied, only the
  chosen audio track is re-encoded to AAC. The sound is downmixed to stereo:
  5.1 is not kept, there was nothing to test it on.
- The file is prepared whole in advance, not in pieces on the fly. Encoding in
  pieces joined the sound to the video anew on every seek, and the two drifted
  apart.
- The result is served with HTTP Range. Seeking is done by the browser, as
  with any ordinary file.
- The next file is prepared in the background, keeping the chosen audio track.
- The video is re-encoded only when the browser cannot decode its codec, that
  is when it is not H.264, VP8, VP9 or AV1. Encoding on the CPU takes every
  core for minutes, so a hardware encoder is used: videotoolbox on macOS,
  NVENC, Quick Sync or AMF on Windows, NVENC or Quick Sync on Linux. On
  failure the pass is repeated on libx264.
- Files the browser decodes on its own are served untouched. Prepared files
  sit in a cache and are evicted by least recent use. Files read in the last
  10 minutes are not evicted: the episode playing and the next one just
  prepared. They can take the cache over the limit for a while. An episode
  paused for longer than 10 minutes can be evicted if other files were
  prepared meanwhile.
- The browser does not give the path of a dropped file, so the server looks
  for it on disk by name and size, and takes the rest from the same folder.
  Folders where files were found before are checked first.

![Preparing a file with ffmpeg](assets/re-encoding.png)

## Playback and queue

- Adding: files, a folder, drag-and-drop, the disk browser. A picked or
  dropped folder is read with its subfolders; the disk browser adds the files
  of the open folder only.
- The disk browser has shortcuts on the left: Home, Downloads, Movies (Videos
  on Windows), Desktop and mounted drives. A folder passed to the server as an
  argument comes first.
- Sort by name, reverse, shuffle, change the order of files by hand.
- Two list views: rows and a grid. A row has a frame from the file in the
  video’s proportions, the name, duration, size and track count. The grid has
  frames only.
- The crosshair button in the queue header scrolls the list to the current
  file. When another file starts, the list scrolls to it by itself, which can
  be turned off in the settings.
- Auto-advance to the next file. Repeat of the queue or of one file. A summary
  card at the end.
- Speed from 0.5× to 2×. Seeking by mouse and keyboard, a time hint above the
  bar, a buffered marker.
- The watch position is remembered for each file. Within the first 30 seconds
  there is nothing to return to, and the last minute counts as a finished
  episode, so there is no return there. In the queue that place is marked by a
  thin line at the bottom of the file’s frame.
- The volume is remembered.
- With the local server, a page reload brings back the queue and marks the
  file you stopped on. It starts playing when you press play, otherwise just
  opening the tab would start ffmpeg. Without the server the queue does not
  come back: a dropped file has no path on disk to open it by again.

## Interface

- Ten languages, picked from the browser.
- Two typefaces.
- Hotkeys are bound to physical key codes and work in any keyboard layout.
- The control panel hides itself, the favicon shows the state.
- When room is short, next to the open queue for one, the control panel
  tightens: speed, repeat and auto-advance fold into a gear at the bottom
  right and open on hover, and the studio name on the audio track button gets
  shorter. With fewer than four letters left, only the icon stays on the
  button.
- Long file names and paths are cut on the right, and the tooltip on hover
  shows them whole.
- While the queue is empty it holds the project description, and its header
  shows the “About” title instead of the view and order buttons. If the queue
  is closed, the “About” button at the top left opens it. In a window narrower
  than 820 pixels the player starts with the queue closed.
- General player settings under the gear at the top right: the file panel
  overlays the video or shrinks it (in a window narrower than 820 pixels it
  always overlays), changing the order of files by hand, scrolling the queue
  to the current file, hiding the controls on auto-advance, typeface,
  language. Also there: the hotkey list and the server cache.
- The cache is one bar: the fill shows the space taken, the knob sets the
  limit, 24 GB by default. The bar ends where the room for the cache on the
  disk ends: the space it takes plus the free space. The limit does not go
  below 4 GB. If a saved limit no longer fits on the disk, the knob turns into
  a ring and a warning appears under the bar. The server learns the disk size
  on Node 18.15 and newer; on an older one the scale is built from the limit
  and the space taken. Clearing removes everything except the file playing,
  otherwise the next seek would hit a missing file.

![General player settings](assets/setting.png)

## Hotkeys

| | |
|---|---|
| `Space` `K` | play / pause |
| `←` `→` | ∓5 seconds |
| `Shift` + `←` `→` | ∓1 second |
| `J` `L` | ∓10 seconds |
| `↑` `↓` | volume |
| `0` … `9` | jump to 0 … 90 % |
| `Home` `End` | start / end |
| `B` `N` | previous / next file |
| `M` | mute |
| `P` | Picture-in-Picture |
| `F` | fullscreen |
| `Q` | show / hide the queue |
| `Esc` | close the menu, the extended PiP window or the queue |

Seek bar focused with `Tab`: `←` `→` by 5 seconds, `PageUp` `PageDown` by a
minute. Click on the picture: pause. Double click: fullscreen.

## Server options

```bash
PORT=9000 node server.mjs               # port, 8777 by default
PIP_CACHE=/path/to/dir node server.mjs  # cache folder, in the system temp folder by default
PIP_CACHE_GB=40 node server.mjs         # starting cache limit in GB, 24 by default
PIP_ENCODER=software node server.mjs    # no hardware encoding
node server.mjs /Volumes/Media          # one more folder the server may read
```

A limit set in the player is kept in the cache folder and after a restart wins
over `PIP_CACHE_GB`. The cache path is printed on startup.

## What the server reads

The server lists folders and hands out files, that is its job. So access to it
is limited:

- Listens on `127.0.0.1` only, other machines cannot reach it.
- Refuses requests with a foreign `Host` and requests made by other websites.
  Without this, any page open in the same browser could read your folders and
  files through the running server.
- Reads the home folder, `/Volumes`, `/media`, `/mnt`, `/run/media`, the
  drives on Windows and the folder passed as an argument. Other paths are
  refused.
- Opens media files only, video and audio. Other files in those folders are
  not served.
- Writes only to its cache.

## Project files

```
index.html      markup
styles.css      styles
app.js          the player
i18n.js         interface texts in ten languages
server.mjs      the local ffmpeg server
check.mjs       check of markup, styles and translations
test/           tests
package.json    npm commands: start, check, test
.gitattributes  line endings for the launchers
.github/        the bug report form and the test run on GitHub
assets/         README images, the logo, the mark and the avatar
assets/fonts/   typefaces and their licences
start.command   start, macOS
start.bat       start, Windows
start.sh        start, Linux
README.md       this description
README.ru.md    the description in Russian
LICENSE         the MIT licence
TRADEMARKS.md   the MythHand marks, not covered by MIT
```

## Checks

```bash
node check.mjs       # or npm run check
node --test          # or npm test
```

`check.mjs` checks the markup, styles and dictionaries without running them.
`node --test` runs the tests: the server over HTTP, the interface in headless
Chrome. The test media is generated by ffmpeg in a temporary folder, none of
your files is read. Needs Node 20+, ffmpeg and Chrome; without Chrome the
interface tests are skipped. The path to Chrome can be set with the `CHROME`
variable.

![Output of node --test](assets/tests.png)

## Typefaces and icons

| | |
|---|---|
| [Fixel Display](https://fixel.macpaw.com/) | SIL Open Font License 1.1, © 2023 MacPaw Inc. (Authors: Alfabravo + MacPaw) |
| [Inter](https://rsms.me/inter/) | SIL Open Font License 1.1, © 2020 The Inter Project Authors |
| [Phosphor Icons](https://phosphoricons.com/) | MIT |

## Author

[mythhand.space](https://mythhand.space/)

## License

MIT, see [LICENSE](LICENSE). The typefaces have their own licences, listed
above. The MythHand name, logo, mark and avatar are not covered by MIT: all
rights to them stay with MythHand, see [TRADEMARKS.md](TRADEMARKS.md).
