import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  const readFile = vi.fn().mockResolvedValue('<html><head><title>Home</title><meta name="description" content="Home"><meta property="og:image" content="home"><link rel="canonical" href="https://www.louiemae.com"></head><body><!--home-document-start-->Home hero<!--home-document-end--><!--product-document--><div id="root"></div></body></html>');
  return { ...actual, readFile, default: { ...actual, readFile } };
});
import { readFile } from 'node:fs/promises';
import handler from '../../api/collection';
const fetchMock = vi.fn();
const site = { navLinks: [], home: {}, story: {}, privateCost: 98765, collections: [{ id: 'furniture', title: 'Furniture & objects', subtitle: 'Thoughtful <pieces>', heroImage: '/images/brand/DINNERTABLE.png', subcategories: [{ id: 'chairs', title: 'Chairs', image: '/images/brand/furniture-chair.png' }] }] };
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
  const result = await request({ id: 'furniture', ref: 'PARTNER', view: 'products' });
  expect(result.code).toBe(200); expect(result.headers['Cache-Control']).toBe('no-store');
  expect(new globalThis.DOMParser().parseFromString(result.body, 'text/html').querySelector('h1')?.textContent).toBe('Furniture & objects');
  expect(result.body).toContain('/products/chair'); expect(result.body).not.toContain('/products/lamp');
  expect(result.body).toContain('Chair &lt;/script&gt;'); expect(result.body).not.toContain('javascript:bad');
  expect(result.body).not.toContain('Home hero'); expect(result.body).not.toContain('http-equiv="refresh"');
  expect(result.body).toContain('href="https://www.louiemae.com/collection/furniture"');
  expect(result.body).toContain('data-collection-id="furniture"'); expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.body).not.toContain('rel="preload" as="image"');
  const payload = JSON.parse(new globalThis.DOMParser().parseFromString(result.body, 'text/html').getElementById('lm-public-initial-data')!.textContent!);
  expect(payload.path).toBe('/collection/furniture');
  expect(payload.data.site.collections[0].id).toBe('furniture');
  expect(result.body).not.toContain('privateCost');
  expect(payload.data).not.toHaveProperty('products');
  expect(payload.data).not.toHaveProperty('ready');
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
  const result = await request({ id: 'furniture', view: 'products' });
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

