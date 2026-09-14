/* Both servers at once, for looking at the current state by hand:
   Lapka on 8800 and the synthetic anime site on 8801. */
import { build } from '../test/fixtures.mjs';
import { startSite } from '../test/site/serve.mjs';
import { start } from '../core/main.mjs';

const fx = await build();
const site = await startSite({ port: Number(process.env.SITE_PORT) || 8801, media: fx.show });
const lapka = await start();
console.log(`Lapka:              ${lapka.base}`);
console.log(`Синтетический сайт: ${site.base}`);
console.log(`Инспектор:          ${lapka.base}/inspect.html?url=${encodeURIComponent(site.base + '/s/select/ep-1')}`);
