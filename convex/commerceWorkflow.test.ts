import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./cjAdminAccess', () => ({
  requireCjAdminIdentity: vi.fn(async () => ({ email: 'owner@example.com' })),
}));
import { paid, paymentHold, save as saveQuote, submit } from './commerceProjects';
import { prepare, review } from './commerceFulfillment';
import { save, publish, imported } from './commerce';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { blankCommerceDraft } from '../lib/commerce';
const handler = (fn: unknown) =>
  (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
function context(records: Record<string, any>) {
  const chain: any = {
    withIndex: () => chain,
    unique: vi.fn(async () => null),
    order: () => chain,
    take: vi.fn(async () => []),
  };
  return {
    db: {
      get: vi.fn(async (id: string) => records[id] || null),
      patch: vi.fn(async (id: string, patch: any) => {
        records[id] = { ...records[id], ...patch };
      }),
      insert: vi.fn(async (_table: string, _doc: any) => 'new-id'),
      query: vi.fn(() => chain),
    },
    scheduler: { runAfter: vi.fn(async () => {}) },
    chain,
  };
}
const line = (provider: string) => ({
  productId: 'product',
  variantId: 'v',
  name: 'Chair',
  variantName: 'Walnut',
  quantity: 15,
  unitPrice: 10000,
  provider,
  sku: 'sku',
});
const project = () => ({
  _id: 'p',
  revision: 2,
  stripeInvoiceId: 'in_test',
  lines: [line('cj'), line('ashcroft'), line('owner_managed')],
  delivery: 2500,
  tax: 1500,
  status: 'invoiced',
});
describe('commerce payment and provider routing', () => {
  it('holds linked supplier orders after a reversal and does not release on a replayed paid event', async () => {
    const records = {
      p: { ...project(), status: 'paid', paidAt: Date.now() },
      g: { _id: 'g', projectId: 'p', provider: 'cj', orderId: 'o', status: 'submitted' },
      o: { _id: 'o' },
    };
    const ctx = context(records);
    ctx.chain.collect = vi
      .fn()
      .mockResolvedValueOnce([{ projectId: 'p' }])
      .mockResolvedValueOnce([records.g]);
    await handler(paymentHold)(ctx, { paymentIntentId: 'pi_test' });
    expect(records.p.status).toBe('payment_review');
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'o',
      expect.objectContaining({ commercialHold: expect.stringContaining('refund or dispute') })
    );
    await handler(paid)(ctx, {
      id: 'p',
      revision: 2,
      invoiceId: 'in_test',
      amount: 454000,
      currency: 'usd',
      paymentIntentIds: ['pi_test'],
    });
    expect(records.p.status).toBe('payment_review');
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
  beforeEach(() =>
    vi.mocked(requireCjAdminIdentity).mockResolvedValue({ email: 'owner@example.com' })
  );
  it('routes a verified payment once; schedules only CJ and leaves both manual providers manual', async () => {
    const p = project(),
      ctx = context({ p });
    const event = {
      id: 'p',
      revision: 2,
      invoiceId: 'in_test',
      amount: 454000,
      currency: 'usd',
      paymentIntentIds: ['pi_test'],
    };
    await handler(paid)(ctx, event);
    await handler(paid)(ctx, event);
    expect(ctx.db.insert.mock.calls.filter((c) => c[0] === 'commerceFulfillments')).toHaveLength(3);
    expect(
      ctx.db.insert.mock.calls
        .filter((c) => c[0] === 'commerceFulfillments')
        .map((c) => c[1].status)
    ).toEqual(['queued', 'needs_dealer_order', 'owner_managed']);
    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1);
  });
  it.each([
    { revision: 1 },
    { amount: 1 },
    { invoiceId: 'old' },
    { currency: 'eur' },
    { paymentIntentIds: [] },
  ])('rejects mismatched or unsupported payment %j', async (bad) => {
    const ctx = context({ p: project() });
    await expect(
      handler(paid)(ctx, {
        id: 'p',
        revision: 2,
        invoiceId: 'in_test',
        amount: 454000,
        currency: 'usd',
        paymentIntentIds: ['pi_test'],
        ...bad,
      })
    ).rejects.toThrow('match');
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
  it('does not dispatch Ashcroft, managed, or unpaid CJ groups', async () => {
    for (const provider of ['ashcroft', 'owner_managed']) {
      const ctx = context({ g: { provider, status: 'queued' } });
      expect(await handler(prepare)(ctx, { id: 'g' })).toBeNull();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    }
    const ctx = context({ g: { provider: 'cj', status: 'queued', projectId: 'p' }, p: project() });
    await expect(handler(prepare)(ctx, { id: 'g' })).rejects.toThrow('payment');
  });
  it.each([15, 30])(
    'checks the exact paid variant quantity against CJ stock (%i chairs)',
    async (quantity) => {
      vi.stubEnv('CJ_AUTO_FULFILLMENT_ENABLED', 'true');
      vi.stubEnv('CJ_AUTO_BALANCE_PAY_ENABLED', 'true');
      const product = {
        _id: 'legacy',
        name: 'Chair',
        inStock: true,
        cjSourcingStatus: 'approved',
        cjSourcingJobId: 'job',
        cjSourcingState: 'fulfillment_ready',
        cjFulfillmentReadiness: 'ready',
        cjProductId: 'cj-product',
        variants: [{ id: 'v', name: 'Walnut', inStock: true, cjVariantId: 'vid', cjSku: 'sku' }],
        cjInventoryByVariant: [
          {
            vid: 'vid',
            sku: 'sku',
            status: 'in_stock',
            totalInventoryNum: 20,
            lastCheckedAt: new Date().toISOString(),
            lowStockThreshold: 5,
          },
        ],
      };
      const ctx = context({
        g: { _id: 'g', provider: 'cj', status: 'queued', projectId: 'p' },
        p: {
          ...project(),
          paidAt: Date.now(),
          status: 'paid',
          lines: [
            { ...line('cj'), quantity, cjProductId: 'legacy', cjVariantId: 'vid', cjSku: 'sku' },
          ],
          maxCjCost: 200000,
          cjLogistics: 'Reviewed service',
          cjApprovedUntil: Date.now() + 600000,
        },
        legacy: product,
      });
      const result = await handler(prepare)(ctx, { id: 'g' });
      if (quantity === 15) {
        expect(result.items).toEqual([
          expect.objectContaining({
            variantId: 'v',
            cjVariantId: 'vid',
            cjSku: 'sku',
            quantity: 15,
          }),
        ]);
        expect(ctx.db.insert).toHaveBeenCalledWith(
          'orders',
          expect.objectContaining({
            stripeInvoiceId: 'in_test',
            commercialMaxSupplierCents: 200000,
            items: result.items,
          })
        );
      } else {
        expect(result).toBeNull();
        expect(ctx.db.insert).not.toHaveBeenCalled();
      }
    }
  );
  it('holds a mixed project before creating a supplier order', async () => {
    const ctx = context({
      g: { _id: 'g', provider: 'cj', status: 'queued', projectId: 'p' },
      p: { ...project(), paidAt: 1, status: 'paid' },
    });
    expect(await handler(prepare)(ctx, { id: 'g' })).toBeNull();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'g',
      expect.objectContaining({ status: 'needs_attention' })
    );
  });
  it('rejects quote edits after invoicing and stale product edits', async () => {
    await expect(
      handler(saveQuote)(context({ p: project() }), { id: 'p', revision: 2 })
    ).rejects.toThrow('invoice');
    await expect(
      handler(save)(context({ p: { revision: 2 } }), { id: 'p', revision: 1 })
    ).rejects.toThrow('changed');
  });
  it('cannot repair mappings after a supplier order attempt exists', async () => {
    const ctx = context({
      g: { provider: 'cj', projectId: 'p', status: 'needs_attention', orderId: 'order' },
      p: { ...project(), paidAt: 1 },
    });
    await expect(handler(review)(ctx, { id: 'g' })).rejects.toThrow('existing CJ attempt');
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it('requires authorization before product publication', async () => {
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Unauthorized'));
    const ctx = context({});
    await expect(
      handler(publish)(ctx, { id: 'p', revision: 1, channels: ['house'] })
    ).rejects.toThrow('Unauthorized');
    expect(ctx.db.get).not.toHaveBeenCalled();
  });
  it('reimport returns the existing record without overwriting edits', async () => {
    const ctx = context({});
    ctx.chain.unique.mockResolvedValue({ _id: 'p' });
    expect(
      await handler(imported)(ctx, {
        sourceKey: 'ashcroft:url',
        provider: 'ashcroft',
        draft: blankCommerceDraft(),
        actor: 'owner@example.com',
      })
    ).toEqual({ id: 'p', existing: true });
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it('customer submit retries return the original request without another notification', async () => {
    const ctx = context({});
    ctx.chain.unique.mockResolvedValue({ _id: 'original', email: 'customer@example.com' });
    const result = await handler(submit)(ctx, {
      token: 'a'.repeat(30),
      email: 'CUSTOMER@example.com',
      name: 'Customer',
      website: '',
      notes: '',
      phone: '',
      business: '',
      address: {},
      items: [],
    });
    expect(result).toBe('original');
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});
