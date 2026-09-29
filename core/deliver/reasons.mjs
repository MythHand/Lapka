/* Why a save broke off, as a code the page puts into words (save.err.* in
   the dictionaries): the server says no sentence of its own. A reason is
   { key, …parts }; a thrown error may carry one ready (err.reason), else
   it is read from what the error is. */

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
