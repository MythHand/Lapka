/* ═══════════════════════════════════════════════════════════
   The library and the state.

   A stream of the synthetic site is saved through Lapka: the HLS one
   from segments that are partly in the cache already, the mp4 one
   whole. What is guarded: the file is one playable MP4 of the right
   length, the sidecar and the series snapshot are beside it with
   human names, the cache folder is gone afterwards, the library lists
   it back, the file is served by byte range and only from inside the
   folder, and the state remembers positions and the dub choice across
   a restart.
   ═══════════════════════════════════════════════════════════ */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { build, haveFfmpeg } from './fixtures.mjs';
import { startSite } from './site/serve.mjs';
import { start } from '../core/main.mjs';
import { openState } from '../core/store/state.mjs';
import { fileNameFor, safeName } from '../core/store/library.mjs';

const ffmpeg = await haveFfmpeg();
let site, lapka, home, movedWrap, sideWrap;
const get = (p, headers = {}) => fetch(lapka.base + p, { headers });
const post = p => fetch(lapka.base + p, { method: 'POST', headers: { 'x-lapka': '1' } });
const duration = file => new Promise((ok, bad) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (e, out) => e ? bad(e) : ok(Number(out))));

before(async () => {
  if (!ffmpeg) return;
  const fx = await build();
  site = await startSite({ media: fx.show });
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-home-'));
  lapka = await start({ port: 0, home });
});
after(async () => {
  if (lapka) await lapka.close();
  if (site) await site.close();
  if (home) await fsp.rm(home, { recursive: true, force: true });
  if (movedWrap) await fsp.rm(movedWrap, { recursive: true, force: true });
  if (sideWrap) await fsp.rm(sideWrap, { recursive: true, force: true });
});

describe('names', () => {
  test('a file name a person and a file system accept', () => {
    assert.equal(safeName('Ван-Пис: Начало / Конец?'), 'Ван-Пис· Начало · Конец·');
    assert.equal(fileNameFor({}, { number: 3, title: 'Возвращение' }, { name: 'AniLibria' }), '03 · Возвращение [AniLibria].mp4');
    assert.equal(fileNameFor({}, { number: 12, title: '' }, { name: 'Dream Cast' }), '12 [Dream Cast].mp4');
  });
});

describe('saving', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  let hls, mp4, seriesId;

  test('an HLS stream becomes one MP4 in the series folder', async () => {
    const r = await (await get(`/api/look?url=${encodeURIComponent(site.base + '/s/select/ep-1')}`)).json();
    seriesId = r.series.id;
    const al = r.series.episodes.find(e => e.number === 1).dubs.find(d => d.key === 'anilibria');
    hls = al.sources.find(s => s.player === 'embed/beta').streams[0];
    mp4 = al.sources.find(s => s.player === 'embed/alpha').streams[0];
    /* one segment watched already */
    const pl = await (await get(hls.play)).text();
    await get(pl.split('\n').find(l => l && !l.startsWith('#')));

    const started = await post(`/api/save?stream=${hls.id}`);
    assert.equal(started.status, 202);
    let job = await started.json();
    for (let i = 0; i < 200 && job.state === 'working'; i++) { await new Promise(r => setTimeout(r, 100)); job = await (await get(`/api/save/${job.id}`)).json(); }
    assert.equal(job.state, 'done', job.error);
    assert.equal(path.basename(job.file), '01 [AniLibria].mp4');
    assert.equal(path.basename(path.dirname(job.file)), 'Сериал Селект');
    const d = await duration(job.file);
    assert.ok(d > 5.5 && d < 6.5, `duration ${d}`);
    /* the sidecar and the snapshot are beside it */
    const side = JSON.parse(await fsp.readFile(job.file.replace(/\.mp4$/, '.json'), 'utf8'));
    assert.equal(side.seriesId, seriesId);
    assert.equal(side.episode, 1);
    assert.equal(side.dubKey, 'anilibria');
    assert.equal(side.player, 'embed/beta');
    assert.equal(side.file, '01 [AniLibria].mp4');
    const snap = JSON.parse(await fsp.readFile(path.join(path.dirname(job.file), 'series.json'), 'utf8'));
    assert.equal(snap.id, seriesId);
    assert.equal(snap.episodes.length, 4);
    /* the cache folder for the stream is gone: the bytes are the file now */
    await assert.rejects(fsp.stat(lapka.store.cache.dirFor(hls.id)));
  });

  test('an mp4 stream is fetched whole', async () => {
    let job = await (await post(`/api/save?stream=${mp4.id}`)).json();
    for (let i = 0; i < 200 && job.state === 'working'; i++) { await new Promise(r => setTimeout(r, 100)); job = await (await get(`/api/save/${job.id}`)).json(); }
    assert.equal(job.state, 'done', job.error);
    const whole = Buffer.from(await (await fetch(site.base + '/media/native.mp4')).arrayBuffer());
    assert.equal(job.size, whole.length);
    /* same dub, other player: it is the same file name, so the second save replaced the first */
    assert.equal(path.basename(job.file), '01 [AniLibria].mp4');
  });

  test('the library lists what is on disk and serves it by range', async () => {
    const lib = await (await get('/api/library')).json();
    assert.equal(lib.home, home);
    assert.equal(lib.series.length, 1);
    assert.equal(lib.series[0].title, 'Сериал Селект');
    assert.deepEqual(lib.series[0].episodes.map(e => [e.episode, e.dub]), [[1, 'AniLibria']]);
    const file = lib.series[0].episodes[0].path;
    const r = await get(`/api/library/file?path=${encodeURIComponent(file)}`, { range: 'bytes=0-9' });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 10);
    /* nothing outside the folder, nothing that is not an mp4 */
    assert.equal((await get(`/api/library/file?path=${encodeURIComponent(path.join(home, '..', 'x.mp4'))}`)).status, 403);
    assert.equal((await get(`/api/library/file?path=${encodeURIComponent(file.replace(/\.mp4$/, '.json'))}`)).status, 403);
    assert.equal((await get(`/api/library/file?path=${encodeURIComponent(path.join(home, 'nope.mp4'))}`)).status, 404);
  });

  test('saving needs the header and a stream that was looked at', async () => {
    assert.equal((await fetch(lapka.base + `/api/save?stream=${mp4.id}`, { method: 'POST' })).status, 403);
    assert.equal((await post('/api/save?stream=0000000000000000')).status, 404);
  });
});

