import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  const readFile = vi.fn().mockResolvedValue('<html><head><title>Home</title><meta name="description" content="Home"><meta property="og:image" content="home"><link rel="canonical" href="https://louiemae.com"></head><body><!--home-document-start-->Home hero<!--home-document-end--><!--product-document--><div id="root"></div></body></html>');
  return { ...actual, readFile, default: { ...actual, readFile } };
});
import { readFile } from 'node:fs/promises';
import handler from '../../api/collection';
const fetchMock = vi.fn();
const site = { collections: [{ id: 'furniture', title: 'Furniture & objects', subtitle: 'Thoughtful <pieces>', heroImage: '/images/brand/DINNERTABLE.png', subcategories: [{ id: 'chairs', title: 'Chairs', image: '/images/brand/furniture-chair.png' }] }] };
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_CONVEX_URL', 'https://public-fixture.convex.cloud');
  vi.stubEnv('VITE_PRELAUNCH_MODE', 'false'); fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url, options) => {
    const request = JSON.parse(options.body);
    expect(options.headers.Authorization).toBeUndefined();
    if (request.path === 'siteContent:get') return { ok: true, json: async () => ({ status: 'success', value: site }) };
    expect(request.args.paginationOpts).toEqual({ numItems: 12, cursor: null });
    return { ok: true, json: async () => ({ status: 'success', value: { page: request.path === 'retailLaunch:storefrontPage'
      ? [{ _id: 'chair', name: 'Chair </script>', category: 'Chairs', collection: 'furniture', images: ['javascript:bad()'], price: 200 }, { _id: 'lamp', collection: 'decor', name: 'Lamp', images: [], price: 10 }]
      : [] } }) };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function request(query: Record<string, unknown>, method = 'GET') {
  const result = { code: 0, body: '', headers: {} as Record<string, string> };
  const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; },
    status(code: number) { result.code = code; return this; }, send(body: string) { result.body = body; },
    redirect(code: number, location: string) { result.code = code; result.headers.Location = location; } };
  await handler({ method, query } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
it('renders escaped public collection content and bounded matching product previews', async () => {
  const result = await request({ id: 'furniture', ref: 'PARTNER' });
  expect(result.code).toBe(200); expect(result.headers['Cache-Control']).toBe('no-store');
  expect(result.body).toContain('<h1>Furniture &amp; objects</h1>');
  expect(result.body).toContain('/products/chair'); expect(result.body).not.toContain('/products/lamp');
  expect(result.body).toContain('Chair &lt;/script&gt;'); expect(result.body).not.toContain('javascript:bad');
  expect(result.body).not.toContain('Home hero'); expect(result.body).not.toContain('http-equiv="refresh"');
  expect(result.body).toContain('href="https://louiemae.com/collection/furniture"');
  expect(result.body).toContain('data-collection-id="furniture"'); expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.body).toContain('rel="preload" as="image"');
  expect(vi.mocked(readFile)).toHaveBeenCalled();
});
it.each([{ id: ['furniture'] }, { id: '<script>' }, { id: '' }])('rejects malformed identities before querying: %j', async query => {
  expect((await request(query)).code).toBe(404); expect(fetchMock).not.toHaveBeenCalled();
});
it('distinguishes a confirmed missing collection from unavailable configuration', async () => {
  expect((await request({ id: 'missing' })).code).toBe(404);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', value: null }) });
  const result = await request({ id: 'furniture' });
  expect(result.code).toBe(503); expect(result.headers['Retry-After']).toBe('60');
  expect(result.headers['X-Robots-Tag']).toBe('noindex');
});
it('does not turn a product-source failure into a successful empty collection', async () => {
  fetchMock.mockImplementation(async (_url, options) => ({ ok: true, json: async () => JSON.parse(options.body).path === 'siteContent:get'
    ? { status: 'success', value: site } : { status: 'error', errorMessage: 'private diagnostic' } }));
  const result = await request({ id: 'furniture' });
  expect(result.code).toBe(503); expect(result.body).not.toContain('private diagnostic');
});
it('supports HEAD and rejects business methods without querying', async () => {
  expect((await request({ id: 'furniture' }, 'HEAD')).body).toBe('');
  fetchMock.mockClear(); expect((await request({ id: 'furniture' }, 'POST')).code).toBe(405);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('applies the same category identity filter to both product sources', async () => {
  const matching = await request({ id: 'furniture', cat: 'chairs' });
  expect(matching.body).toContain('/products/chair');
  expect(matching.body).not.toContain('rel="preload" as="image"');
  const unmatched = await request({ id: 'furniture', cat: 'tables' });
  expect(unmatched.code).toBe(200); expect(unmatched.body).not.toContain('/products/chair');
  expect(unmatched.body).not.toContain('No products');
});
