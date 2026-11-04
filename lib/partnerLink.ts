// Partner links in the browser, shared by louiemae.com and /trade. Both run on the same
// origin, so they read and write the same saved code and visitor id: a visitor who arrives on
// the storefront through a partner link and later requests a quote on /trade is still credited,
// and the reverse. The server keeps the real 30-day window (holmClicks); this copy only
// remembers which code to send.
import { HOLM_PARTNERS, REF_CODE } from './holmPartners';

export const ATTRIBUTION_MS = HOLM_PARTNERS.attributionDays * 864e5;
const SITE = 'https://www.louiemae.com';

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
  return REF_CODE.test(code) ? code : '';
}

/** The partner code this browser arrived with in the last 30 days, if any. */
export function activeRef(now = Date.now()): StoredRef | null {
  const r = read<StoredRef | null>('ref', null);
  return r && normalizeCode(r.code) && now - r.at < ATTRIBUTION_MS ? r : null;
}

export function rememberRef(raw: string, ch: string, now = Date.now()) {
  const code = normalizeCode(raw);
  if (code) write('ref', { code, ch, at: now });
}

/** ?ref and ?ch from the address: in the query, or after the hash route (#shop?ref=…). */
function readParams(url: URL) {
  const hashQuery = url.hash.includes('?') ? new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1)) : null;
  const pick = (k: string) => url.searchParams.get(k) ?? hashQuery?.get(k) ?? null;
  return { ref: pick('ref'), ch: pick('ch'), hashQuery };
}

function stripParams(url: URL, hashQuery: URLSearchParams | null) {
  url.searchParams.delete('ref');
  url.searchParams.delete('ch');
  let hash = url.hash;
  if (hashQuery) {
    hashQuery.delete('ref');
    hashQuery.delete('ch');
    const rest = hashQuery.toString();
    hash = url.hash.slice(0, url.hash.indexOf('?')) + (rest ? '?' + rest : '');
  }
  try {
    window.history.replaceState(window.history.state, '', url.pathname + url.search + hash);
  } catch {
    /* some embedded browsers block history changes */
  }
}

/**
 * Reads a partner code from the address and reports the visit. The code is kept, and replaces
 * any code saved earlier, only once the server confirms it belongs to an active partner, so a
 * generic ?ref= tag (a newsletter, a directory) never overwrites a real partner's link. A
 * confirmed code is then taken out of the address bar so a copied URL doesn't pass it on.
 */
export async function captureRefFromUrl(
  record: (a: ClickArgs) => Promise<boolean | null | undefined | void>,
  target: string
): Promise<StoredRef | null> {
  const url = new URL(window.location.href);
  const { ref, ch: rawCh } = readParams(url);
  const code = normalizeCode(ref);
  if (!code) return null;
  const ch = (rawCh || 'link').toLowerCase().slice(0, 20);
  let confirmed = false;
  try {
    confirmed = (await record({ refCode: code, channel: ch, target: target.slice(0, 120), visitorId: visitorId() })) === true;
  } catch {
    return null;
  }
  if (!confirmed) return null;
  const now = Date.now();
  rememberRef(code, ch, now);
  // Re-read the address: the visitor may have moved on while the visit was being recorded.
  const current = new URL(window.location.href);
  const latest = readParams(current);
  if (normalizeCode(latest.ref) === code) stripParams(current, latest.hashQuery);
  return { code, ch, at: now };
}

/** Links people share always point at louiemae.com, even when copied from a preview or test copy. */
export function shareOrigin(): string {
  return /(^|\.)louiemae\.com$/.test(window.location.hostname) ? window.location.origin : SITE;
}

/** A link to one piece on /trade, carrying the partner's code when the sharer is a partner. */
export function pieceShareUrl(origin: string, pieceId: number | string, refCode?: string | null, ch = 'link'): string {
  const code = normalizeCode(refCode);
  return `${origin}/trade${code ? `?ref=${code}&ch=${encodeURIComponent(ch)}` : ''}#p/${pieceId}`;
}

/**
 * A partner link to any louiemae.com page. Takes a pasted louiemae.com address (or a path such
 * as "#collection/furniture") and adds the partner's code and channel. Returns null for an
 * address on another site, so a creator can't make a tracked link that leads elsewhere.
 */
export function partnerPageUrl(origin: string, page: string, refCode: string, ch = 'link'): string | null {
  const code = normalizeCode(refCode);
  if (!code) return null;
  const raw = (page || '').trim() || '/';
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : raw.startsWith('#') ? '/' + raw : raw, origin);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const own = new URL(origin).hostname.replace(/^www\./, '');
  if (!/^https?:$/.test(url.protocol) || (host !== 'louiemae.com' && host !== own)) return null;
  const out = new URL(url.pathname + url.search, origin);
  // A code after the hash would compete with this one, so drop it.
  const [hashPath, hashQuery] = url.hash.split('?');
  const hq = new URLSearchParams(hashQuery || '');
  hq.delete('ref');
  hq.delete('ch');
  out.hash = hashPath + (hq.toString() ? '?' + hq.toString() : '');
  out.searchParams.set('ref', code);
  out.searchParams.set('ch', ch);
  return out.toString();
}
