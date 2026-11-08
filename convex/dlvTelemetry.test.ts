// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { deliveryAlerts, monitoringReport } from './dlvTelemetry';
import { summarizeObservations } from '../lib/delivery/monitoring';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
afterEach(() => {
  delete process.env.BACKGROUND_MONITORING_ENABLED;
});

describe('durable delivery observations', () => {
  it('separates quotes and blocked requests from operational failures and computes nearest-rank p95', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      path: 'matrix' as const,
      outcome: i === 19 ? ('error' as const) : i === 18 ? ('blocked' as const) : ('quote' as const),
      durationMs: (i + 1) * 100,
    }));
    expect(summarizeObservations(rows)).toMatchObject({
      attempts: 20,
      quotes: 18,
      blocked: 1,
      errors: 1,
      errorRateBps: 500,
      p95Ms: 1900,
    });
    expect(summarizeObservations([])).toMatchObject({
      attempts: 0,
      p95Ms: null,
      errorRateBps: null,
    });
  });
  it('requires reviewed settings, sample minimums and the background switch before alerts', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sysConfig.seed, {});
    for (let i = 0; i < 19; i++)
      await t.mutation(internal.dlvTelemetry.record, {
        channel: 'retail',
        path: 'matrix_tax',
        outcome: i < 3 ? 'tax_error' : 'quote',
        durationMs: 9000,
      });
    expect(await t.run((ctx) => deliveryAlerts(ctx))).toEqual([]);
    await t.run(async (ctx) => {
      const p = await ctx.db
        .query('sysConfig')
        .withIndex('by_kind_key_version', (q) =>
          q.eq('kind', 'deliveryMonitoringPolicy').eq('key', 'delivery-monitoring')
        )
        .first();
      await ctx.db.patch(p!._id, { status: 'approved' });
    });
    expect(await t.run((ctx) => deliveryAlerts(ctx))).toEqual([]);
    process.env.BACKGROUND_MONITORING_ENABLED = 'true';
    expect(await t.run((ctx) => deliveryAlerts(ctx))).toEqual([]);
    await t.mutation(internal.dlvTelemetry.record, {
      channel: 'retail',
      path: 'matrix_tax',
      outcome: 'quote',
      durationMs: 9000,
    });
    await t.run((ctx) =>
      ctx.db.insert('sysReviewItems', {
        kind: 'actual_contribution_below_floor',
        entityTable: 'ordOrders',
        entityId: 'fixture',
        detail: 'Fixture floor breach',
        status: 'open',
        createdAt: Date.now(),
      })
    );
    const alerts = await t.run((ctx) => deliveryAlerts(ctx));
    expect(alerts.map((a) => a.key)).toEqual(
      expect.arrayContaining([
        'delivery_errors_matrix_tax',
        'delivery_latency_matrix_tax',
        'delivery_actual_contribution_below_floor',
      ])
    );
    const report = await t.run((ctx) => monitoringReport(ctx));
    expect(report.summary).toMatchObject({ attempts: 20, quotes: 17, taxErrors: 3 });
    expect(report.latestSampleAt).not.toBeNull();
    for (let i = 0; i < 20; i++)
      await t.mutation(internal.dlvTelemetry.record, {
        channel: 'trade',
        path: 'matrix',
        outcome: 'blocked',
        code: 'FORBIDDEN',
        durationMs: 10,
      });
    expect(
      (await t.run((ctx) => deliveryAlerts(ctx))).some(
        (a) => a.key === 'delivery_authorization_spike'
      )
    ).toBe(true);
    await expect(t.query(api.dlvTelemetry.report, {})).rejects.toThrow();
  });
  it('purges only expired operational observations in bounded batches', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 503; i++)
        await ctx.db.insert('dlvObservations', {
          createdAt: Date.now() - 8 * 86400000,
          durationMs: 10,
          channel: 'retail',
          path: 'matrix',
          outcome: 'ok',
          scopes: [],
        });
      await ctx.db.insert('sysAuditEvents', {
        actor: 'fixture',
        action: 'retained',
        entityTable: 'fixture',
        entityId: 'fixture',
        at: 1,
      });
    });
    await t.mutation(internal.dlvTelemetry.record, {
      channel: 'trade',
      path: 'matrix',
      outcome: 'quote',
      durationMs: 20,
    });
    expect(await t.mutation(internal.dlvTelemetry.purge, {})).toBe(500);
    expect(await t.mutation(internal.dlvTelemetry.purge, {})).toBe(3);
    expect(await t.run((ctx) => ctx.db.query('dlvObservations').collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query('sysAuditEvents').collect())).toHaveLength(1);
  });
});