describe('the state', () => {
  test('positions and the dub choice survive a restart', async () => {
    const own = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-state-'));
    const a = await openState(own);
    a.setPosition('s1', 3, 'anilibria', 754.5, 1440);
    a.setPosition('s1', 4, 'anilibria', 12);
    a.setDub('s1', 'anilibria');
    a.setWatched('s1', 2);
    a.setSetting('cacheGb', 40);
    assert.equal(a.position('s1', 3, 'anilibria'), 754.5);
    assert.equal(a.watched('s1', 2), true);
    await a.close();
    const b = await openState(own);
    assert.equal(b.position('s1', 3, 'anilibria'), 754.5);
    assert.equal(b.get().positions['s1/3/anilibria'].d, 1440);
    assert.equal(b.position('s1', 4, 'anilibria'), 12);
    assert.equal(b.position('s1', 5, 'anilibria'), null);
    assert.equal(b.dub('s1'), 'anilibria');
    assert.equal(b.watched('s1', 2), true);
    assert.equal(b.watched('s1', 3), false);
    b.setWatched('s1', 2, false);
    assert.equal(b.watched('s1', 2), false);
    assert.equal(b.setting('cacheGb'), 40);
    b.setPosition('s1', 3, 'anilibria', null);
    assert.equal(b.position('s1', 3, 'anilibria'), null);
    await b.close();
    await fsp.rm(own, { recursive: true, force: true });
  });

  test('the routes write it', async () => {
    assert.equal((await post('/api/state/position?series=s9&episode=2&dub=jam&t=33&d=1400')).status, 200);
    assert.equal((await post('/api/state/dub?series=s9&dub=jam')).status, 200);
    assert.equal((await post('/api/state/watched?series=s9&episode=1')).status, 200);
    const st = await (await get('/api/state')).json();
    assert.equal(st.positions['s9/2/jam'].t, 33);
    assert.equal(st.positions['s9/2/jam'].d, 1400);
    assert.ok(st.watched['s9/1'].at > 0);
    assert.equal(st.dubs.s9, 'jam');
    assert.equal((await fetch(lapka.base + '/api/state/dub?series=s9&dub=x', { method: 'POST' })).status, 403);
  });
});

