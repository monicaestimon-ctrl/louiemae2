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
import handler from '../../api/journal';
import editorialManifest from '../../lib/editorialImageManifest.json';
const fetchMock = vi.fn();

it('serves source-bound editorial renditions and leaves replacement uploads untouched', async () => {
  const [source, rendition] = Object.entries(editorialManifest)[0];
  for (const image of [source, `${source}-replacement`]) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', value: { ...article, image } }),
    });
    const result = await request('story1');
    expect(result.status).toBe(200);
    if (image === source) {
      expect(result.body).toContain(`${rendition.windows.articleMobile.base}-640.webp 640w`);
      expect(result.body).toContain('aspect-[16/9]');
      expect(result.body.indexOf('aspect-[16/9]')).toBeLessThan(result.body.indexOf('<h1'));
    } else {
      expect(result.body).toContain(`src="${image}"`);
      expect(result.body).not.toContain(rendition.base);
    }
  }
});

const article = {
  _id: 'story1',
  title: 'A <story>',
  excerpt: 'Public & thoughtful',
  contentHtml: '<p>A real story</p><script>attack()</script>',
  image: '/image.jpg',
  category: 'Home',
  date: 'November 17, 2026',
  status: 'published',
  privateNote: 'not-public',
};
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_CONVEX_URL', 'https://public-fixture.convex.cloud');
  vi.stubEnv('VITE_PRELAUNCH_MODE', 'false');
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function request(id?: unknown, method = 'GET') {
  const result = { status: 0, body: '', headers: {} as Record<string, string> };
  const res = {
    setHeader(key: string, value: string) {
      result.headers[key] = value;
    },
    status(code: number) {
      result.status = code;
      return this;
    },
    send(body: string) {
      result.body = body;
    },
  };
  await handler(
    { method, query: { id } } as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
  return result;
}
it('serves sanitized article text and direct canonical metadata from an anonymous detail query', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', value: article }),
  });
  const result = await request('story1');
  expect(result.status).toBe(200);
  expect(result.body).toContain('A &lt;story&gt;');
  expect(result.body).toContain('<p>A real story</p>');
  expect(result.body).toContain('https://www.louiemae.com/blog/story1');
  for (const value of ['attack()', 'not-public', 'Home hero', 'http-equiv="refresh"'])
    expect(result.body).not.toContain(value);
  const options = fetchMock.mock.calls[0][1];
  expect(options.headers.Authorization).toBeUndefined();
  expect(JSON.parse(options.body)).toMatchObject({
    path: 'blogPosts:publicDetail',
    args: { id: 'story1' },
  });
  expect((await request('story1', 'HEAD')).body).toBe('');
});
it('renders index links and a genuine empty archive distinctly from source failure', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ status: 'success', value: [article] }),
  });
  expect((await request()).body).toContain('href="/blog/story1"');
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ status: 'success', value: [] }),
  });
  const empty = await request();
  expect(empty.status).toBe(200);
  expect(empty.body).toContain('New stories are coming soon.');
  expect(empty.body).toContain('class="min-h-screen bg-cream flex items-center justify-center"');
  expect(empty.body).not.toContain('pt-32');
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  const failed = await request();
  expect(failed.status).toBe(503);
  expect(failed.headers['X-Robots-Tag']).toBe('noindex');
});
it('keeps archive metadata and image geometry in the initial public document', async () => {
  fetchMock.mockResolvedValue({ok:true,json:async()=>({status:'success',value:[article,{...article,_id:'story2',title:'Second story',category:'Second category',date:'November 18, 2026'}]})});
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.body).toContain('href="/blog/story2"');
  expect(result.body).toContain('Second category');
  expect(result.body).toContain('November 18, 2026');
  expect(result.body).toContain('aspect-[3/4]');
});
it('never publishes missing, draft, mismatched or malformed article records', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ status: 'success', value: null }),
  });
  expect((await request('story1')).status).toBe(404);
  for (const value of [
    { ...article, status: 'draft' },
    { ...article, _id: 'different' },
    { ...article, contentHtml: undefined },
  ]) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'success', value }) });
    expect((await request('story1')).status).toBe(503);
  }
  fetchMock.mockClear();
  expect((await request(['story1'])).status).toBe(404);
  expect((await request('../private')).status).toBe(404);
  expect((await request('story1', 'POST')).status).toBe(405);
  expect(fetchMock).not.toHaveBeenCalled();
});
