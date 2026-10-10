// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import schema from './schema';
import type { Id } from './_generated/dataModel';
import { getInventoryByVid } from './cjApiClient';

vi.mock('./cjApiClient', async importOriginal => ({
  ...await importOriginal<typeof import('./cjApiClient')>(), getInventoryByVid: vi.fn(),
}));
const authorize = vi.fn();
const nestedRefresh = vi.fn(() => { throw Error('Nested inventory RPC must not run'); });
const modules = {
  ...import.meta.glob(['./**/*.ts', './_generated/*.js']),
  './cjAdminAccess.ts': async () => ({ ...await import('./cjAdminAccess'),
    verifyCjAdminIdentity: internalQuery({ args: {}, handler: authorize }),
  }),
  './cjDropshipping.ts': async () => ({ ...await import('./cjDropshipping'),
    getAccessToken: internalAction({ args: {}, handler: async () => 'fixture-token' }),
    refreshProductInventory: internalAction({ handler: nestedRefresh }),
  }),
  './cjHelpers.ts': async () => ({ ...await import('./cjHelpers'),
    reserveCjDiagnosticRequestSlot: internalMutation({ handler: async () => ({ waitMs: 0 }) }),
  }),
};
const refresh = makeFunctionReference<'action'>('cjActions:refreshInventory');
const fixture = { name: 'Chair', description: 'Chair', price: 50, images: ['chair.jpg'], category: 'chairs', collection: 'furniture',
  cjSourcingStatus: 'approved' as const, cjInventoryStatus: 'in_stock' as const, cjInventoryTotal: 9,
};
const success = { ok: true as const, data: [{ totalInventoryNum: 20 }], raw: { data: [{ totalInventoryNum: 20 }] }, httpStatus: 200 };
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({email:'admin@example.test'}); });
afterEach(() => vi.restoreAllMocks());

describe('public manual inventory refresh', () => {
  it('returns all 25 results after more than five minutes without a nested inventory RPC', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
      const ids: Id<'products'>[] = [];
      for (let i = 0; i < 26; i++) ids.push(await ctx.db.insert('products', { ...fixture, cjVariantId: `v-${i}` }));
      return ids;
    });
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(getInventoryByVid).mockImplementation(async () => { now += 17_000; return success; });
    const result = await t.action(refresh, {});
    expect(result).toMatchObject({ checked:25, updated:25, errors:0 });
    expect(new Set(result.products.map((p: {productId:string}) => p.productId)).size).toBe(25);
    expect(getInventoryByVid).toHaveBeenCalledTimes(25);
    expect(nestedRefresh).not.toHaveBeenCalled();
    const rows = await t.run(async ctx => Promise.all(ids.map(id => ctx.db.get(id))));
    expect(rows.filter(row => row?.cjInventoryTotal === 20)).toHaveLength(25);
    expect(rows.filter(row => row?.cjInventoryTotal === 9)).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query('cjInventoryPollRuns').first())).toMatchObject({
      source:'manual', checked:25, updated:25, errors:0, durationMs:425_000,
    });
  });

  it('preserves targeted refresh and provider failure reporting', async () => {
    const t=convexTest(schema,modules);
    const [selected,untouched]=await t.run(async ctx => [
      await ctx.db.insert('products',{...fixture,cjVariantId:'selected'}),
      await ctx.db.insert('products',{...fixture,cjVariantId:'untouched'}),
    ]);
    vi.mocked(getInventoryByVid).mockResolvedValue({ok:false,error:{code:12345,message:'Unavailable'}});
    expect(await t.action(refresh,{productId:selected})).toMatchObject({checked:1,updated:0,errors:1,
      products:[{productId:selected,status:'error'}]});
    expect(getInventoryByVid).toHaveBeenCalledExactlyOnceWith('fixture-token','selected');
    expect(await t.run(ctx=>ctx.db.get(untouched))).toMatchObject({cjInventoryTotal:9});
  });

  it('rejects unauthorized callers before any provider or inventory work', async () => {
    const t=convexTest(schema,modules);
    authorize.mockRejectedValue(new Error('You do not have permission to manage CJ fulfillment.'));
    await expect(t.action(refresh,{})).rejects.toThrow('permission');
    expect(getInventoryByVid).not.toHaveBeenCalled();
    expect(nestedRefresh).not.toHaveBeenCalled();
    expect(await t.run(ctx=>ctx.db.query('cjInventoryPollRuns').collect())).toEqual([]);
  });
});
