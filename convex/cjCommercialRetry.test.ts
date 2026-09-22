import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
vi.mock('./cjApiClient', async (original) => ({
  ...await original<typeof import('./cjApiClient')>(),
  getInventoryByVid: vi.fn(async () => ({ ok: true, data: [{ vid: 'vid', totalInventoryNum: 100 }] })),
  addCart: vi.fn(), addCartConfirm: vi.fn(), createOrderV2: vi.fn(),
  saveGenerateParentOrder: vi.fn(async () => ({ ok: true, data: { payId: 'pay', orderMoney: 200 } })),
  payBalanceV2: vi.fn(),
}));
import { createCjOrder } from './cjDropshipping';
import { addCart, addCartConfirm, createOrderV2, payBalanceV2 } from './cjApiClient';
const handler = (createCjOrder as unknown as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
const args = { orderId: 'order', orderNumber: 'unique', customerName: 'Test', customerEmail: 'test@example.com', shippingAddress: { line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' }, products: [{ vid: 'vid', quantity: 1, productCost: 10, retailPrice: 200 }], orderSubtotal: 200, customerShippingCollected: 20 };
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['CJ_AUTO_FULFILLMENT_ENABLED', 'CJ_AUTO_BALANCE_PAY_ENABLED', 'CJ_WEBHOOK_VERIFY_SIGNATURE']) vi.stubEnv(key, 'true');
  vi.stubEnv('CJ_API_KEY', 'test'); vi.stubEnv('CJ_WEBHOOK_URL', 'https://example.com/webhook');
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ result: true, data: [{ logisticName: 'CJ Packet', totalPostageFee: 10 }] }) })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function context(overrides = {}, lateHold = false) {
  const order: any = { stripeInvoiceId: 'invoice', commercialApprovedUntil: Date.now() + 60000, commercialMaxSupplierCents: 10000, commercialLogistics: 'CJ Packet', cjOrderId: 'cj-order', cjShipmentOrderId: 'shipment', cjPayId: 'pay', cjPaymentAmount: 50, cjFulfillmentStep: 'payment_order_generated', ...overrides };
  const ctx = {
    runMutation: vi.fn(async (fn: any, data: any) => {
      const name = getFunctionName(fn);
      if (name.endsWith(':reserveCjFulfillmentAttempt')) return { reserved: true, order: { ...order } };
      if (name.endsWith(':reserveCjDiagnosticRequestSlot')) return { waitMs: 0 };
      if (name.endsWith(':updateOrderCjStatus')) Object.assign(order, data);
    }),
    runAction: vi.fn(async () => 'token'),
    runQuery: vi.fn(async () => ({ ...order, ...(lateHold ? { commercialHold: 'Refund hold' } : {}) })),
  };
  return { ctx, order };
}
it.each(['ceiling', 'hold'])('retains confirmed cart progress after a late %s rejection', async kind => {
  const { ctx, order } = context(kind === 'ceiling' ? { cjFulfillmentStep: 'cart_confirmed', cjPayId: undefined } : {}, kind === 'hold');
  const result = await handler(ctx, args);
  expect(result.success).toBe(false);
  expect(order.cjFulfillmentStep).toBe('payment_order_generated');
  expect(payBalanceV2).not.toHaveBeenCalled();
  await handler(ctx, args);
  expect(addCart).not.toHaveBeenCalled();
  expect(addCartConfirm).not.toHaveBeenCalled();
  expect(createOrderV2).not.toHaveBeenCalled();
});
it('preserves an uncertain creation across repeated blocked retries', async () => {
  const { ctx, order } = context({ cjOrderId: undefined, cjFulfillmentStep: 'creating_order' });
  await handler(ctx, args); await handler(ctx, args);
  expect(order.cjFulfillmentStep).toBe('creating_order');
  expect(createOrderV2).not.toHaveBeenCalled();
});
