import { v } from 'convex/values';
import { action } from './_generated/server';

// Import a Pinterest pin into My Inspo from its link. Uses Pinterest's public oEmbed endpoint,
// which needs no developer app; the image is copied into file storage like an upload.

const PIN_HOST = /^(?:[a-z]{2,3}\.)?pinterest\.(?:com|ca|co\.uk|com\.au|de|fr|es|it|com\.mx|jp|nz|ie|at|ch|dk|se|pt|cl|ph|ru|kr|co\.kr|com\.br)$/i;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function pinUrlOf(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'pin.it') return { short: true, url };
  if (PIN_HOST.test(host) && /^\/pin\/[\w-]+/.test(url.pathname)) return { short: false, url };
  return null;
}

/** Every upstream request gives up after a few seconds rather than holding the action open. */
function get(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/** Reads an image body, stopping as soon as it passes the size limit. */
async function readImage(res: Response) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error('That image is too large to import.');
  const reader = res.body?.getReader();
  if (!reader) throw new Error('The pin image could not be downloaded.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error('That image is too large to import.');
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || 'image/jpeg' });
}

const text = (x: unknown) => (typeof x === 'string' ? x : '');

export const importPin = action({
  args: { url: v.string() },
  handler: async (ctx, a) => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error('Sign in to import from Pinterest.');
    const parsed = pinUrlOf(a.url);
    if (!parsed) throw new Error('Paste a Pinterest pin link, like pinterest.com/pin/… or pin.it/…');
    let pinUrl = parsed.url;
    if (parsed.short) {
      // pin.it links redirect to the full pin page
      const res = await get(pinUrl.toString(), { redirect: 'follow' });
      const resolved = pinUrlOf(res.url);
      if (!resolved || resolved.short) throw new Error('That short link does not open a pin.');
      pinUrl = resolved.url;
    }
    const clean = `https://www.pinterest.com${pinUrl.pathname.match(/^\/pin\/[\w-]+/)![0]}/`;
    const meta = await get(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(clean)}`);
    if (!meta.ok) throw new Error('Pinterest could not find that pin. Check that it is public.');
    const body: unknown = await meta.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new Error('Pinterest could not find that pin. Check that it is public.');
    const info = body as Record<string, unknown>;
    const thumb = text(info.thumbnail_url);
    if (!thumb || !/^https:\/\/i\.pinimg\.com\//.test(thumb)) throw new Error('That pin has no image to import.');
    // oEmbed returns a small thumbnail; the same image is published at 736px wide.
    let image = await get(thumb.replace(/\/\d+x\//, '/736x/'));
    if (!image.ok) image = await get(thumb);
    const type = image.headers.get('content-type') || '';
    if (!image.ok || !type.startsWith('image/')) throw new Error('The pin image could not be downloaded.');
    const blob = await readImage(image);
    const fileId = await ctx.storage.store(blob);
    const src = await ctx.storage.getUrl(fileId);
    if (!src) throw new Error('The image did not save. Try again.');
    return {
      src,
      title: text(info.title).trim().slice(0, 120) || 'Pinterest pin',
      author: text(info.author_name).slice(0, 80),
      link: clean,
    };
  },
});
