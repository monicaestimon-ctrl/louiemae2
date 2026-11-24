import { withPublicInitialData } from '../lib/serverPublicInitialData.js';
import { publicSiteData } from '../lib/publicInitialData.js';
/* global AbortSignal */
import type { VercelRequest, VercelResponse } from '../lib/serverHttp.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pageDocument, type PublicPageDocument } from '../lib/serverPageDocument.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, limit = 20000) =>
  typeof value === 'string' ? value.slice(0, limit) : '';
function failure(res: VercelResponse, status: number) {
  res.setHeader('X-Robots-Tag', 'noindex');
  if (status === 503) res.setHeader('Retry-After', '60');
  const title =
    status === 404
      ? 'Page not found'
      : status === 405
        ? 'Method not allowed'
        : 'Page temporarily unavailable';
  return res
    .status(status)
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Louie Mae</title></head><body><main><h1>${title}</h1><a href="/">Return to Louie Mae</a></main></body></html>`
    );
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return failure(res, 405);
  }
  if (process.env.VITE_PRELAUNCH_MODE === 'true') return res.redirect(307, '/');
  const id = req.query.id;
  if (id !== 'shop' && id !== 'story') return failure(res, 404);
  const origin = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
  if (!origin) return failure(res, 503);
  try {
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'siteContent:get', args: {}, format: 'json' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Content unavailable');
    const result = record(await response.json());
    if (result.status !== 'success' || !result.value) throw new Error('Content unavailable');
    const site = record(result.value);
    let page: PublicPageDocument;
    if (id === 'story') {
      const story = record(site.story),
        hero = record(story.hero),
        prologue = record(story.prologue),
        chapters = record(story.chapters);
      if (!text(hero.title)) throw new Error('Story unavailable');
      page = {
        id,
        heroTitle: text(hero.title, 200),
        heroSubtitle: text(hero.subtitle, 200),
        title: [text(hero.title, 200), text(hero.subtitle, 200)].filter(Boolean).join(' '),
        description: text(prologue.subtext, 160),
        image: text(hero.image, 2000),
        links: [],
        sections: [
          { text: text(prologue.quote) },
          ...['one', 'two', 'three', 'four'].map((key) => ({
            heading: text(chapters[key + 'Title'], 200),
            text: text(chapters[key + 'Text']),
          })),
          ...(Array.isArray(story.sections)
            ? story.sections.slice(0, 24).map((value) => {
                const section = record(value);
                return {
                  heading: text(section.heading, 200),
                  text: text(section.content),
                  image: text(section.image, 2000),
                };
              })
            : []),
        ],
      };
    } else {
      const home = record(site.home),
        images = record(home.categoryImages);
      if (!Object.keys(images).length) throw new Error('Shop unavailable');
      page = {
        id,
        title: 'Louie Mae',
        description: 'Explore our collections.',
        image: text(record(home.shop).headerImage, 2000) || '/images/brand/DINNERTABLE.png',
        sections: [],
        links: [
          ['furniture', 'Furniture'],
          ['decor', 'Home Decor'],
          ['fashion', 'The Mae Collective'],
          ['kids', 'Louie Kids & Co.'],
          ['journal', 'Simply by Mae'],
        ].map(([key, title]) => ({
          title,
          href: key === 'journal' ? '/blog' : `/collection/${key}`,
          image: text(images[key], 2000),
        })),
      };
    }
    const template = await readFile(join(process.cwd(), 'dist', 'index.html'), 'utf8');
    return res
      .status(200)
      .send(
        req.method === 'HEAD'
          ? ''
          : withPublicInitialData(pageDocument(template, page), `/${id}`, {
              site: publicSiteData(site),
            })
      );
  } catch {
    return failure(res, 503);
  }
}
