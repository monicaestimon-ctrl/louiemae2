import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  const readFile = vi.fn().mockResolvedValue('<html><head><title>Home</title><meta name="description" content="Home"><meta property="og:image" content="home"><link rel="canonical" href="https://louiemae.com"></head><body><!--home-document-start-->Home hero<!--home-document-end--><!--product-document--><div id="root"></div></body></html>');
  return { ...actual, readFile, default: { ...actual, readFile } };
});
import handler from '../../api/page';
const fetchMock = vi.fn();
const site = { story: { hero: { title: 'Our <Story>', subtitle: '& Purpose', image: 'javascript:bad' }, prologue: { quote: 'A beginning', subtext: 'Our story' }, chapters: { oneTitle: 'First chapter', oneText: 'Public chapter text' } },
  home: { categoryImages: { furniture: '/images/brand/DINNERTABLE.png' }, shop: { headerImage: '/images/brand/DINNERTABLE.png' } }, privateCost: 12345 };
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_CONVEX_URL', 'https://public-fixture.convex.cloud'); vi.stubEnv('VITE_PRELAUNCH_MODE', 'false'); fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', value: site }) }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function request(id: unknown, method = 'GET') {
  const result = { status: 0, body: '', headers: {} as Record<string, string> };
  const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; }, status(code: number) { result.status = code; return this; }, send(body: string) { result.body = body; }, redirect(code: number, location: string) { result.status = code; result.headers.Location = location; } };
  await handler({ method, query: { id, ref: 'PARTNER' } } as unknown as VercelRequest, res as unknown as VercelResponse);
  return result;
}
it('serves public story text and safe metadata without redirecting or leaking unrelated fields', async () => {
  const result = await request('story');
  expect(result.status).toBe(200); expect(result.body).toContain('Our &lt;Story&gt; &amp; Purpose');
  expect(result.body).toContain('Public chapter text'); expect(result.body).toContain('href="https://louiemae.com/story"');
  for (const text of ['privateCost', '12345', 'javascript:bad', 'http-equiv="refresh"', 'Home hero']) expect(result.body).not.toContain(text);
  const options = fetchMock.mock.calls[0][1];
  expect(options.headers.Authorization).toBeUndefined(); expect(JSON.parse(options.body).path).toBe('siteContent:get');
});
it('provides native shop collection links and handles HEAD without a body', async () => {
  const result = await request('shop'); expect(result.status).toBe(200);
  expect(result.body).toContain('href="/collection/furniture"'); expect(result.body).toContain('href="/blog"');
  expect((await request('shop', 'HEAD')).body).toBe('');
});
it('rejects invalid paths and business methods before public reads', async () => {
  expect((await request(['story'])).status).toBe(404); expect((await request('missing')).status).toBe(404);
  expect((await request('shop', 'POST')).status).toBe(405); expect(fetchMock).not.toHaveBeenCalled();
});
it('keeps source failure distinct from a valid empty story', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', value: null }) });
  const result = await request('story'); expect(result.status).toBe(503); expect(result.headers['X-Robots-Tag']).toBe('noindex'); expect(result.headers['Retry-After']).toBe('60');
});
