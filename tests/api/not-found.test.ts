import { expect, it } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/not-found';
import config from '../../vercel.json';

function request(method: string) {
  const result = { status: 0, body: '', headers: {} as Record<string, string> };
  const res = { setHeader(key: string, value: string) { result.headers[key] = value; }, status(code: number) { result.status = code; return this; }, send(body: string) { result.body = body; } };
  handler({ method, url: '/missing?<script>alert(1)</script>' } as VercelRequest, res as unknown as VercelResponse);
  return result;
}
it('returns an independent noindex 404 with working recovery links and no reflected URL', () => {
  const result = request('GET');
  expect(result.status).toBe(404);
  expect(result.headers['X-Robots-Tag']).toBe('noindex');
  expect(result.headers['Cache-Control']).toBe('no-store');
  expect(result.body).toContain('href="/shop"');
  expect(result.body).toContain('<main>');
  expect(result.body).not.toContain('<script');
  expect(result.body).not.toContain('/missing');
  expect(request('HEAD')).toMatchObject({ status: 404, body: '' });
  expect(request('POST')).toMatchObject({ status: 405, headers: { Allow: 'GET, HEAD' } });
});
it('preserves the known application entry points before the unknown-path fallback', () => {
  expect(config.rewrites.at(-1)).toEqual({ source: '/((?!api).*)', destination: '/api/not-found' });
  expect(config.rewrites).toContainEqual({ source: '/admin', destination: '/index.html' });
  expect(config.rewrites).toContainEqual({ source: '/r/:linkId([a-z0-9]{8,24})', destination: '/index.html' });
  expect(config.rewrites).toContainEqual({ source: '/trade', destination: '/trade/index.html' });
});
