/* ═══════════════════════════════════════════════════════════
   The session: how Lapka reaches the network.

     fetch(url, { referer, headers }) → { status, headers, body, url }

   Everything above this line asks the session; nothing above it
   knows whether the answer came with the user's cookies, through a
   driven browser, or plainly. Providers are added here, behind the
   same call. This is the plain one: an ordinary request with an
   ordinary browser's User-Agent.
   ═══════════════════════════════════════════════════════════ */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function createSession({ provider = 'plain', timeoutMs = 15000 } = {}) {
  if (provider !== 'plain') throw new Error(`session provider "${provider}" is not built yet`);

  async function get(url, { referer = null, headers = {} } = {}) {
    const h = { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'ru,en;q=0.8', ...headers };
    if (referer) h.referer = referer;
    const res = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    return {
      status: res.status,
      url: res.url,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.text(),
    };
  }

  return { provider, fetch: get };
}
