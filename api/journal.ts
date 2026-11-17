/* global AbortSignal */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { journalDocument, type JournalPost } from '../lib/serverJournalDocument.js';
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const post = (value: unknown): JournalPost | null => {
  const row = record(value);
  if (
    !row ||
    row.status !== 'published' ||
    typeof row._id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(row._id) ||
    !['title', 'excerpt', 'image', 'category', 'date'].every((key) => typeof row[key] === 'string')
  )
    return null;
  if (
    row.contentHtml !== undefined &&
    (typeof row.contentHtml !== 'string' || row.contentHtml.length > 1_000_000)
  )
    return null;
  return {
    _id: row._id,
    title: String(row.title),
    excerpt: String(row.excerpt),
    image: String(row.image),
    category: String(row.category),
    date: String(row.date),
    content: row.contentHtml as string | undefined,
  };
};
function failure(res: VercelResponse, status: number) {
  res.setHeader('X-Robots-Tag', 'noindex');
  if (status === 503) res.setHeader('Retry-After', '60');
  const title =
    status === 404
      ? 'Story not found'
      : status === 405
        ? 'Method not allowed'
        : 'Journal temporarily unavailable';
  return res
    .status(status)
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Louie Mae</title></head><body><main><h1>${title}</h1><a href="/blog">Visit the journal</a><a href="/shop">Explore the shop</a></main></body></html>`
    );
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return failure(res, 405);
  }
  if (process.env.VITE_PRELAUNCH_MODE === 'true') return res.redirect(307, '/');
  const id = req.query.id;
  if (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))
    return failure(res, 404);
  const origin = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
  if (!origin) return failure(res, 503);
  try {
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: id ? 'blogPosts:publicDetail' : 'blogPosts:publicSummaries',
        args: id ? { id } : {},
        format: 'json',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Journal unavailable');
    const result = record(await response.json());
    if (result?.status !== 'success' || !Object.hasOwn(result, 'value'))
      throw new Error('Journal unavailable');
    if (id && result.value === null) return failure(res, 404);
    const article = id ? post(result.value) : null;
    if (id && (!article || article._id !== id || typeof article.content !== 'string'))
      throw new Error('Article unavailable');
    if (!id && (!Array.isArray(result.value) || result.value.length > 250))
      throw new Error('Journal unavailable');
    const posts = id ? [] : (result.value as unknown[]).map(post);
    if (posts.some((value) => !value)) throw new Error('Journal unavailable');
    const template = await readFile(join(process.cwd(), 'dist', 'index.html'), 'utf8');
    return res
      .status(200)
      .send(
        req.method === 'HEAD'
          ? ''
          : journalDocument(template, posts as JournalPost[], article || undefined)
      );
  } catch {
    return failure(res, 503);
  }
}
