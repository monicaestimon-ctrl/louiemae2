// Partner links in the browser, shared by louiemae.com and /trade. Both run on the same
// origin, so they read and write the same saved code and visitor id: a visitor who arrives on
// the storefront through a partner link and later requests a quote on /trade is still credited,
// and the reverse. The server keeps the real 30-day window (holmClicks); this copy only
// remembers which code to send.

export const ATTRIBUTION_MS = 30 * 864e5;
const CODE = /^[A-Z0-9]{4,16}$/;

export type StoredRef = { code: string; ch: string; at: number };
export type ClickArgs = { refCode: string; channel: string; target: string; visitorId: string };

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('hol:' + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem('hol:' + key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: the visit still counts on the server */
  }
}

/** A random id for this browser, kept so the server can match a later order to the click. */
export function visitorId(): string {
  let v = read<string | null>('visitor', null);
  if (!v || !/^[\w-]{16,64}$/.test(v)) {
    v = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    write('visitor', v);
  }
  return v;
}

export function normalizeCode(raw: string | null | undefined): string {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE.test(code) ? code : '';
}

/** The partner code this browser arrived with in the last 30 days, if any. */
export function activeRef(now = Date.now()): StoredRef | null {
  const r = read<StoredRef | null>('ref', null);
  return r && normalizeCode(r.code) && now - r.at < ATTRIBUTION_MS ? r : null;
}

export function rememberRef(code: string, ch: string, now = Date.now()) {
  write('ref', { code, ch, at: now });
}

/**
 * Reads ?ref=CODE&ch=channel from the address, remembers the code, reports the visit, and
 * takes both parameters out of the address bar so a visitor who copies the URL doesn't pass
 * the partner's code on. Returns the code it found, if any.
 */
export function captureRefFromUrl(record: (a: ClickArgs) => unknown, target: string): StoredRef | null {
  const url = new URL(window.location.href);
  const had = url.searchParams.has('ref') || url.searchParams.has('ch');
  const code = normalizeCode(url.searchParams.get('ref'));
  const ch = (url.searchParams.get('ch') || 'link').toLowerCase().slice(0, 20);
  if (had) {
    url.searchParams.delete('ref');
    url.searchParams.delete('ch');
    try {
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch {
      /* some embedded browsers block history changes */
    }
  }
  if (!code) return null;
  const now = Date.now();
  rememberRef(code, ch, now);
  try {
    void Promise.resolve(record({ refCode: code, channel: ch, target: target.slice(0, 120), visitorId: visitorId() })).catch(() => {});
  } catch {
    /* the code is saved either way */
  }
  return { code, ch, at: now };
}

/** A link to one piece on /trade, carrying the partner's code when the sharer is a partner. */
export function pieceShareUrl(origin: string, pieceId: number | string, refCode?: string | null, ch = 'link'): string {
  const code = normalizeCode(refCode);
  return `${origin}/trade${code ? `?ref=${code}&ch=${encodeURIComponent(ch)}` : ''}#p/${pieceId}`;
}
