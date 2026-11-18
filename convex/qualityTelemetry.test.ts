// @vitest-environment node
/// <reference types="vite/client" />
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { requireDeliveryRole } from './dlvAccess';
vi.mock('./dlvAccess', () => ({
  requireDeliveryRole: vi.fn(async () => ({ email: 'staff@example.com' })),
}));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const batch = {
  version: 1,
  documentToken: 'a'.repeat(32),
  release: 'b'.repeat(40),
  route: 'retail-home' as const,
  device: 'mobile' as const,
  samples: [{ name: 'LCP', value: 2100, revision: 1 }],
};
const segment = { route: batch.route, device: batch.device, release: batch.release };
beforeEach(() => {
  vi.stubEnv('FIELD_QUALITY_ENABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('is disabled by default and rejects extra private fields', async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv('FIELD_QUALITY_ENABLED', '');
  expect(
    await t.mutation(internal.qualityTelemetry.record, { payload: JSON.stringify(batch) })
  ).toEqual({ status: 'disabled' });
  vi.stubEnv('FIELD_QUALITY_ENABLED', 'true');
  for (const payload of [
    '{',
    JSON.stringify({ ...batch, email: 'private@example.com' }),
    ' '.repeat(2049),
  ])
    expect(await t.mutation(internal.qualityTelemetry.record, { payload })).toEqual({
      status: 'invalid',
    });
  expect(await t.run((ctx) => ctx.db.query('qualityVisits').collect())).toEqual([]);
});
it('deduplicates revisions and does not move a visit between segments', async () => {
  const t = convexTest(schema, modules);
  const record = (value: unknown) =>
    t.mutation(internal.qualityTelemetry.record, { payload: JSON.stringify(value) });
  await record(batch);
  expect(await record(batch)).toEqual({ status: 'duplicate' });
  await record({ ...batch, samples: [{ name: 'LCP', value: 2200, revision: 2 }] });
  await record(batch);
  expect(await record({ ...batch, release: 'c'.repeat(40) })).toEqual({ status: 'conflict' });
  const rows = await t.run((ctx) => ctx.db.query('qualityVisits').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].samples).toEqual([{ name: 'LCP', value: 2200, revision: 2 }]);
  expect(rows[0].release).toBe(batch.release);
});
it('bounds daily requests and new visits without adding records', async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert('qualityBudgets', {
      day: Math.floor(Date.now() / 86400000),
      requests: 5000,
      visits: 0,
    })
  );
  expect(
    await t.mutation(internal.qualityTelemetry.record, { payload: JSON.stringify(batch) })
  ).toEqual({ status: 'limited' });
  await t.run((ctx) => ctx.db.patch(id, { requests: 1, visits: 1000 }));
  expect(
    await t.mutation(internal.qualityTelemetry.record, { payload: JSON.stringify(batch) })
  ).toEqual({ status: 'limited' });
  expect(await t.run((ctx) => ctx.db.query('qualityVisits').collect())).toEqual([]);
});
it('reports missing INP as insufficient data and never returns document identifiers', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.qualityTelemetry.record, { payload: JSON.stringify(batch) });
  const result = await t.query(api.qualityTelemetry.summary, segment);
  expect(result.visits).toBe(1);
  expect(result.metrics.find((m) => m.name === 'INP')).toMatchObject({
    count: 0,
    p75: null,
    status: 'insufficient-data',
  });
  expect(JSON.stringify(result)).not.toContain(batch.documentToken);
  expect(JSON.stringify(result)).not.toContain('samples');
});
it('requires engineering access before reading summaries', async () => {
  const t = convexTest(schema, modules);
  vi.mocked(requireDeliveryRole).mockRejectedValueOnce(Error('Forbidden'));
  await expect(t.query(api.qualityTelemetry.summary, segment)).rejects.toThrow('Forbidden');
});
it('purges bounded expired visits without deleting live records, even when disabled', async () => {
  const t = convexTest(schema, modules);
  const now = Date.now(),
    expired = now - 29 * 86400000;
  await t.run(async (ctx) => {
    for (let i = 0; i < 501; i++)
      await ctx.db.insert('qualityVisits', {
        ...segment,
        documentToken: i.toString(16).padStart(32, '0'),
        createdAt: expired,
        updatedAt: now,
        samples: [],
      });
    await ctx.db.insert('qualityVisits', {
      ...segment,
      documentToken: 'f'.repeat(32),
      createdAt: now,
      updatedAt: now,
      samples: [],
    });
  });
  expect(await t.query(api.qualityTelemetry.summary, segment)).toMatchObject({
    visits: 1,
    retentionBacklog: true,
    oldestExpiredAt: expired,
  });
  vi.stubEnv('FIELD_QUALITY_ENABLED', '');
  expect(await t.mutation(internal.qualityTelemetry.purge, {})).toMatchObject({
    visits: 500,
    morePossible: true,
  });
  expect(await t.run((ctx) => ctx.db.query('qualityVisits').collect())).toHaveLength(2);
  expect(await t.mutation(internal.qualityTelemetry.purge, {})).toMatchObject({
    visits: 1,
    morePossible: false,
  });
  const rows = await t.run((ctx) => ctx.db.query('qualityVisits').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].createdAt).toBe(now);
  expect(await t.query(api.qualityTelemetry.summary, segment)).toMatchObject({
    visits: 1,
    retentionBacklog: false,
    oldestExpiredAt: null,
  });
});
it('marks bounded summaries as truncated rather than claiming a passing population', async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    for (let i = 0; i < 5001; i++)
      await ctx.db.insert('qualityVisits', {
        ...segment,
        documentToken: i.toString(16).padStart(32, '0'),
        createdAt: now - i * 60000,
        updatedAt: now,
        samples: [{ name: 'LCP', value: 1000, revision: 1 }],
      });
  });
  const result = await t.query(api.qualityTelemetry.summary, segment);
  expect(result.visits).toBe(5000);
  expect(result.truncated).toBe(true);
  expect(result.metrics.find((m) => m.name === 'LCP')).toMatchObject({
    count: 5000,
    p75: 1000,
    status: 'truncated',
  });
});

it('does not label an apparently healthy sample as complete after collection hit a budget', async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    for (let i = 0; i < 50; i++)
      await ctx.db.insert('qualityVisits', {
        ...segment,
        documentToken: i.toString(16).padStart(32, '0'),
        createdAt: now,
        updatedAt: now,
        samples: [{ name: 'LCP', value: 1000, revision: 1 }],
      });
    await ctx.db.insert('qualityBudgets', {
      day: Math.floor(now / 86400000) - 1,
      requests: 5000,
      visits: 100,
    });
  });
  const result = await t.query(api.qualityTelemetry.summary, segment);
  expect(result.collectionLimited).toBe(true);
  expect(result.limitedDays).toBe(1);
  expect(result.metrics.find((metric) => metric.name === 'LCP')?.status).toBe('collection-limited');
});
