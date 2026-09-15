/* ═══════════════════════════════════════════════════════════
   Streamtape: the address of the file is written into the page in
   pieces, the last one cut by substring() a couple of times, and
   glued by a line of script. The line is read, not run.
   ═══════════════════════════════════════════════════════════ */

const HOSTS = /(^|\.)(streamtape\.(com|net|to|xyz|cc|site)|strtape\.\w+|stape\.\w+|streamta\.pe|tapecontent\.net|scloud\.online)$/i;

export function readLink(page) {
  const m = /getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*([^;]+);/.exec(String(page || ''));
  if (!m) return null;
  let link = '';
  for (const part of m[1].matchAll(/'((?:[^'\\]|\\.)*)'((?:\s*\.substring\(\d+\))*)/g)) {
    let s = part[1];
    for (const cut of part[2].matchAll(/substring\((\d+)\)/g)) s = s.slice(Number(cut[1]));
    link += s;
  }
  link = link.trim();
  if (!link) return null;
  return /^https?:/.test(link) ? link : 'https://' + link.replace(/^\/+/, '');
}

export default {
  name: 'streamtape',
  match: url => { try { return HOSTS.test(new URL(url).hostname); } catch { return false; } },

  async extract(embedUrl, { referer = null } = {}, session) {
    const res = await session.fetch(embedUrl, { referer });
    if (res.status >= 400) throw new Error(`embed answered ${res.status}`);
    const link = readLink(res.body);
    if (!link) throw new Error('no file on the embed page');
    const origin = new URL(res.url || embedUrl).origin;
    return { streams: [{ kind: 'mp4', url: link + (link.includes('&stream=') ? '' : '&stream=1'), quality: null, headers: { referer: origin + '/' } }], dubs: [] };
  },
};
