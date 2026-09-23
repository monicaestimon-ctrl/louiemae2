import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./auth', () => ({ auth: { getUserId: vi.fn() } }));
import { save, dispatchMonitor, claim, failed, refreshWorker } from './cjPricingReview';
import { pricingFingerprint, type CjPricingReview } from '../lib/cjPricingReview';
const handler = (save as unknown as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
const review: CjPricingReview = {
  cjProductId: 'pid',
  checkedAt: Date.now(),
  destination: 'US',
  quantity: 1,
  quotes: [
    {
      vid: 'v1',
      sku: 's1',
      name: 'Small',
      itemCost: 10,
      shippingCost: 5,
      origin: 'CN',
      logisticsName: 'CJPacket',
    },
    {
      vid: 'v2',
      sku: 's2',
      name: 'Large',
      itemCost: 20,
      shippingCost: 8,
      origin: 'CN',
      logisticsName: 'CJPacket',
    },
  ],
};
const product = {
  _id: 'p',
  cjProductId: 'pid',
  cjSourcingStatus: 'approved',
  price: 80,
  storefrontStatus: 'hidden',
  productRevision: 2,
  variants: [
    {
      id: 'small',
      name: 'Small',
      cjVariantId: 'v1',
      cjSku: 's1',
      priceAdjustment: 0,
      inStock: true,
    },
    {
      id: 'large',
      name: 'Large',
      cjVariantId: 'v2',
      cjSku: 's2',
      priceAdjustment: 0,
      inStock: true,
    },
  ],
};
beforeEach(() => vi.clearAllMocks());
it('quotes freight using the documented inventory success envelope', async () => {
  const p = { ...product, variants: [product.variants[0]] };
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  const responses = [
    { result: true, data: { variants: [{ vid: 'v1', variantSku: 's1', variantSellPrice: 10 }] } },
    { success: true, code: 200, data: { variantInventories: [{ vid: 'v1', inventory: [{ countryCode: 'CN' }] }] } },
    { result: true, data: [{ logisticName: 'CJPacket', logisticPrice: 5 }] },
  ];
  for (const json of responses) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(json)));
  const ctx = {
    runAction: vi.fn().mockResolvedValue('test-token'),
    runMutation: vi.fn()
      .mockResolvedValueOnce(p)
      .mockResolvedValueOnce({ admitted: true, reservedAt: 0 })
      .mockResolvedValueOnce({ admitted: true, reservedAt: 0 })
      .mockResolvedValueOnce({ admitted: true, reservedAt: 0 })
      .mockResolvedValueOnce({ complete: true, repriced: false }),
  };
  try {
    const worker = (refreshWorker as unknown as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
    expect(await worker(ctx, { productId: 'p' })).toEqual({ complete: true, repriced: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(ctx.runMutation.mock.calls[4][1].review.quotes[0]).toMatchObject({
      vid: 'v1', itemCost: 10, shippingCost: 5, origin: 'CN', logisticsName: 'CJPacket',
    });
  } finally {
    fetchMock.mockRestore();
  }
});
describe('saving CJ quotes', () => {
  it('automatically prices every unpublished variant from its own quote', async () => {
    const ctx = { db: { get: vi.fn().mockResolvedValue(product), patch: vi.fn() } };
    expect(
      await handler(ctx, {
        productId: 'p',
        fingerprint: pricingFingerprint(product),
        review,
        allowReprice: true,
      })
    ).toEqual({ complete: true, repriced: true });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({
        price: 24.99,
        variants: [
          expect.objectContaining({ priceAdjustment: 0 }),
          expect.objectContaining({ priceAdjustment: 23 }),
        ],
        productRevision: 3,
      })
    );
  });
  it.each([
    { ...product, adminPriceLocked: true },
    { ...product, storefrontStatus: 'published' },
  ])('preserves locked or published retail prices', async (p) => {
    const ctx = { db: { get: vi.fn().mockResolvedValue(p), patch: vi.fn() } };
    const result = await handler(ctx, {
      productId: 'p',
      fingerprint: pricingFingerprint(p),
      review,
      allowReprice: true,
    });
    expect(result.repriced).toBe(false);
    expect(ctx.db.patch.mock.calls[0][1]).not.toHaveProperty('price');
  });
  it('does not apply partial quotes', async () => {
    const ctx = { db: { get: vi.fn().mockResolvedValue(product), patch: vi.fn() } };
    expect(
      (
        await handler(ctx, {
          productId: 'p',
          fingerprint: pricingFingerprint(product),
          review: { ...review, quotes: review.quotes.slice(0, 1) },
        })
      ).repriced
    ).toBe(false);
  });
  it('rejects concurrent mapping or price changes', async () => {
    const ctx = {
      db: { get: vi.fn().mockResolvedValue({ ...product, price: 90 }), patch: vi.fn() },
    };
    await expect(
      handler(ctx, { productId: 'p', fingerprint: pricingFingerprint(product), review })
    ).rejects.toThrow('changed');
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

const run = (fn: unknown, ctx: any, args: any) =>
  (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler(ctx, args);
describe('daily price monitoring', () => {
  it('compares to the last complete quote after an intervening partial failure', async () => {
    const p = { ...product, cjPricingBaseline: review, cjPricingReview: { ...review, quotes: [] } };
    const ctx = { db: { get: vi.fn().mockResolvedValue(p), patch: vi.fn() } };
    await handler(ctx, {
      productId: 'p',
      fingerprint: pricingFingerprint(p),
      review: {
        ...review,
        quotes: review.quotes.map((q) => ({ ...q, shippingCost: q.shippingCost! + 2 })),
      },
      allowReprice: false,
    });
    expect(ctx.db.patch.mock.calls[0][1].cjPricingAlert.message).toContain('$15.00 → $17.00');
  });
  it('alerts on supplier cost changes without repricing even unpublished products', async () => {
    const p = { ...product, cjPricingReview: review };
    const ctx = { db: { get: vi.fn().mockResolvedValue(p), patch: vi.fn() } };
    await handler(ctx, {
      productId: 'p',
      fingerprint: pricingFingerprint(p),
      review: {
        ...review,
        quotes: review.quotes.map((q) => ({ ...q, itemCost: q.itemCost! + 1 })),
      },
      allowReprice: false,
    });
    const update = ctx.db.patch.mock.calls[0][1];
    expect(update.cjPricingAlert.message).toContain('$10.00 → $11.00');
    expect(update).not.toHaveProperty('price');
  });
  it('preserves unacknowledged alerts through unchanged successful checks', async () => {
    const p = {
      ...product,
      cjPricingReview: review,
      cjPricingAlert: { at: 1, message: 'Previous change' },
    };
    const ctx = { db: { get: vi.fn().mockResolvedValue(p), patch: vi.fn() } };
    await handler(ctx, {
      productId: 'p',
      fingerprint: pricingFingerprint(p),
      review,
      allowReprice: false,
    });
    expect(ctx.db.patch.mock.calls[0][1]).not.toHaveProperty('cjPricingAlert');
  });
  it('bounds scheduled batches and does not permit monitor repricing', async () => {
    const take = vi.fn().mockResolvedValue([{ ...product }]);
    const range = { eq: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis() };
    const ctx = {
      db: {
        query: () => ({
          withIndex: (_: string, fn: any) => {
            fn(range);
            return { take };
          },
        }),
        patch: vi.fn(),
      },
      scheduler: { runAfter: vi.fn() },
    };
    expect(await run(dispatchMonitor, ctx, {})).toEqual({ scheduled: 1 });
    expect(take).toHaveBeenCalledWith(10);
    expect(range.eq).toHaveBeenCalledWith('cjSourcingStatus', 'approved');
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      productId: 'p',
      allowReprice: false,
    });
  });
  it('prevents two workers from checking a product concurrently', async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({ ...product, cjPricingLeaseUntil: Date.now() + 10000 }),
        patch: vi.fn(),
      },
    };
    expect(await run(claim, ctx, { productId: 'p', leaseToken: 'new' })).toBeNull();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it('records errors visibly and ignores a stale worker failure', async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({ ...product, cjPricingLeaseToken: 'current' }),
        patch: vi.fn(),
      },
    };
    await run(failed, ctx, { productId: 'p', leaseToken: 'old', error: 'Timeout' });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    await run(failed, ctx, { productId: 'p', leaseToken: 'current', error: 'Timeout' });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({
        cjPricingError: 'Timeout',
        cjPricingAlert: expect.objectContaining({ message: 'CJ price check failed: Timeout' }),
      })
    );
  });
});
