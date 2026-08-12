import type { VercelRequest, VercelResponse } from '@vercel/node';

// Per-page metadata for social sharing previews
const PAGE_META: Record<string, { title: string; description: string; image: string }> = {
    story: {
        title: 'Our Story | Louie Mae',
        description: 'Discover the heart behind Louie Mae — a journey of faith, craftsmanship, and calling. From artisan jewelry to curated lifestyle, every piece tells a story.',
        image: '/images/brand/fam2.png',
    },
    blog: {
        title: 'Simply by Mae | Louie Mae',
        description: 'Stories, inspiration, and behind-the-scenes moments from the Louie Mae journey.',
        image: '/images/brand/blog-main-v2.png',
    },
    shop: {
        title: 'Shop | Louie Mae',
        description: 'Browse our curated collections of elevated home décor, modern furniture, children\'s clothing, and lifestyle essentials.',
        image: '/images/brand/DINNERTABLE.png',
    },
    'collection/furniture': {
        title: 'Furniture | Louie Mae',
        description: 'Shop Furniture — Curated pieces for a timeless home.',
        image: '/images/brand/DINNERTABLE.png',
    },
    'collection/decor': {
        title: 'Home Decor | Louie Mae',
        description: 'Shop Home Decor — The details that tell your story.',
        image: '/images/brand/decor-vase.png',
    },
    'collection/fashion': {
        title: 'The Mae Collective | Louie Mae',
        description: 'Shop The Mae Collective — Effortless style for the modern woman.',
        image: '/images/brand/maev2.png',
    },
    'collection/kids': {
        title: 'Louie Kids & Co. | Louie Mae',
        description: 'Shop Louie Kids & Co. — Heirloom quality for little ones.',
        image: '/images/brand/kids-category.png',
    },
};

const DEFAULT_META = {
    title: 'Louie Mae | Curated Home, Kids & Lifestyle',
    description: 'Elevated home décor, modern organic furniture, and thoughtfully designed children\'s clothing — curated with warmth, intention, and lived-in luxury.',
    image: '/lm3.jpg',
};

export default function handler(req: VercelRequest, res: VercelResponse) {
    const path = (req.query.path as string) || '';
    const meta = PAGE_META[path] || DEFAULT_META;
    const BASE_URL = 'https://louiemae.com';
    const imageUrl = `${BASE_URL}${meta.image}`;
    const pageUrl = `${BASE_URL}/${path}`;
    const hashUrl = `${BASE_URL}/#${path}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${meta.title}</title>
  <meta name="description" content="${meta.description}" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:title" content="${meta.title}" />
  <meta property="og:description" content="${meta.description}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Louie Mae" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${meta.title}" />
  <meta name="twitter:description" content="${meta.description}" />
  <meta name="twitter:image" content="${imageUrl}" />

  <!-- Redirect real users to the SPA -->
  <meta http-equiv="refresh" content="0;url=${hashUrl}" />
  <link rel="canonical" href="${pageUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${hashUrl}">${meta.title}</a>...</p>
  <script>window.location.replace("${hashUrl}");</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Metadata is static in source. Keep it fresh for a day while allowing the
    // CDN to serve the last known-good copy during revalidation.
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(html);
}
