// @vitest-environment node
/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { internalAction, internalMutation } from './_generated/server';
import schema from './schema';
import { getInventoryByPid, getInventoryBySku, getInventoryByVid } from './cjApiClient';

vi.mock('./cjApiClient', async importOriginal => ({
  ...await importOriginal<typeof import('./cjApiClient')>(),
  getInventoryByVid: vi.fn(), getInventoryBySku: vi.fn(), getInventoryByPid: vi.fn(),
}));
const modules = {
  ...import.meta.glob(['./**/*.ts', './_generated/*.js']),
  './cjDropshipping.ts': async () => ({ ...await import('./cjDropshipping'),
    getAccessToken: internalAction({ args: {}, handler: async () => 'fixture-token' }),
  }),
  './cjHelpers.ts': async () => ({ ...await import('./cjHelpers'),
    reserveCjDiagnosticRequestSlot: internalMutation({ handler: async () => ({ waitMs: 0 }) }),
  }),
};
const refresh = makeFunctionReference<'action'>('cjDropshipping:refreshProductInventory');
const disabled = { ok: false as const, error: { code: 1600014, message: 'Your API access has been disabled.' } };
const success = { ok: true as const, data: [{ totalInventoryNum: 20 }], raw: { data: [{ totalInventoryNum: 20 }] }, httpStatus: 200 };
const fixture = { name: 'Chair', description: 'Chair', price: 50, images: ['chair.jpg'], category: 'chairs', collection: 'furniture',
  cjSourcingStatus: 'approved' as const, cjInventoryStatus: 'in_stock' as const, cjInventoryTotal: 9,
  cjInventoryLastCheckedAt: '2026-01-01T00:00:00.000Z', cjInventoryNextCheckAt: 0,
};
beforeEach(() => vi.resetAllMocks());

describe('inventory polling with disabled provider access', () => {
  it.each(['vid', 'sku', 'pid'] as const)('stops %s polling after one account failure without rewriting source inventory', async kind => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push(await ctx.db.insert('products', { ...fixture,
        ...(kind === 'vid' ? { cjVariants: [{ vid: `v-${i}`, sku: `s-${i}`, name: 'One' }, { vid: `v2-${i}`, sku: `s2-${i}`, name: 'Two' }] }
          : kind === 'sku' ? { cjSku: `sku-${i}` } : { cjProductId: `pid-${i}` }),
      }));
      return ids;
    });
    const before = await t.run(async ctx => Promise.all(ids.map(id => ctx.db.get(id))));
    const provider = kind === 'vid' ? getInventoryByVid : kind === 'sku' ? getInventoryBySku : getInventoryByPid;
    vi.mocked(provider).mockResolvedValue(disabled);
    expect(await t.action(refresh, { source: 'cron', limit: 3 })).toMatchObject({
      checked: 1, updated: 0, errors: 1, stoppedReason: 'provider_access_disabled', deferredProvider: 2,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await t.run(async ctx => Promise.all(ids.map(id => ctx.db.get(id))))).toEqual(before);
    expect(await t.run(ctx => ctx.db.query('cjInventoryPollRuns').first())).toMatchObject({
      checked: 1, errors: 1, stoppedReason: 'provider_access_disabled', deferredProvider: 2,
    });
  });

  it('keeps earlier completed products, preserves an incomplete product, and recovers on the next poll', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => [
      await ctx.db.insert('products', { ...fixture, cjVariantId: 'one' }),
      await ctx.db.insert('products', { ...fixture, cjVariants: [{ vid: 'two', sku: 's-two', name: 'Two' }, { vid: 'three', sku: 's-three', name: 'Three' }] }),
      await ctx.db.insert('products', { ...fixture, cjVariantId: 'four' }),
    ]);
    const beforeSecond = await t.run(ctx => ctx.db.get(ids[1]));
    vi.mocked(getInventoryByVid).mockResolvedValueOnce(success).mockResolvedValueOnce(success).mockResolvedValueOnce(disabled);
    expect(await t.action(refresh, { source: 'cron', limit: 3 })).toMatchObject({ checked: 2, updated: 1, errors: 1, deferredProvider: 1 });
    expect(getInventoryByVid).toHaveBeenCalledTimes(3);
    expect(await t.run(ctx => ctx.db.get(ids[0]))).toMatchObject({ cjInventoryTotal: 20 });
    expect(await t.run(ctx => ctx.db.get(ids[1]))).toEqual(beforeSecond);
    vi.mocked(getInventoryByVid).mockResolvedValue(success);
    expect(await t.action(refresh, { source: 'cron', limit: 3 })).toMatchObject({ checked: 2, updated: 2, errors: 0 });
    expect(await t.run(ctx => ctx.db.get(ids[1]))).toMatchObject({ cjInventoryTotal: 40 });
  });

  it('continues ordinary per-product failures and preserves manual refresh behavior', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 2; i++) await ctx.db.insert('products', { ...fixture, cjVariantId: `v-${i}` });
    });
    vi.mocked(getInventoryByVid).mockResolvedValue({ ok: false, error: { code: 12345, message: 'Product unavailable' } });
    expect(await t.action(refresh, { source: 'cron', limit: 2 })).toMatchObject({ checked: 2, errors: 2 });
    expect(getInventoryByVid).toHaveBeenCalledTimes(2);
    vi.mocked(getInventoryByVid).mockClear().mockResolvedValue(disabled);
    expect(await t.action(refresh, { source: 'manual', limit: 2 })).toMatchObject({ checked: 2, errors: 2 });
    expect(getInventoryByVid).toHaveBeenCalledTimes(2);
  });
});
