/* Both servers at once, for looking at the current state by hand:
   Lapka on 8800 and the synthetic anime site on 8801. */
import { build, haveFfmpeg } from '../test/fixtures.mjs';
import { startSite } from '../test/site/serve.mjs';
import { start } from '../core/main.mjs';

/* The synthetic site's clips are made with ffmpeg. Without it Lapka
   still starts; only the site is left out, and said so. */
const lapka = await start();
console.log(`Lapka:              ${lapka.base}`);
if (await haveFfmpeg()) {
  const fx = await build();
  const site = await startSite({ port: Number(process.env.SITE_PORT) || 8801, media: fx.show });
  console.log(`Синтетический сайт: ${site.base}`);
  console.log(`Инспектор:          ${lapka.base}/inspect.html?url=${encodeURIComponent(site.base + '/s/select/ep-1')}`);
} else {
  console.log('Синтетический сайт: пропущен, для его клипов нужен ffmpeg (brew install ffmpeg / apt install ffmpeg / winget install ffmpeg)');
}
