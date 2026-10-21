import { v } from 'convex/values';
import { action } from './_generated/server';

// Import a Pinterest pin into My Inspo from its link. Uses Pinterest's public oEmbed endpoint,
// which needs no developer app; the image is copied into file storage like an upload.

const PIN_HOST = /^(?:[a-z]{2,3}\.)?pinterest\.(?:com|ca|co\.uk|com\.au|de|fr|es|it|com\.mx|jp|nz|ie|at|ch|dk|se|pt|cl|ph|ru|kr|co\.kr|com\.br)$/i;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

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

export const importPin = action({
  args: { url: v.string() },
  handler: async (ctx, a) => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error('Sign in to import from Pinterest.');
    const parsed = pinUrlOf(a.url);
    if (!parsed) throw new Error('Paste a Pinterest pin link, like pinterest.com/pin/… or pin.it/…');
    let pinUrl = parsed.url;
    if (parsed.short) {
      // pin.it links redirect to the full pin page
      const res = await fetch(pinUrl.toString(), { redirect: 'follow' });
      const resolved = pinUrlOf(res.url);
      if (!resolved || resolved.short) throw new Error('That short link does not open a pin.');
      pinUrl = resolved.url;
    }
    const clean = `https://www.pinterest.com${pinUrl.pathname.match(/^\/pin\/[\w-]+/)![0]}/`;
    const meta = await fetch(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(clean)}`);
    if (!meta.ok) throw new Error('Pinterest could not find that pin. Check that it is public.');
    const info = (await meta.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    const thumb = info.thumbnail_url;
    if (!thumb || !/^https:\/\/i\.pinimg\.com\//.test(thumb)) throw new Error('That pin has no image to import.');
    // oEmbed returns a small thumbnail; the same image is published at 736px wide.
    let image = await fetch(thumb.replace(/\/\d+x\//, '/736x/'));
    if (!image.ok) image = await fetch(thumb);
    const type = image.headers.get('content-type') || '';
    if (!image.ok || !type.startsWith('image/')) throw new Error('The pin image could not be downloaded.');
    const blob = await image.blob();
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('That image is too large to import.');
    const fileId = await ctx.storage.store(blob);
    const src = await ctx.storage.getUrl(fileId);
    if (!src) throw new Error('The image did not save. Try again.');
    return {
      src,
      title: (info.title || '').trim().slice(0, 120) || 'Pinterest pin',
      author: (info.author_name || '').slice(0, 80),
      link: clean,
    };
  },
});
