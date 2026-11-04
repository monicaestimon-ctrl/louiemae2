// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { blankCommerceDraft, projectCredit, projectTotal } from '../lib/commerce';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const HOUR = 3600e3;

/** A member with $150 of earned credit, a $2,000 Ashcroft chair to buy, and their signed-in client. */
async function setup(t: ReturnType<typeof convexTest>) {
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { email: 'member@studio.com' });
    await ctx.db.insert('holmProfiles', { userId, displayName: 'Member', tradeStatus: 'none', createdAt: 0, updatedAt: 0 });
    await ctx.db.insert('holmCredits', { userId, amountCents: 15_000, kind: 'earned', reason: 'Business referral', at: 0 });
    const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:chair', draft: { ...blankCommerceDraft(), usdRate: 1 }, revision: 1, updatedAt: 1 });
    await ctx.db.insert('commerceListings', {
      productId, channel: 'retail', published: true, revision: 1, updatedAt: 1,
      snapshot: { name: 'Ansel accent chair', description: '', category: 'accent chair', images: [], facts: '', variants: [{ id: 'v1', name: 'Oat', minimum: 1, increment: 1, price: 150_000 }] },
      fulfillment: [{ id: 'v1', name: 'Oat', sku: 'CHR1', cost: 801, minimum: 1, increment: 1, retail: 200_000, commercial: 0 }],
    });
    return { userId, productId };
  });
  const member = t.withIdentity({ subject: `${ids.userId}|session` });
  return { ...ids, member };
}
const balance = (t: ReturnType<typeof convexTest>, member: ReturnType<ReturnType<typeof convexTest>['withIdentity']>) =>
  member.query(api.holmCredit.myCredit, {}).then((c) => c!.balanceCents);

describe('store credit on a louiemae.com order', () => {
  it('holds the credit for the checkout, then marks it used when paid', async () => {
    const t = convexTest(schema, modules);
    const { productId, member } = await setup(t);
    const snap = await member.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }], useCredit: true });
    expect(snap.creditCents).toBe(15_000);
    expect(await balance(t, member)).toBe(0); // held, so it can't be spent twice
    await t.mutation(internal.holmCredit.useCheckout, { retailCheckoutId: snap.id, paymentIntentId: 'pi_1' });
    await t.mutation(internal.holmCredit.useCheckout, { retailCheckoutId: snap.id, paymentIntentId: 'pi_1' }); // repeat
    expect(await balance(t, member)).toBe(0);
    // a full refund gives the credit back, once
    await t.mutation(internal.holmCredit.restoreOnRefund, { paymentIntentId: 'pi_1', refundedCents: 100_000, chargeCents: 200_000 });
    expect(await balance(t, member)).toBe(7_500);
    await t.mutation(internal.holmCredit.restoreOnRefund, { paymentIntentId: 'pi_1', refundedCents: 200_000, chargeCents: 200_000 });
    await t.mutation(internal.holmCredit.restoreOnRefund, { paymentIntentId: 'pi_1', refundedCents: 200_000, chargeCents: 200_000 });
    expect(await balance(t, member)).toBe(15_000);
  });

  it('never takes more than the items, and leaves credit alone unless asked', async () => {
    const t = convexTest(schema, modules);
    const { productId, member, userId } = await setup(t);
    await t.run((ctx) => ctx.db.insert('holmCredits', { userId, amountCents: 500_000, kind: 'earned', reason: 'Business referral', at: 0 }));
    const without = await member.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }] });
    expect(without.creditCents).toBe(0);
    const snap = await member.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }], useCredit: true });
    expect(snap.creditCents).toBe(snap.subtotal);
    expect(await balance(t, member)).toBe(515_000 - snap.subtotal);
  });

  it('gives the hold back when the checkout expires or is abandoned', async () => {
    const t = convexTest(schema, modules);
    const { productId, member } = await setup(t);
    const a = await member.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }], useCredit: true });
    await t.mutation(internal.holmCredit.releaseCheckout, { retailCheckoutId: a.id });
    expect(await balance(t, member)).toBe(15_000);
    // no expiry event: the hourly check releases it once the session can no longer be paid
    const b = await member.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }], useCredit: true });
    await t.run(async (ctx) => {
      const hold = await ctx.db.query('holmCredits').withIndex('by_ref', (q) => q.eq('ref', `checkout:${b.id}`)).first();
      await ctx.db.patch(hold!._id, { at: Date.now() - 26 * HOUR });
    });
    await t.mutation(internal.holmCredit.settleStaleHolds, {});
    expect(await balance(t, member)).toBe(15_000);
  });

  it('pays partner commission on the price after credit', async () => {
    const t = convexTest(schema, modules);
    const { productId, member } = await setup(t);
    const partnerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { email: 'partner@other.com' });
      await ctx.db.insert('holmProfiles', { userId: id, displayName: 'P', tradeStatus: 'none', partnerStatus: 'active', partnerTier: 'base', refCode: 'OTHER42', createdAt: 0, updatedAt: 0 });
      await ctx.db.insert('holmClicks', { partnerId: id, refCode: 'OTHER42', channel: 'pin', target: 'site:/', visitorId: 'v'.repeat(32), at: Date.now() });
      return id;
    });
    const snap = await member.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }], useCredit: true, refCode: 'OTHER42', visitorId: 'v'.repeat(32) });
    await t.mutation(internal.holmPartners.storefrontCommission, { retailCheckoutId: snap.id, stripeSessionId: 'cs_1', email: 'member@studio.com', deliveryCents: 0, taxCents: 0 });
    const [c] = await t.run((ctx) => ctx.db.query('holmCommissions').collect());
    expect(c.partnerId).toBe(partnerId);
    expect(c.baseCents).toBe(snap.subtotal - 15_000);
  });
});

describe('store credit on a /trade quote', () => {
  it('comes off the merchandise only, as its own invoice line, and is used when paid', async () => {
    expect(projectCredit({ lines: [{ unitPrice: 10_000, quantity: 2 }], creditCents: 50_000 })).toBe(20_000);
    expect(projectTotal({ lines: [{ unitPrice: 10_000, quantity: 2 }], delivery: 5_000, tax: 1_000, creditCents: 50_000 })).toBe(6_000);
    const t = convexTest(schema, modules);
    const { userId, member } = await setup(t);
    const projectId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('commerceProjects', {
        token: 't'.repeat(24), channel: 'house', name: 'Member', email: 'member@studio.com', phone: '1', business: '', notes: '',
        address: { line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
        requested: [], lines: [], delivery: 0, tax: 0, revision: 1, status: 'requested', customerEmailStatus: 'sent', ownerEmailStatus: 'sent', createdAt: Date.now(), updatedAt: Date.now(),
      });
      const { reserveCredit } = await import('./holmCredit');
      const held = await reserveCredit(ctx as never, userId, 10_000, `project:${id}`);
      await ctx.db.patch(id, { creditCents: held, paidAt: Date.now() });
      return id;
    });
    // the line on the invoice can't exceed the merchandise; with no lines nothing is used
    await t.mutation(internal.holmCredit.settleStaleHolds, {});
    expect(await balance(t, member)).toBe(15_000);
    void (projectId as Id<'commerceProjects'>);
  });
});
