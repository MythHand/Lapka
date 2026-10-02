/* Why something refused, as a code the page puts into words: the server
   says no sentence of its own. A reason is { key, …parts }; an error
   thrown by Lapka's own code carries one ready (err.reason, made with
   refuse()), an error from elsewhere is read by what it is: the network,
   the disk, the folder's access; anything unforeseen keeps its text as a
   detail, shown for what it is. The page words the keys under save.err.*
   for a save and why.* for a look. */

/* an error with its reason on it: refuse('noLinks'), refuse('embedStatus', { status: 404 }) */
export const refuse = (key, parts = {}, text = key) => Object.assign(new Error(text), { reason: { key, ...parts } });

/* the source's answer, by its status: gone, refused, or another error */
export const originReason = status => ({
  key: status === 404 || status === 410 ? 'gone' : status === 401 || status === 403 ? 'denied' : 'origin',
  status,
});

const NETWORK = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);

export function reasonOf(e) {
  if (e && e.reason && e.reason.key) return e.reason;
  const code = e && (typeof e.code === 'string' ? e.code : e.cause && e.cause.code);
  if (code === 'ENOSPC') return { key: 'disk' };
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return { key: 'access' };
  if (NETWORK.has(code) || (e && (e.name === 'TimeoutError' || e.message === 'fetch failed'))) return { key: 'network' };
  return { key: 'other', detail: String((e && e.message) || e || '').slice(0, 200) };
}