/* ── the look told as it goes ── */
describe('the live look', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  test('a stream of steps, then the answer', async () => {
    const r = await get(`/api/look/live?url=${encodeURIComponent(site.base + '/s/select/ep-1')}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const text = await r.text();
    const events = text.split('\n\n').filter(Boolean).map(chunk => { const m = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(chunk); return m && { event: m[1], data: JSON.parse(m[2]) }; }).filter(Boolean);
    const steps = events.filter(e => e.event === 'step' && typeof e.data === 'string').map(e => e.data);
    const phases = events.filter(e => e.event === 'step' && typeof e.data === 'object').map(e => e.data.phase);
    assert.deepEqual(phases, ['page', 'players'], 'the phases are told apart from the lines');
    assert.ok(steps.length >= 3, `steps: ${steps.join(' | ')}`);
    assert.match(steps[0], /^Читаю страницу/);
    assert.ok(steps.some(s => /плеер/.test(s)), 'the players are told');
    const done = events.at(-1);
    assert.equal(done.event, 'done');
    assert.equal(done.data.series.episodes.length, 4);
    assert.equal((await get('/api/look/live?url=nope')).status, 400);
  });
});

/* ── the folder weighed and cleared, the notes forgotten ── */
describe('clearing the folder', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  test('the home answer weighs the folder without the cache and counts the files and the notes', async () => {
    await lapka.state.flush();          // what earlier tests changed lands on disk before the two weighings
    const h = await (await get('/api/home')).json();
    assert.ok(h.files >= 1, `files ${h.files}`);
    assert.ok(h.bytes > 0, 'the saved files weigh something');
    assert.ok(h.filesBytes > 0 && h.filesBytes <= h.bytes, 'the files weigh part of the folder');
    assert.ok(h.notesBytes >= 0 && h.filesBytes + h.notesBytes <= h.bytes, 'the files and the notes are part of the folder, with the covers and the sidecars');
    const cacheBytes = h.cache.bytes;
    const disk = await weighDir(home, path.join(home, '.lapka', 'cache'));
    assert.equal(h.bytes, disk, 'the weight is the folder without the cache');
    assert.ok(cacheBytes >= 0);
    assert.equal((await post('/api/state/position?series=w1&episode=1&dub=x&t=40&d=100')).status, 200);
    assert.equal((await post('/api/state/watched?series=w1&episode=2')).status, 200);
    assert.ok((await (await get('/api/home')).json()).notes >= 2, 'the notes are counted');
  });
  test('forgetting drops positions, watched marks and dub choices, keeps the settings and the files', async () => {
    assert.equal((await post('/api/state/setting?k=autoResume&v=on')).status, 200);
    const filesBefore = (await (await get('/api/home')).json()).files;
    assert.equal((await post('/api/state/forget')).status, 200);
    const st = await (await get('/api/state')).json();
    assert.deepEqual([st.positions, st.watched, st.dubs], [{}, {}, {}]);
    assert.equal(st.settings.autoResume, 'on');
    const h = await (await get('/api/home')).json();
    assert.equal(h.notes, 0);
    assert.equal(h.files, filesBefore, 'the files stay');
    await fsp.access(path.join(home, '.lapka', 'knowledge'));
  });
  test('clearing the saved files empties the library and leaves the cache and the state', async () => {
    /* a record of a save cut short, as if from an earlier run: it goes with the files */
    lapka.state.setSave('gone/1/x', { seriesUrl: site.base + '/s/nope/', seriesId: 'gone', episode: 1, dubKey: 'x', quality: 'auto' });
    const r = await (await post('/api/library/clear')).json();
    assert.ok(r.removed >= 1 && r.series >= 1, `removed ${r.removed} in ${r.series}`);
    const lib = await (await get('/api/library')).json();
    assert.equal(lib.series.length, 0);
    assert.equal(Object.keys(lapka.state.saves()).length, 0, 'the save records are gone');
    const h = await (await get('/api/home')).json();
    assert.equal(h.files, 0);
    await lapka.state.flush();
    await fsp.access(path.join(home, '.lapka', 'state.json'), undefined);
    /* the moving test below needs something to move: one series is saved again */
    const look = await (await get(`/api/look?url=${encodeURIComponent(site.base + '/s/select/ep-1')}`)).json();
    const al = look.series.episodes.find(e => e.number === 1).dubs.find(d => d.key === 'anilibria');
    const hls = al.sources.find(s => s.player === 'embed/beta').streams[0];
    let job = await (await post(`/api/save?stream=${hls.id}`)).json();
    for (let i = 0; i < 600 && (job.state === 'working' || job.state === 'queued'); i++) { await new Promise(r => setTimeout(r, 100)); job = await (await get(`/api/save/${job.id}`)).json(); }
    assert.equal(job.state, 'done', job.error);
    assert.ok((await (await get('/api/library')).json()).series.length >= 1, 'saved again');
  });
});

async function weighDir(dir, skip) {
  let bytes = 0;
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (p === skip) continue;
    if (d.isDirectory()) bytes += await weighDir(p, skip);
    else bytes += (await fsp.stat(p)).size;
  }
  return bytes;
}

/* ── the folder moves with its files ── */
describe('moving the folder', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  test('the series folders and Lapka\'s own things go along, the old folder is emptied and removed', async () => {
    const before = await (await get('/api/library')).json();
    assert.ok(before.series.length >= 1, 'something to move');
    const other = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-moved-')), 'Lapka');
    movedWrap = path.dirname(other);
    const r = await (await post(`/api/home?path=${encodeURIComponent(other)}&move=1`)).json();
    assert.equal(r.home, other);
    assert.ok(r.moved >= 2, `moved ${r.moved}`);
    const after = await (await get('/api/library')).json();
    assert.equal(after.home, other);
    assert.deepEqual(after.series.map(s => s.title), before.series.map(s => s.title));
    await assert.rejects(fsp.stat(home), 'the old folder is gone');
    await fsp.access(path.join(other, '.lapka', 'state.json'));
    /* one folder inside the other is refused */
    assert.equal((await post(`/api/home?path=${encodeURIComponent(path.join(other, 'inner'))}&move=1`)).status, 400);
    home = other;
  });
  test('a folder pointed at gets a Lapka folder inside, unless it is named Lapka', async () => {
    sideWrap = await fsp.mkdtemp(path.join(os.tmpdir(), 'lapka-side-'));
    /* a folder of the user's own: Lapka keeps to a folder of its own inside it */
    const stuff = path.join(sideWrap, 'Stuff');
    let r = await (await post(`/api/home?path=${encodeURIComponent(stuff)}`)).json();
    assert.equal(r.home, path.join(stuff, 'Lapka'));
    await fsp.access(path.join(stuff, 'Lapka', '.lapka'));
    /* pointed at again, now that it holds Lapka's things, it is taken as it is */
    r = await (await post(`/api/home?path=${encodeURIComponent(path.join(stuff, 'Lapka'))}`)).json();
    assert.equal(r.home, path.join(stuff, 'Lapka'));
    /* the name is the sign: a folder named otherwise gets a Lapka inside even when it holds Lapka's things */
    const odd = path.join(sideWrap, 'Odd');
    await fsp.mkdir(path.join(odd, '.lapka'), { recursive: true });
    r = await (await post(`/api/home?path=${encodeURIComponent(odd)}`)).json();
    assert.equal(r.home, path.join(odd, 'Lapka'));
    /* back to a folder named Lapka, as the tests after this one expect */
    r = await (await post(`/api/home?path=${encodeURIComponent(home)}`)).json();
    assert.equal(r.home, home);
  });
});

/* ── saves that were cut short are taken up again ── */
describe('resuming saves', { skip: !ffmpeg && 'ffmpeg not installed' }, () => {
  test('a pending record becomes a file, and goes; the routes list and forget', async () => {
    const r = await (await get(`/api/look?url=${encodeURIComponent(site.base + '/s/links/ep-3')}`)).json();
    const ep = r.series.episodes.find(e => e.number === 3);
    const dub = ep.dubs.find(d => d.key === 'anidub');
    /* as if a save had been asked for and the program had stopped halfway */
    lapka.state.setSave(`${r.series.id}/3/anidub`, { seriesUrl: r.series.sourceUrl, seriesId: r.series.id, episode: 3, dubKey: 'anidub', quality: 'auto', phase: 'fetch', done: 1, total: 3 });
    await lapka.state.flush();
    const listed = await (await get('/api/saves')).json();
    assert.ok(listed.pending[`${r.series.id}/3/anidub`], 'listed as pending');
    const out = await lapka.saver.resume(lapka.lapka);
    assert.deepEqual(out.map(x => x.state), ['done']);
    const lib = await (await get('/api/library')).json();
    assert.ok(lib.series.some(s => s.episodes.some(e => e.episode === 3 && e.dubKey === 'anidub')), 'the file is there');
    assert.equal(Object.keys((await (await get('/api/saves')).json()).pending).length, 0, 'the record is gone');
    /* a record that cannot be resumed says why and stays; forgetting drops it */
    lapka.state.setSave('nope/1/x', { seriesUrl: site.base + '/s/nope/', seriesId: 'nope', episode: 1, dubKey: 'x', quality: 'auto' });
    const out2 = await lapka.saver.resume(lapka.lapka);
    assert.equal(out2[0].state, 'error');
    assert.ok((await (await get('/api/saves')).json()).pending['nope/1/x'].error);
    assert.equal((await post('/api/saves/forget?key=nope/1/x')).status, 200);
    assert.equal(Object.keys((await (await get('/api/saves')).json()).pending).length, 0);
    /* a setting through its route */
    assert.equal((await post('/api/state/setting?k=autoResume&v=off')).status, 200);
    assert.equal((await (await get('/api/state')).json()).settings.autoResume, 'off');
    assert.equal((await post('/api/state/setting?k=bad%20key&v=1')).status, 400);
  });
});
