// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const origin = 'https://www.louiemae.com',
  batch = {
    version: 1,
    documentToken: 'a'.repeat(32),
    release: 'b'.repeat(40),
    route: 'retail-home',
    device: 'mobile',
    samples: [{ name: 'LCP', value: 2100, revision: 1 }],
  };
const options = (body: unknown = batch, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
beforeEach(() => vi.stubEnv('FIELD_QUALITY_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());
it('exposes only uncached enablement and never accepts credential-bearing configuration requests', async () => {
  const t = convexTest(schema, modules);
  const r = await t.fetch('/quality/config', { headers: { Origin: origin } });
  expect(await r.json()).toEqual({ enabled: true });
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(r.headers.get('access-control-allow-origin')).toBe(origin);
  expect((await t.fetch('/quality/config', { headers: { Cookie: 'private=value' } })).status).toBe(
    400
  );
});
it('rejects absent/unapproved origins and explicit credentials without creating data', async () => {
  const t = convexTest(schema, modules);
  const rejectedHeaders: Record<string, string>[] = [
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
    { Authorization: 'Bearer private' },
    { Cookie: 'session=private' },
  ];
  for (const headers of rejectedHeaders)
    expect((await t.fetch('/quality', options(batch, headers))).status).toBeGreaterThanOrEqual(400);
  expect(
    (
      await t.fetch('/quality', {
        method: 'POST',
        body: JSON.stringify(batch),
        headers: { 'Content-Type': 'application/json' },
      })
    ).status
  ).toBe(403);
  expect(await t.run((ctx) => ctx.db.query('qualityVisits').collect())).toEqual([]);
});
it('supports a narrow credential-free preflight', async () => {
  const t = convexTest(schema, modules);
  const r = await t.fetch('/quality', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  expect(r.status).toBe(204);
  expect(r.headers.get('access-control-allow-credentials')).toBeNull();
  expect(r.headers.get('access-control-allow-headers')).toBe('Content-Type');
  expect(
    (await t.fetch('/quality', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }))
      .status
  ).toBe(403);
});
it('stores one bounded visit and returns no individual measurement data', async () => {
  const t = convexTest(schema, modules);
  const r = await t.fetch('/quality', options());
  expect(r.status).toBe(204);
  expect(await r.text()).toBe('');
  expect((await t.fetch('/quality', options())).status).toBe(204);
  const rows = await t.run((ctx) => ctx.db.query('qualityVisits').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].samples).toEqual(batch.samples);
});
it('rejects private, oversized or malformed payloads and respects the kill switch', async () => {
  const t = convexTest(schema, modules);
  for (const body of [{ ...batch, email: 'private@example.com' }, ' '.repeat(2049), '{'])
    expect((await t.fetch('/quality', options(body))).status).toBe(400);
  vi.stubEnv('FIELD_QUALITY_ENABLED', '');
  expect((await t.fetch('/quality', options())).status).toBe(503);
  expect(await t.run((ctx) => ctx.db.query('qualityVisits').collect())).toEqual([]);
});
it('returns a bounded budget rejection without exposing storage records', async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert('qualityBudgets', {
      day: Math.floor(Date.now() / 86400000),
      requests: 5000,
      visits: 0,
    })
  );
  const r = await t.fetch('/quality', options());
  expect(r.status).toBe(429);
  expect(await r.json()).toEqual({ status: 'limited' });
});
