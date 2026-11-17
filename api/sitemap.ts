/* global AbortSignal */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { STOREFRONT_ORIGIN } from '../lib/productMetadata.js';
import { isCollectionId } from '../lib/collectionId.js';

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const BASE_PATHS = ['/', '/shop', '/story', '/blog', '/trade/', '/privacy', '/terms'];

/** Current public identities only. A partial or unavailable source is never a successful sitemap. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const failure = (status: number) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex');
    if (status === 503) res.setHeader('Retry-After', '60');
    return res.status(status).send(req.method === 'HEAD' ? '' : 'Sitemap unavailable');
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return failure(405); }
  if (process.env.VITE_PRELAUNCH_MODE === 'true') return failure(503);
  const origin = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
  if (!origin) return failure(503);
  const signal = AbortSignal.timeout(20_000);
  async function query(path: string, args: Record<string, unknown>) {
    const response = await fetch(`${origin!.replace(/\/$/, '')}/api/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args, format: 'json' }), signal,
    });
    if (!response.ok) throw new Error('Source unavailable');
    const result = record(await response.json());
    if (result?.status !== 'success' || !Object.hasOwn(result, 'value')) throw new Error('Source unavailable');
    return result.value;
  }
  try {
    const paths = new Set(BASE_PATHS);
    const site = record(await query('siteContent:get', {}));
    if (!site || !Array.isArray(site.collections) || site.collections.length > 1000) throw new Error('Invalid collections');
    for (const value of site.collections) {
      const collection = record(value);
      if (!collection || typeof collection.id !== 'string' || !isCollectionId(collection.id) || typeof collection.title !== 'string' || !collection.title.trim()) throw new Error('Invalid collection');
      paths.add(`/collection/${encodeURIComponent(collection.id)}`);
    }
    for (const [source, prefix] of [['publicSearch:sitemapPage', '/products/'], ['blogPosts:sitemapPage', '/blog/']]) {
      let cursor: string | null = null;
      const cursors = new Set<string>();
      for (let batch = 0; ; batch++) {
        if (batch >= 2500 || signal.aborted) throw new Error('Sitemap source exceeds bounded request');
        const result = record(await query(source, { paginationOpts: { cursor, numItems: 24 } }));
        if (!result || !Array.isArray(result.page) || result.page.length > 100 || typeof result.isDone !== 'boolean' || typeof result.continueCursor !== 'string') throw new Error('Invalid page');
        for (const path of result.page) {
          if (typeof path !== 'string' || !path.startsWith(prefix) || !/^[a-zA-Z0-9_-]{1,128}$/.test(path.slice(prefix.length))) throw new Error('Invalid public path');
          paths.add(path);
          if (paths.size > 50_000) throw new Error('Sitemap index partitioning required');
        }
        if (result.isDone) break;
        if (!result.continueCursor || cursors.has(result.continueCursor)) throw new Error('Repeated cursor');
        cursors.add(result.continueCursor); cursor = result.continueCursor;
      }
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...paths].map(path => `  <url><loc>${escape(STOREFRONT_ORIGIN + path)}</loc></url>`).join('\n')}\n</urlset>\n`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(req.method === 'HEAD' ? '' : xml);
  } catch { return failure(503); }
}
