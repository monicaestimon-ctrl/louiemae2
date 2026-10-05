// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import type { Doc } from './_generated/dataModel';
import { refreshWorker } from './cjPricingReview';
import { pricingFingerprint, type CjPricingReview } from '../lib/cjPricingReview';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
// Inspect scheduled work without running provider actions in unit tests.
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
type ProductInput = Omit<Doc<'products'>, '_id' | '_creationTime'>;
const product: ProductInput = {
  name: 'Dress', description: 'A dress', images: ['dress.jpg'], category: 'dresses', collection: 'fashion',
  cjProductId: 'pid', cjSourcingStatus: 'approved', price: 80, storefrontStatus: 'hidden', productRevision: 2,
  variants: [
    { id: 'small', name: 'Small', cjVariantId: 'v1', cjSku: 's1', priceAdjustment: 0, inStock: true },
    { id: 'large', name: 'Large', cjVariantId: 'v2', cjSku: 's2', priceAdjustment: 0, inStock: true },
  ],
};
const review: CjPricingReview = {
  cjProductId: 'pid', checkedAt: Date.now(), destination: 'US', quantity: 1,
  quotes: [
    { vid: 'v1', sku: 's1', name: 'Small', itemCost: 10, shippingCost: 5, origin: 'CN', logisticsName: 'CJPacket' },
    { vid: 'v2', sku: 's2', name: 'Large', itemCost: 20, shippingCost: 8, origin: 'CN', logisticsName: 'CJPacket' },
  ],
};
async function setup(overrides: Partial<ProductInput> = {}) {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx => ctx.db.insert('products', { ...product, ...overrides }));
  const read = () => t.run(ctx => ctx.db.get(id));
  const save = async (options: { review?: CjPricingReview; allowReprice?: boolean; fingerprint?: string } = {}) =>
    t.mutation(makeFunctionReference<'mutation'>('cjPricingReview:save'), {
      productId: id, fingerprint: options.fingerprint ?? pricingFingerprint((await read())!), review, ...options,
    });
  return { t, id, read, save };
}

