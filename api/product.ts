/* global AbortSignal */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { productDocument, type PublicProductDocument } from '../lib/serverProductDocument';

function failure(res: VercelResponse, status: number, title: string) {
  res.setHeader('X-Robots-Tag', 'noindex');
  if (status === 503) res.setHeader('Retry-After', '60');
  return res
    .status(status)
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Louie Mae</title></head><body><main><h1>${title}</h1><p><a href="/">Return to Louie Mae</a></p></main></body></html>`
    );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return failure(res, 405, 'Method not allowed');
  }
  if (process.env.VITE_PRELAUNCH_MODE === 'true') return res.redirect(307, '/');
  const id = req.query.id;
  const variant = req.query.variant;
  if (
    typeof id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
    (variant !== undefined && (typeof variant !== 'string' || variant.length > 200))
  )
    return failure(res, 404, 'Product not found');
  const origin = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
  if (!origin) return failure(res, 503, 'Products temporarily unavailable');
  try {
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'products:getStorefrontDetail', args: { id }, format: 'json' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Public product query failed');
    const result = (await response.json()) as {
      status: string;
      value?: PublicProductDocument | null;
    };
    if (result.status !== 'success' || result.value === undefined)
      throw new Error('Public product query unavailable');
    if (result.value === null) return failure(res, 404, 'Product not found');
    const product = result.value;
    if (
      product._id !== id ||
      typeof product.name !== 'string' ||
      typeof product.description !== 'string' ||
      typeof product.category !== 'string' ||
      !Array.isArray(product.images)
    )
      throw new Error('Invalid public product');
    const template = await readFile(join(process.cwd(), 'dist', 'index.html'), 'utf8');
    const html = productDocument(
      template,
      product,
      typeof variant === 'string' ? variant : undefined
    );
    if (!html) return failure(res, 404, 'Product option not found');
    return res.status(200).send(req.method === 'HEAD' ? '' : html);
  } catch {
    return failure(res, 503, 'Products temporarily unavailable');
  }
}
