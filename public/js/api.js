// Talks to the server. Keeps the sign-in tokens and quietly renews them.
const KEY = 'mystory.session';
let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* private mode */ }
let onSignedOut = () => {};
export const setOnSignedOut = (fn) => { onSignedOut = fn; };

export function setSession(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export const hasSession = () => !!session?.accessToken;

export class ApiError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

let refreshing = null;
async function refresh() {
  if (!session?.refreshToken) return false;
  refreshing ||= fetch('/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }),
  }).then(async (r) => { if (!r.ok) return false; setSession((await r.json()).session); return true; })
    .catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(method, url, body, { retried = false, token } = {}) {
  const headers = {};
  const t = token || session?.accessToken;
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, { method, headers, body: payload }); }
  catch { throw new ApiError('We can\'t reach the server. Please check your internet connection.', 0); }
  if (res.status === 401 && !retried && !token && session) {
    if (await refresh()) return api(method, url, body, { retried: true });
    setSession(null); onSignedOut();
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new ApiError(data?.error || 'Something went wrong. Please try again.', res.status, data?.details);
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b ?? {});
export const put = (u, b) => api('PUT', u, b ?? {});
export const patch = (u, b) => api('PATCH', u, b ?? {});
export const del = (u) => api('DELETE', u);