it('quotes freight using the documented inventory success envelope', async () => {
  const p = { ...product, _id: 'p', variants: [product.variants![0]] };
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  for (const json of [
    { result: true, data: { variants: [{ vid: 'v1', variantSku: 's1', variantSellPrice: 10 }] } },
    { success: true, code: 200, data: { variantInventories: [{ vid: 'v1', inventory: [{ countryCode: 'CN' }] }] } },
    { result: true, data: [{ logisticName: 'CJPacket', logisticPrice: 5 }] },
  ]) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(json)));
  const ctx = {
    runAction: vi.fn().mockResolvedValue('test-token'),
    runMutation: vi.fn().mockResolvedValueOnce(p)
      .mockResolvedValueOnce({ admitted: true, reservedAt: 0 })
      .mockResolvedValueOnce({ admitted: true, reservedAt: 0 })
      .mockResolvedValueOnce({ admitted: true, reservedAt: 0 })
      .mockResolvedValueOnce({ complete: true, repriced: false }),
  };
  try {
    const worker = (refreshWorker as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
    expect(await worker(ctx, { productId: 'p' })).toEqual({ complete: true, repriced: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(ctx.runMutation.mock.calls[4][1].review.quotes[0]).toMatchObject({ vid: 'v1', itemCost: 10, shippingCost: 5, origin: 'CN', logisticsName: 'CJPacket' });
  } finally { fetchMock.mockRestore(); }
});

describe('saving CJ quotes with transactional catalog maintenance', () => {
  it('automatically prices every unpublished variant from its own quote and updates the summary', async () => {
    const f = await setup();
    expect(await f.save({ allowReprice: true })).toEqual({ complete: true, repriced: true });
    expect(await f.read()).toMatchObject({ price: 24.99, productRevision: 3, variants: [{ priceAdjustment: 0 }, { priceAdjustment: 23 }] });
    expect(await f.t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ publicData: { price: 24.99, variants: [{ priceAdjustment: 0 }, { priceAdjustment: 23 }] } });
  });

  it.each<Partial<ProductInput>>([{ adminPriceLocked: true }, { storefrontStatus: 'published' }])('preserves locked or published retail prices: %j', async overrides => {
    const f = await setup(overrides);
    expect(await f.save({ allowReprice: true })).toMatchObject({ repriced: false });
    expect(await f.read()).toMatchObject({ price: 80, productRevision: 2, variants: [{ priceAdjustment: 0 }, { priceAdjustment: 0 }] });
  });

  it('does not apply partial quotes', async () => {
    const f = await setup();
    expect(await f.save({ review: { ...review, quotes: review.quotes.slice(0, 1) }, allowReprice: true })).toMatchObject({ repriced: false });
    expect((await f.read())?.price).toBe(80);
  });

  it('rejects concurrent mapping or price changes without changing either record', async () => {
    const f = await setup({ price: 90 });
    await expect(f.save({ fingerprint: pricingFingerprint(product) })).rejects.toThrow('changed');
    expect((await f.read())?.price).toBe(90);
    expect(await f.t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
  });
});

describe('daily price monitoring', () => {
  it('compares to the last complete quote after an intervening partial failure', async () => {
    const f = await setup({ cjPricingBaseline: review, cjPricingReview: { ...review, quotes: [] } });
    await f.save({ review: { ...review, quotes: review.quotes.map(q => ({ ...q, shippingCost: q.shippingCost! + 2 })) }, allowReprice: false });
    expect((await f.read())?.cjPricingAlert?.message).toContain('$15.00 → $17.00');
  });

  it('alerts on supplier cost changes without repricing unpublished products', async () => {
    const f = await setup({ cjPricingReview: review });
    await f.save({ review: { ...review, quotes: review.quotes.map(q => ({ ...q, itemCost: q.itemCost! + 1 })) }, allowReprice: false });
    expect((await f.read())?.cjPricingAlert?.message).toContain('$10.00 → $11.00');
    expect((await f.read())?.price).toBe(80);
  });

  it('preserves unacknowledged alerts through unchanged successful checks', async () => {
    const f = await setup({ cjPricingReview: review, cjPricingAlert: { at: 1, message: 'Previous change' } });
    await f.save({ allowReprice: false });
    expect((await f.read())?.cjPricingAlert?.message).toBe('Previous change');
  });

  it('bounds due batches and never schedules monitor repricing', async () => {
    const f = await setup({ cjPricingLastAttemptAt: 0 });
    await f.t.run(async ctx => { for (let i = 0; i < 11; i++) await ctx.db.insert('products', { ...product, cjPricingLastAttemptAt: 0 }); });
    expect(await f.t.mutation(makeFunctionReference<'mutation'>('cjPricingReview:dispatchMonitor'), {})).toEqual({ scheduled: 10 });
    const jobs = await f.t.run(ctx => ctx.db.system.query('_scheduled_functions').collect());
    expect(jobs).toHaveLength(10);
    for (const job of jobs) expect(job.args).toEqual([expect.objectContaining({ allowReprice: false })]);
  });

  it('prevents two workers from checking a product concurrently', async () => {
    const f = await setup();
    const claim = makeFunctionReference<'mutation'>('cjPricingReview:claim');
    expect(await f.t.mutation(claim, { productId: f.id, leaseToken: 'first' })).not.toBeNull();
    expect(await f.t.mutation(claim, { productId: f.id, leaseToken: 'second' })).toBeNull();
    expect((await f.read())?.cjPricingLeaseToken).toBe('first');
  });

  it('records errors visibly and ignores a stale worker failure', async () => {
    const f = await setup({ cjPricingLeaseToken: 'current' });
    const failed = makeFunctionReference<'mutation'>('cjPricingReview:failed');
    await f.t.mutation(failed, { productId: f.id, leaseToken: 'old', error: 'Timeout' });
    expect((await f.read())?.cjPricingError).toBeUndefined();
    await f.t.mutation(failed, { productId: f.id, leaseToken: 'current', error: 'Timeout' });
    expect(await f.read()).toMatchObject({ cjPricingError: 'Timeout', cjPricingAlert: { message: 'CJ price check failed: Timeout' } });
  });
});
