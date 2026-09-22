import { beforeEach, describe, expect, it, vi } from 'vitest';
const stripe = vi.hoisted(() => ({
  invoices: {
    retrieve: vi.fn(),
    create: vi.fn(),
    listLineItems: vi.fn(),
    finalizeInvoice: vi.fn(),
    sendInvoice: vi.fn(),
  },
  customers: { create: vi.fn() },
  invoiceItems: { create: vi.fn() },
  invoicePayments: { list: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
}));
vi.mock('stripe', () => ({
  default: function Stripe() {
    return stripe;
  },
}));
import { reconcilePayment, sendInvoice } from './commerceStripe';
const handler = (reconcilePayment as unknown as { _handler: (ctx: any, args: any) => Promise<any> })
  ._handler;
const invoice = {
  id: 'in_test',
  customer: 'cus_test',
  metadata: { commerceProjectId: 'project', quoteRevision: '2' },
  status: 'paid',
  amount_remaining: 0,
  amount_paid: 10000,
  total: 10000,
  currency: 'usd',
  livemode: false,
};
const intent = {
  status: 'succeeded',
  customer: 'cus_test',
  currency: 'usd',
  amount_received: 10000,
  livemode: false,
  latest_charge: { disputed: false, amount_refunded: 0 },
};
const ctx = () => ({
  runQuery: vi.fn(async () => ({
    stripeInvoiceId: 'in_test',
    lines: [{ quantity: 2, unitPrice: 5000 }],
    delivery: 0,
    tax: 0,
  })),
  runMutation: vi.fn(async () => {}),
});
beforeEach(() => {
  vi.stubEnv('COMMERCE_INVOICES_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  stripe.invoices.retrieve.mockResolvedValue(invoice);
  stripe.invoicePayments.list.mockResolvedValue({
    has_more: false,
    data: [{ amount_paid: 10000, payment: { payment_intent: 'pi_test' } }],
  });
  stripe.paymentIntents.retrieve.mockResolvedValue(intent);
});
describe('Stripe online payment verification', () => {
  it('continues reconciling existing payments when sending new invoices is disabled', async () => { vi.stubEnv('COMMERCE_INVOICES_ENABLED', 'false'); const c = ctx(); await handler(c, { invoiceId: 'in_test' }); expect(c.runMutation).toHaveBeenCalledOnce(); });
  it('creates a genuinely itemized invoice with the revised quantity and unit price', async () => {
    vi.stubEnv('COMMERCE_INVOICE_DUE_DAYS', '3');
    const p = {
      _id: 'project',
      revision: 2,
      status: 'accepted',
      name: 'Buyer',
      email: 'buyer@example.com',
      phone: '5551234567',
      channel: 'house',
      notes: '',
      address: {
        line1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'US',
      },
      lines: [{ name: 'Chair', variantName: 'Walnut', quantity: 15, unitPrice: 10000 }],
      delivery: 0,
      tax: 0,
    };
    stripe.customers.create.mockResolvedValue({ id: 'cus_test' });
    stripe.invoices.create.mockResolvedValue({ id: 'in_test' });
    stripe.invoices.retrieve.mockResolvedValue({ ...invoice, status: 'draft', total: 150000 });
    stripe.invoices.listLineItems.mockResolvedValue({ data: [], has_more: false });
    stripe.invoices.finalizeInvoice.mockResolvedValue({
      ...invoice,
      status: 'open',
      hosted_invoice_url: 'https://invoice.stripe.com/test',
    });
    const c = {
      runQuery: vi.fn(async () => ({ email: 'owner@example.com' })),
      runMutation: vi.fn(async () => p),
    };
    const send = (sendInvoice as unknown as { _handler: (ctx: any, args: any) => Promise<any> })
      ._handler;
    await send(c, { id: 'project', revision: 2 });
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Chair — Walnut',
        quantity: 15,
        unit_amount_decimal: '10000',
        invoice: 'in_test',
      }),
      { idempotencyKey: 'house:project:v2:line:0' }
    );
    expect(stripe.invoices.sendInvoice).toHaveBeenCalledWith(
      'in_test',
      {},
      { idempotencyKey: 'house:project:v2:send' }
    );
  });
  it('passes only the verified amount, invoice revision and payment IDs to fulfillment', async () => {
    const c = ctx();
    await handler(c, { invoiceId: 'in_test' });
    expect(c.runMutation).toHaveBeenCalledWith(expect.anything(), {
      id: 'project',
      revision: 2,
      invoiceId: 'in_test',
      amount: 10000,
      currency: 'usd',
      paymentIntentIds: ['pi_test'],
    });
  });
  it('does not treat an out-of-band paid invoice as online payment', async () => {
    stripe.invoicePayments.list.mockResolvedValue({ has_more: false, data: [] });
    const c = ctx();
    await expect(handler(c, { invoiceId: 'in_test' })).rejects.toThrow('Full online payment');
    expect(c.runMutation).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'processing' },
    { customer: 'another_customer' },
    { amount_received: 9000 },
    { latest_charge: { disputed: true, amount_refunded: 0 } },
    { latest_charge: { disputed: false, amount_refunded: 1 } },
  ])('holds unsupported, short or reversed payments %j', async (changes) => {
    stripe.paymentIntents.retrieve.mockResolvedValue({ ...intent, ...changes });
    const c = ctx();
    await expect(handler(c, { invoiceId: 'in_test' })).rejects.toThrow('Full online payment');
    expect(c.runMutation).not.toHaveBeenCalled();
  });
  it('will not count the same payment twice', async () => {
    stripe.invoicePayments.list.mockResolvedValue({
      has_more: false,
      data: [1, 2].map(() => ({ amount_paid: 5000, payment: { payment_intent: 'pi_test' } })),
    });
    const c = ctx();
    await expect(handler(c, { invoiceId: 'in_test' })).rejects.toThrow('Full online payment');
    expect(c.runMutation).not.toHaveBeenCalled();
  });
});
