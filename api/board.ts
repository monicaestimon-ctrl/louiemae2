import type { VercelRequest, VercelResponse } from '@vercel/node';

// A shared board's link, louiemae.com/b/<slug>?c=<channel>. Link previews (Messages, Slack,
// Pinterest) read the Open Graph tags; people go straight on to the board's shoppable page,
// which records the visit with its channel.

const CHANNELS = ['story', 'pin', 'post', 'pdf', 'link', 'share', 'qr'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Board = { title: string; mode: 'shop' | 'presentation'; by: string; productIds: string[]; coverUrl: string | null };

async function loadBoard(slug: string): Promise<Board | null> {
  const url = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
  if (!url) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'holmSync:sharedBoard', args: { slug }, format: 'json' }),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { status: string; value?: Board | null };
    return body.status === 'success' ? (body.value ?? null) : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = String(req.query.slug || '').toLowerCase();
  const raw = String(req.query.c || 'link').toLowerCase();
  const channel = CHANNELS.includes(raw) ? raw : 'link';
  const BASE_URL = 'https://louiemae.com';
  if (!/^[a-z0-9]{12}$/.test(slug)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(307, '/trade');
  }
  const board = await loadBoard(slug);
  const target = `/trade?c=${channel}#b/${slug}`;
  const n = board?.productIds.length ?? 0;
  const title = board ? `${board.title} · House of Louie Mae` : 'A board on House of Louie Mae';
  const description = board
    ? `${n} piece${n === 1 ? '' : 's'} chosen by ${board.by}. ${board.mode === 'shop' ? 'Shop the board on House of Louie Mae.' : 'View the board on House of Louie Mae.'}`
    : 'Furniture and lighting for rooms people remember.';
  const image = board?.coverUrl || `${BASE_URL}/lm3.jpg`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${BASE_URL}/b/${slug}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:site_name" content="House of Louie Mae" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <link rel="canonical" href="${BASE_URL}/b/${slug}" />
  <meta http-equiv="refresh" content="0;url=${esc(target)}" />
</head>
<body>
  <p>Opening <a href="${esc(target)}">${esc(board?.title || 'the board')}</a>…</p>
  <script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Re-sharing updates a board in place, so previews stay fresh: a minute at the edge, then revalidate.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(board ? 200 : 404).send(html);
}