const kidsProduct = { _id: 'dress', name: 'Dress', price: 32, category: 'Dresses', images: ['/dress.webp'], variantCount: 2 };
const kidsPayload = (products: unknown[] = [kidsProduct]) => ({ ready: true, version: 5, products });
function kidsSource(value: unknown) {
  fetchMock.mockImplementation(async (_url, options) => {
    const query = JSON.parse(options.body);
    expect(options.headers.Authorization).toBeUndefined();
    if (query.path === 'siteContent:get') return { ok: true, json: async () => ({ status: 'success', value: {
      ...site, collections: [{ ...site.collections[0], id: 'kids' }],
    } }) };
    if (query.path === 'catalog:kidsRootPreview') {
      expect(query.args).toEqual({});
      return { ok: true, json: async () => ({ status: 'success', value }) };
    }
    expect(query.path).toBe('catalog:storefrontPage');
    return { ok: true, json: async () => ({ status: 'success', value: { page: [] } }) };
  });
}
it('uses the verified eight-card Kids root for both initial HTML and a display-only snapshot', async () => {
  const products = Array.from({ length: 8 }, (_, i) => ({ ...kidsProduct, _id: 'dress' + i, supplierCost: 12345, inStock: true }));
  kidsSource(kidsPayload(products));
  const result = await request({ id: 'kids' });
  expect(result.code).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(2);
  const document = new globalThis.DOMParser().parseFromString(result.body, 'text/html');
  const snapshot = JSON.parse(document.getElementById('lm-public-initial-data')!.textContent!);
  expect(snapshot.data.kids.products.map((p: { _id: string }) => p._id)).toEqual(products.map(p => p._id));
  expect([...document.querySelectorAll('.lm-collection-card')].map(a => a.getAttribute('href'))).toEqual(products.map(p => '/products/' + p._id));
  expect(result.body).not.toContain('supplierCost'); expect(result.body).not.toContain('inStock');
  expect(snapshot.data.kids.products).toHaveLength(8);
});
it.each([undefined, null, { ...kidsPayload(), ready: false }, { ...kidsPayload(), version: 4 }, kidsPayload(Array(9).fill(kidsProduct))])('fails closed for unverified Kids root evidence', async value => {
  kidsSource(value); const result = await request({ id: 'kids' });
  expect(result.code).toBe(503); expect(result.headers['X-Robots-Tag']).toBe('noindex');
  expect(result.body).not.toContain('lm-public-initial-data');
});
it('distinguishes verified Kids emptiness from an unavailable source', async () => {
  kidsSource(kidsPayload([])); const result = await request({ id: 'kids' });
  expect(result.code).toBe(200);
  const document = new globalThis.DOMParser().parseFromString(result.body, 'text/html');
  expect(JSON.parse(document.getElementById('lm-public-initial-data')!.textContent!).data.kids.products).toEqual([]);
});
it.each([{ id: 'kids', view: 'products' }, { id: 'kids', cat: 'chairs' }])('does not seed filtered or grid responses with root cards', async query => {
  kidsSource(kidsPayload()); const result = await request(query);
  expect(result.code).toBe(200);
  expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).path)).not.toContain('catalog:kidsRootPreview');
  const document = new globalThis.DOMParser().parseFromString(result.body, 'text/html');
  expect(JSON.parse(document.getElementById('lm-public-initial-data')!.textContent!).data.kids).toBeUndefined();
});

it.each(['', 'http://untrusted.invalid/image', '//untrusted.invalid/image', 'javascript:bad()'])('keeps the verified Kids page available with an unusable first image %s', async image=>{
 kidsSource(kidsPayload([{...kidsProduct,images:[image]}]));const result=await request({id:'kids'});expect(result.code).toBe(200);
 const document=new globalThis.DOMParser().parseFromString(result.body,'text/html');
 expect(document.querySelector('.lm-collection-card')?.getAttribute('href')).toBe('/products/dress');
 const snapshot=JSON.parse(document.getElementById('lm-public-initial-data')!.textContent!);
 expect(snapshot.data.kids.products[0].images).toEqual([]);
 expect(document.querySelector('.lm-collection-card img')).toBeNull();
});

it.each(['furniture','decor','fashion'])('renders the %s category root without unused inventory queries or product images',async id=>{
 fetchMock.mockImplementation(async (_url,options)=>{
  expect(JSON.parse(options.body).path).toBe('siteContent:get');
  return{ok:true,json:async()=>({status:'success',value:{...site,collections:[{...site.collections[0],id}]}})};
 });
 const result=await request({id});expect(result.code).toBe(200);expect(fetchMock).toHaveBeenCalledTimes(1);
 const html=new globalThis.DOMParser().parseFromString(result.body,'text/html');
 expect(html.querySelectorAll('.lm-collection-card')).toHaveLength(0);
 expect(html.querySelector('h1')?.textContent).toBe('Furniture & objects');
 expect(result.body).toContain(`/collection/${id}?cat=chairs`);
 expect(result.body).toContain('rel="preload" as="image"');
 expect(html.querySelectorAll('img').length).toBeGreaterThan(0);
 expect(result.body).not.toContain('No products');
});

it('keeps a configured category social image without querying product previews', async () => {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({status:'success',value:{...site,collections:[{...site.collections[0],heroImage:''}]}}) }));
  const result=await request({id:'furniture'});
  expect(result.code).toBe(200);
  const document=new globalThis.DOMParser().parseFromString(result.body,'text/html');
  expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain('/images/brand/furniture-chair.png');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
