/* global AbortSignal */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCollectionId } from '../lib/collectionId.js';
import { collectionDocument, type PublicCollectionDocument } from '../lib/serverCollectionDocument.js';
import { buildCatalogCategoryFilter, matchesCatalogCategoryFilter } from '../lib/productCategories.js';
import type { CollectionConfig } from '../types';
import { publicSiteData } from '../lib/publicInitialData.js';
import { withPublicInitialData } from '../lib/serverPublicInitialData.js';

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
async function query(origin: string, path: string, args: Record<string, unknown>) {
  const response = await fetch(`${origin.replace(/\/$/, '')}/api/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Public query unavailable');
  const result = record(await response.json());
  if (result?.status !== 'success' || !Object.hasOwn(result, 'value')) throw new Error('Public query unavailable');
  return result.value;
}
function failure(res: VercelResponse, status: number, title: string) {
  res.setHeader('X-Robots-Tag', 'noindex');
  if (status === 503) res.setHeader('Retry-After', '60');
  return res.status(status).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Louie Mae</title></head><body><main><h1>${title}</h1><a href="/">Return to Louie Mae</a></main></body></html>`);
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD'); return failure(res, 405, 'Method not allowed');
  }
  if (process.env.VITE_PRELAUNCH_MODE === 'true') return res.redirect(307, '/');
  const id = req.query.id;
  if (typeof id !== 'string' || !isCollectionId(id)) return failure(res, 404, 'Collection not found');
  const category = req.query.cat;
  if (category !== undefined && (typeof category !== 'string' || category.length > 200)) return failure(res, 404, 'Collection filter not found');
  const origin = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
  if (!origin) return failure(res, 503, 'Collections temporarily unavailable');
  try {
    const site = record(await query(origin, 'siteContent:get', {}));
    if (!site || !Array.isArray(site.collections)) throw new Error('Collection configuration unavailable');
    const collection = site.collections.map(record).find(candidate => candidate?.id === id);
    if (!collection) return failure(res, 404, 'Collection not found');
    if (typeof collection.title !== 'string' || typeof collection.subtitle !== 'string' || !Array.isArray(collection.subcategories)) throw new Error('Invalid collection configuration');
    if (!collection.subcategories.every(value => { const item = record(value); return item && typeof item.id === 'string' && typeof item.title === 'string'; })) throw new Error('Invalid category configuration');
    const filter = typeof category === 'string' && category && category !== 'All' ? buildCatalogCategoryFilter(category, collection as unknown as CollectionConfig) : undefined;
    const [legacyValue, retailValue] = await Promise.all([
      query(origin, 'catalog:storefrontPage', { collection: id, categoryFilter: filter, sort: 'newest', paginationOpts: { numItems: 12, cursor: null } }),
      ['furniture', 'decor'].includes(id) ? query(origin, 'retailLaunch:storefrontPage', { paginationOpts: { numItems: 12, cursor: null } }) : Promise.resolve({ page: [] }),
    ]);
    const legacy = record(legacyValue), retail = record(retailValue);
    if (!Array.isArray(legacy?.page) || !Array.isArray(retail?.page)) throw new Error('Collection products unavailable');
    const cards: PublicCollectionDocument['cards'] = [];
    const seen = new Set<string>();
    // These are bounded preview candidates, not a complete inventory or stock count.
    for (const value of [...retail.page, ...legacy.page]) {
      const row = record(value);
      if (!row || row.collection !== id || typeof row._id !== 'string' || seen.has(row._id) || typeof row.name !== 'string' || typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 0 || !Array.isArray(row.images)) continue;
      if (filter && !matchesCatalogCategoryFilter({ category: typeof row.category === 'string' ? row.category : '',
        subcategory: typeof row.subcategory === 'string' ? row.subcategory : undefined,
        subcategoryIds: Array.isArray(row.subcategoryIds) ? row.subcategoryIds.filter((value): value is string => typeof value === 'string') : undefined }, filter)) continue;
      seen.add(row._id);
      cards.push({ id: row._id, name: row.name.slice(0, 200), price: row.price, image: typeof row.images[0] === 'string' ? row.images[0] : '' });
      if (cards.length === 12) break;
    }
    const categories = collection.subcategories.map(record).filter((value): value is Record<string, unknown> => value !== null);
    const primaryCategory = categories.find(value => value.isMainCategory) || categories[0];
    const rootCategories = categories.some(value => value.isMainCategory) ? categories.filter(value => value.isMainCategory) : categories;
    const document: PublicCollectionDocument = { rootCategories: !filter && req.query.view !== 'products' ? rootCategories.slice(0,100).map(category => ({id: String(category.id), title: String(category.title), image: typeof category.image === 'string' ? category.image : '', caption: typeof category.caption === 'string' ? category.caption : undefined, redirect: typeof category.redirect === 'string' ? category.redirect : undefined})) : undefined, id, title: collection.title.slice(0, 200), subtitle: collection.subtitle.slice(0, 1000),
      primaryCategoryImage: !filter && req.query.view !== 'products' && typeof primaryCategory?.image === 'string' ? primaryCategory.image : undefined,
      heroImage: typeof collection.heroImage === 'string' ? collection.heroImage : undefined,
      categories: collection.subcategories.map(record).flatMap(category => category && typeof category.id === 'string' && typeof category.title === 'string'
        ? [{ id: category.id.slice(0, 200), title: category.title.slice(0, 200) }] : []).slice(0, 100), cards };
    const template = await readFile(join(process.cwd(), 'dist', 'index.html'), 'utf8');
    return res.status(200).send(req.method === 'HEAD' ? '' : withPublicInitialData(collectionDocument(template, document), `/collection/${id}`, { site: publicSiteData(site) }));
  } catch { return failure(res, 503, 'Collections temporarily unavailable'); }
}
