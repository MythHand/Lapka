/* ═══════════════════════════════════════════════════════════
   Synthetic media for the tests.

   Everything the suite plays is generated here by ffmpeg into a
   temporary directory. Nothing under the user's own folders is ever
   read: a test that walks a real media library is a test that fails
   differently on every machine, and it has no business reading those
   files in the first place.

   Four fixtures: one per path through the server, and a long one.

     native.mp4    H.264 + AAC in MP4        served untouched
     release.mkv   H.264 + AC-3 in MKV,      remuxed, audio re-encoded,
                   two audio tracks and      subtitles extracted
                   one subtitle track
     legacy.avi    MPEG-4 + MP3 in AVI       video re-encoded
     long.mkv      the same as release.mkv,  long enough to test
                   three minutes of it       returning to a position
     hls/          six seconds of H.264+AAC  what a streaming site
                   as an HLS playlist with   serves; the synthetic
                   three segments            site in test/site plays it

   The clips are two seconds of a test pattern, a few dozen kilobytes
   each. They are built once and reused: rebuilding costs seconds.
   ═══════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

/* With a timeout, because ffmpeg can sit forever on a bad combination
   of flags and a fixture that never finishes would hang the whole run
   with nothing to show for it. */
const run = (cmd, args) => new Promise((ok, bad) =>
  execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 60000 },
    (e, out, err) => e ? bad(new Error(String(err || e.message).slice(-800))) : ok(out)));

export async function haveFfmpeg() {
  try { await run('ffprobe', ['-version']); return true; } catch { return false; }
}

const SRT = [
  '1', '00:00:00,200 --> 00:00:01,000', 'first line', '',
  '2', '00:00:01,200 --> 00:00:02,000', 'second line', '',
].join('\n');

/* The long fixture needs subtitles that run its whole length. With
   -shortest in the command, an input that ends early ends the output
   with it: the two second track above truncated a ninety second file
   down to two seconds, and the test then failed on a duration that had
   nothing to do with the player. */
const SRT_LONG = [
  '1', '00:00:00,200 --> 00:00:04,000', 'first line', '',
  '2', '00:01:00,000 --> 00:01:04,000', 'middle line', '',
  '3', '00:02:55,000 --> 00:02:59,500', 'last line', '',
].join('\n');

/* -shortest keeps audio and video the same length; without it the sine
   runs on and the durations stop matching between fixtures. */
const src = d => ['-f', 'lavfi', '-i', `testsrc=size=320x180:rate=10:duration=${d}`];
const tone = (f, d) => ['-f', 'lavfi', '-i', `sine=frequency=${f}:duration=${d}`];
const SRC = src(2);
const TONE = f => tone(f, 2);

