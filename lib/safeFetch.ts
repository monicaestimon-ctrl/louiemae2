// Server-side fetching of supplier URLs with SSRF protection (spec S14, S38, v2 §21): only
// allowlisted hosts over https, every redirect re-checked, private addresses refused, and size
// and time limits enforced.

export const SUPPLIER_MEDIA_HOSTS = ['zuomod.com', 'www.zuomod.com', 'cdn.shopify.com', 'ashcroftimports.com', 'www.ashcroftimports.com', 'cjdropshipping.com'];

const PRIVATE = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^\[?::1\]?$/, /^\[?f[cd][0-9a-f]{2}:/i, /^\[?fe80:/i, /\.internal$/i, /\.local$/i];

export function hostAllowed(url: string, allow: readonly string[] = SUPPLIER_MEDIA_HOSTS): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  if (PRIVATE.some((re) => re.test(host)) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return allow.some((h) => host === h || host.endsWith('.' + h));
}

export type SafeFetchResult = { ok: true; bytes: Uint8Array; contentType: string; finalUrl: string } | { ok: false; reason: string };

/** Fetches with manual redirects (each target re-checked), a byte cap and a timeout. */
export async function safeFetch(url: string, opts: { allow?: readonly string[]; maxBytes?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  const f = opts.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!hostAllowed(current, opts.allow)) return { ok: false, reason: `host not allowed: ${safeHost(current)}` };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await f(current, { redirect: 'manual', signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, reason: `fetch failed: ${(e as Error).message}` };
    }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, reason: 'redirect without location' };
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      return { ok: false, reason: `status ${res.status}` };
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      clearTimeout(timer);
      return { ok: false, reason: 'too large' };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    clearTimeout(timer);
    if (buf.byteLength > maxBytes) return { ok: false, reason: 'too large' };
    return { ok: true, bytes: buf, contentType: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), finalUrl: current };
  }
  return { ok: false, reason: 'too many redirects' };
}

const safeHost = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return 'invalid url';
  }
};

/** Detects image type and size from bytes (JPEG, PNG, WebP, GIF); never trusts the header alone. */
export function sniffImage(b: Uint8Array): { mime: string; width: number; height: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { mime: 'image/png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: 'image/gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { mime: 'image/jpeg', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}
