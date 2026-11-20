import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '../../lib/serverHttp.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = vi
    .fn()
    .mockResolvedValue(
      '<html><head><title>Home</title></head><body><!--product-document--><div id="root"></div></body></html>'
    );
  return { ...actual, readFile, default: { ...actual, readFile } };
});
import handler from '../../api/product';
const fetchMock = vi.fn();
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
async function request(query: Record<string, unknown>, method = 'GET') {
  const headers: Record<string, string> = {};
  const response = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    redirect: vi.fn(),
    setHeader: (key: string, value: string) => {
      headers[key] = value;
    },
  };
  await handler(
    { query, method } as unknown as VercelRequest,
    response as unknown as VercelResponse
  );
  return { ...response, headers };
}
it('distinguishes a confirmed missing product from backend failure', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ status: 'success', value: null }),
  });
  expect((await request({ id: 'missing' })).status).toHaveBeenCalledWith(404);
  fetchMock.mockRejectedValueOnce(new Error('Unavailable'));
  const failed = await request({ id: 'valid' });
  expect(failed.status).toHaveBeenCalledWith(503);
  expect(failed.headers['Retry-After']).toBe('60');
  expect(failed.headers['Cache-Control']).toBe('no-store');
  expect(failed.headers['X-Robots-Tag']).toBe('noindex');
});
it('reads only the anonymous public query and returns real product content', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      status: 'success',
      value: {
        _id: 'fixture',
        name: 'Chair',
        price: 10,
        description: 'Oak',
        category: 'Furniture',
        collection: 'furniture',
        supplierCost: 2,
        tradePrice: 8,
        images: [],
        inStock: false,
      },
    }),
  });
  const response = await request({ id: 'fixture' });
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.send.mock.calls[0][0]).toContain('Currently unavailable');
  expect(response.send.mock.calls[0][0]).toContain('id="lm-product-bootstrap"');
  expect(response.send.mock.calls[0][0]).not.toContain('supplierCost');
  expect(response.send.mock.calls[0][0]).not.toContain('tradePrice');
  const options = fetchMock.mock.calls[0][1];
  expect(JSON.parse(options.body)).toEqual({
    path: 'products:getStorefrontDetail',
    args: { id: 'fixture' },
    format: 'json',
  });
  expect(options.headers.Authorization).toBeUndefined();
  expect((await request({ id: 'fixture' }, 'HEAD')).send).toHaveBeenCalledWith('');
});
it('rejects malformed requests without querying the catalog', async () => {
  expect((await request({ id: ['one', 'two'] })).status).toHaveBeenCalledWith(404);
  expect((await request({ id: '../private' })).status).toHaveBeenCalledWith(404);
  expect((await request({ id: 'fixture' }, 'POST')).status).toHaveBeenCalledWith(405);
  expect(fetchMock).not.toHaveBeenCalled();
});