export async function build() {
  const dir = path.join(os.tmpdir(), 'pip-player-test-media');
  const show = path.join(dir, 'Show', 'S01');
  await fsp.mkdir(show, { recursive: true });

  const at = n => path.join(show, n);
  const made = {
    dir, show,
    native: at('native.mp4'),
    release: at('release.mkv'),
    legacy: at('legacy.avi'),
    long: at('long.mkv'),
    subs: at('lines.srt'),
    subsLong: at('lines-long.srt'),
    hls: at('hls'),
    hlsIndex: at(path.join('hls', 'index.m3u8')),
    hlsAudio: at(path.join('hls-audio', 'master.m3u8')),
  };

  /* already built by an earlier run */
  if ([made.native, made.release, made.legacy, made.long, made.hlsIndex, made.hlsAudio].every(f => fs.existsSync(f)))
    return made;

  /* Nothing is written into place directly. The suites that need media
     run as separate processes at the same time, and on a fresh machine
     (or after the system has cleared its temporary folder) each of them
     finds the fixtures missing and builds them. Written straight into
     the shared folder, two ffmpeg runs wrote the same file at once and
     left a broken MP4 that every later run accepted as ready. So each
     run builds in a folder of its own and then moves the finished files
     over: a rename is atomic, so whichever run lands last, the file in
     place is always a whole one. */
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'pip-player-test-build-'));
  const w = n => path.join(work, n);
  try {
    await fsp.writeFile(w('lines.srt'), SRT, 'utf8');
    await fsp.writeFile(w('lines-long.srt'), SRT_LONG, 'utf8');

    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...SRC, ...TONE(440),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      '-movflags', '+faststart', w('native.mp4')]);

    /* Two audio tracks with language and title, so that the track list,
       the carry-over between files and the studio names all have
       something real to work on. */
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...SRC, ...TONE(440), ...TONE(660), '-i', w('lines.srt'),
      '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'ac3', '-c:s', 'srt', '-shortest',
      '-metadata:s:a:0', 'language=rus', '-metadata:s:a:0', 'title=Studio One',
      '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=Original',
      '-metadata:s:s:0', 'language=eng',
      w('release.mkv')]);

    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...SRC, ...TONE(440),
      '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-shortest',
      w('legacy.avi')]);

    /* Three minutes. Returning to a saved position only happens past the
       thirtieth second and no closer than a minute to the end, so at
       ninety seconds the window between those two rules is empty and
       nothing can ever be resumed. At a hundred and eighty it is wide,
       and a position of sixty seconds sits comfortably inside it.

       Kept small on purpose: the browser has to download the whole thing
       during the test, so the picture is coarse and the sound is thin.

       Built in two passes on purpose. With the subtitle file as a fourth
       input and -shortest in the same command, ffmpeg sat there and never
       finished. So: encode the picture and the sound, then mux the
       subtitles in by copying. */
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...src(180), ...tone(440, 180), ...tone(660, 180),
      '-map', '0:v', '-map', '1:a', '-map', '2:a',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p',
      '-c:a', 'ac3', '-b:a', '96k', '-shortest',
      '-metadata:s:a:0', 'language=rus', '-metadata:s:a:0', 'title=Studio One',
      '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=Original',
      w('long.novtt.mkv')]);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', w('long.novtt.mkv'), '-i', w('lines-long.srt'),
      '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'srt',
      '-metadata:s:s:0', 'language=eng',
      w('long.mkv')]);

    /* Six seconds in two-second segments: a playlist with more than
       one segment is the difference between "served the file" and
       "followed the playlist". */
    await fsp.mkdir(w('hls'));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...src(6), ...tone(440, 6),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      /* a segment can only start on a keyframe; x264's default is one
         every 250 frames, which at 10 fps is one keyframe in the whole
         clip and therefore one segment */
      '-g', '20', '-keyint_min', '20', '-sc_threshold', '0',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
      '-hls_segment_filename', w(path.join('hls', 'seg%02d.ts')),
      w(path.join('hls', 'index.m3u8'))]);

    /* The same clip with its sound as renditions of their own: a master
       with one video variant and an audio group of two languages, the
       way aggregators serve several dubs in one stream. */
    await fsp.mkdir(w('hls-audio'));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      ...src(6), ...tone(440, 6), ...tone(660, 6),
      '-map', '0:v', '-map', '1:a', '-map', '2:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      '-g', '20', '-keyint_min', '20', '-sc_threshold', '0',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
      '-var_stream_map', 'a:0,agroup:aud,language:rus,default:yes a:1,agroup:aud,language:eng v:0,agroup:aud',
      '-master_pl_name', 'master.m3u8',
      '-hls_segment_filename', w(path.join('hls-audio', 's%v-%02d.ts')),
      w(path.join('hls-audio', 'v%v.m3u8'))]);

    /* On Windows a file another run already has open cannot be replaced;
       that one is whole too, so it stays. The hls folder is moved as one
       piece for the same reason the files are: a half-moved folder is a
       playlist pointing at segments that are not there yet. */
    for (const n of ['lines.srt', 'lines-long.srt', 'native.mp4', 'release.mkv', 'legacy.avi', 'long.mkv', 'hls', 'hls-audio'])
      await fsp.rename(w(n), at(n)).catch(e => { if (!fs.existsSync(at(n))) throw e; });
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }

  return made;
}

export async function wipe() {
  await fsp.rm(path.join(os.tmpdir(), 'pip-player-test-media'), { recursive: true, force: true });
}
