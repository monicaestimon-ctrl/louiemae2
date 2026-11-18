import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const readFile = vi
    .fn()
    .mockResolvedValue(
      '<html><head><title>Home</title><meta name="description" content="Home"><meta property="og:image" content="home"><link rel="canonical" href="https://www.louiemae.com"></head><body><!--home-document-start-->Home hero<!--home-document-end--><!--product-document--><div id="root"></div></body></html>'
    );
  return { ...actual, readFile, default: { ...actual, readFile } };
});
import handler from '../../api/page';
const fetchMock = vi.fn();
const site = {
  story: {
    hero: { title: 'Our <Story>', subtitle: '& Purpose', image: 'javascript:bad' },
    prologue: { quote: 'A beginning', subtext: 'Our story' },
    chapters: { oneTitle: 'First chapter', oneText: 'Public chapter text' },
  },
  home: {
    categoryImages: { furniture: '/images/brand/DINNERTABLE.png' },
    shop: { headerImage: '/images/brand/DINNERTABLE.png' },
  },
  privateCost: 12345,
};
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_CONVEX_URL', 'https://public-fixture.convex.cloud');
  vi.stubEnv('VITE_PRELAUNCH_MODE', 'false');
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', value: site }) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function request(id: unknown, method = 'GET') {
  const result = { status: 0, body: '', headers: {} as Record<string, string> };
  const res = {
    setHeader: (key: string, value: string) => {
      result.headers[key] = value;
    },
    status(code: number) {
      result.status = code;
      return this;
    },
    send(body: string) {
      result.body = body;
    },
    redirect(code: number, location: string) {
      result.status = code;
      result.headers.Location = location;
    },
  };
  await handler(
    { method, query: { id, ref: 'PARTNER' } } as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
  return result;
}
it('serves public story text and safe metadata without redirecting or leaking unrelated fields', async () => {
  const result = await request('story');
  expect(result.status).toBe(200);
  expect(
    new globalThis.DOMParser().parseFromString(result.body, 'text/html').querySelector('h1')
      ?.textContent
  ).toBe('Our <Story> & Purpose');
  expect(result.body).toContain('Public chapter text');
  expect(result.body).toContain('href="https://www.louiemae.com/story"');
  for (const text of [
    'privateCost',
    '12345',
    'javascript:bad',
    'http-equiv="refresh"',
    'Home hero',
  ])
    expect(result.body).not.toContain(text);
  const options = fetchMock.mock.calls[0][1];
  expect(options.headers.Authorization).toBeUndefined();
  expect(JSON.parse(options.body).path).toBe('siteContent:get');
});
it('provides native shop collection links and handles HEAD without a body', async () => {
  const result = await request('shop');
  expect(result.status).toBe(200);
  expect(result.body).toContain('href="/collection/furniture"');
  expect(result.body).toContain('href="/blog"');
  expect((await request('shop', 'HEAD')).body).toBe('');
});
it('rejects invalid paths and business methods before public reads', async () => {
  expect((await request(['story'])).status).toBe(404);
  expect((await request('missing')).status).toBe(404);
  expect((await request('shop', 'POST')).status).toBe(405);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('keeps source failure distinct from a valid empty story', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', value: null }) });
  const result = await request('story');
  expect(result.status).toBe(503);
  expect(result.headers['X-Robots-Tag']).toBe('noindex');
  expect(result.headers['Retry-After']).toBe('60');
});

it('reserves the known story hero dimensions and keeps its title visible in the first viewport', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      status: 'success',
      value: {
        ...site,
        story: {
          ...site.story,
          hero: {
            title: 'Discover',
            subtitle: 'Our Journey',
            image: '/images/brand/DINNERTABLE.png',
          },
        },
      },
    }),
  });
  const result = await request('story');
  const dom = new globalThis.DOMParser().parseFromString(result.body, 'text/html');
  const hero = dom.querySelector('main section img');
  expect(hero?.getAttribute('width')).toBe('1000');
  expect(hero?.getAttribute('height')).toBe('424');
  expect(hero?.getAttribute('fetchpriority')).toBe('high');
  expect(dom.querySelector('main section .opacity-0')).toBeNull();
  expect(dom.querySelector('main h1')?.textContent).toBe('Discover Our Journey');
});

it('hands off only public site configuration from the exact initial response', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', value: { ...site, navLinks: [], collections: [] } }),
  });
  const result = await request('story');
  const dom = new globalThis.DOMParser().parseFromString(result.body, 'text/html');
  const envelope = JSON.parse(dom.getElementById('lm-public-initial-data')!.textContent!);
  expect(envelope.path).toBe('/story');
  expect(envelope.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(envelope.data.site).sort()).toEqual([
    'collections',
    'home',
    'navLinks',
    'story',
  ]);
  expect(envelope.data.site.story.hero.title).toBe(site.story.hero.title);
  expect(result.body).not.toContain('privateCost');
});

it('serves the Story AVIF source with a WebP fallback and identical responsive sizes', async () => {
  fetchMock.mockResolvedValue({ok:true,json:async()=>({status:'success',value:{...site,story:{...site.story,hero:{title:'Our',subtitle:'Story',image:'/images/brand/fam2.png'}}}})});
  const result = await request('story');
  const dom = new globalThis.DOMParser().parseFromString(result.body, 'text/html');
  const picture = dom.querySelector('main section picture');
  const avif = picture?.querySelector('source[type="image/avif"]');
  const fallback = picture?.querySelector('img');
  expect(avif?.getAttribute('srcset')).toContain('.avif 640w');
  expect(avif?.getAttribute('sizes')).toBe(fallback?.getAttribute('sizes'));
  expect(fallback?.getAttribute('src')).toMatch(/\.webp$/);
  expect(fallback?.getAttribute('fetchpriority')).toBe('high');
  expect(fallback?.getAttribute('height')).toBe('1500');
});
