// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import { blankCommerceDraft } from '../lib/commerce';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const VISITOR = 'a'.repeat(32);

/** A partner, a click from VISITOR on their link, and a $2,000 Ashcroft chair checkout that cost us $1,000. */
async function setup(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const partnerId = await ctx.db.insert('users', { email: 'partner@studio.com' });
    await ctx.db.insert('holmProfiles', { userId: partnerId, displayName: 'Studio', tradeStatus: 'none', partnerStatus: 'active', partnerTier: 'base', refCode: 'STUDIO42', createdAt: 0, updatedAt: 0 });
    await ctx.db.insert('holmClicks', { partnerId, refCode: 'STUDIO42', channel: 'pin', target: 'site:/', visitorId: VISITOR, at: Date.now() - 1000 });
    const productId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:chair', draft: { ...blankCommerceDraft(), usdRate: 1 }, revision: 1, updatedAt: 1 });
    await ctx.db.insert('commerceListings', {
      productId, channel: 'retail', published: true, revision: 1, updatedAt: 1,
      snapshot: { name: 'Ansel accent chair', description: '', category: 'accent chair', images: [], facts: '', variants: [] },
      fulfillment: [{ id: 'v1', name: 'Oat', sku: 'CHR1', cost: 801, minimum: 1, increment: 1, retail: 200_000, commercial: 0 }],
    });
    const checkoutId = await ctx.db.insert('retailCheckouts', {
      items: [{ productId, variantId: 'v1', variantName: 'Oat', name: 'Ansel', price: 2000, quantity: 1, supplierSku: 'CHR1', fulfillmentProvider: 'ashcroft' }],
      subtotal: 200_000, shipping: 4_900, createdAt: Date.now(),
      partner: { partnerId, refCode: 'STUDIO42', visitorId: VISITOR, channel: 'pin' },
    });
    return { partnerId, checkoutId };
  });
}

const paid = (checkoutId: string, email = 'client@home.com') => ({
  retailCheckoutId: checkoutId as never, stripeSessionId: 'cs_1', paymentIntentId: 'pi_1', email, deliveryCents: 4_900, taxCents: 0,
});
const commissions = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query('holmCommissions').collect());

describe('partner commission on a louiemae.com order', () => {
  it('creates one pending commission per checkout, at the furniture rate within the margin guard', async () => {
    const t = convexTest(schema, modules);
    const { checkoutId, partnerId } = await setup(t);
    await t.mutation(internal.holmPartners.storefrontCommission, paid(checkoutId));
    await t.mutation(internal.holmPartners.storefrontCommission, paid(checkoutId)); // Stripe retries
    const rows = await commissions(t);
    expect(rows).toHaveLength(1);
    // $2,000 chair, $801 + $199 freight landed cost: 10% = $200, well inside 40% of the ~$940 profit
    expect(rows[0]).toMatchObject({ partnerId, source: 'storefront_order', status: 'pending', amountCents: 20_000, channel: 'pin', tier: 'base' });
    expect(rows[0].lines![0]).toMatchObject({ type: 'furniture', costKnown: true, capped: false });
  });

  it('pays nothing when the partner buys through their own link', async () => {
    const t = convexTest(schema, modules);
    const { checkoutId } = await setup(t);
    await t.mutation(internal.holmPartners.storefrontCommission, paid(checkoutId, 'Partner@Studio.com'));
    expect(await commissions(t)).toHaveLength(0);
  });

  it('shrinks with a partial refund, once, and voids on a full refund', async () => {
    const t = convexTest(schema, modules);
    const { checkoutId } = await setup(t);
    await t.mutation(internal.holmPartners.storefrontCommission, paid(checkoutId));
    const half = { paymentIntentId: 'pi_1', kind: 'refund' as const, refundedCents: 102_450, chargeCents: 204_900 };
    await t.mutation(internal.holmPartners.storefrontReversal, half);
    await t.mutation(internal.holmPartners.storefrontReversal, half); // replayed event
    expect((await commissions(t))[0]).toMatchObject({ amountCents: 10_000, status: 'pending', reversedCents: 10_000 });
    await t.mutation(internal.holmPartners.storefrontReversal, { ...half, refundedCents: 204_900 });
    expect((await commissions(t))[0]).toMatchObject({ amountCents: 0, status: 'void' });
  });

  it('takes a refund after payout off the next payout', async () => {
    const t = convexTest(schema, modules);
    const { checkoutId, partnerId } = await setup(t);
    await t.mutation(internal.holmPartners.storefrontCommission, paid(checkoutId));
    await t.run(async (ctx) => {
      const [c] = await ctx.db.query('holmCommissions').collect();
      await ctx.db.patch(c._id, { status: 'paid' });
    });
    await t.mutation(internal.holmPartners.storefrontReversal, { paymentIntentId: 'pi_1', kind: 'dispute' });
    const rows = await commissions(t);
    const adj = rows.find((r) => r.source === 'adjustment')!;
    expect(adj).toMatchObject({ partnerId, amountCents: -20_000, status: 'cleared' });
    expect(rows.find((r) => r.source === 'storefront_order')).toMatchObject({ status: 'paid', amountCents: 20_000 });
    // the dispute is won: the amount comes back on the next payout
    await t.mutation(internal.holmPartners.storefrontReversal, { paymentIntentId: 'pi_1', kind: 'dispute_won' });
    await t.mutation(internal.holmPartners.storefrontReversal, { paymentIntentId: 'pi_1', kind: 'dispute_won' });
    const after = (await commissions(t)).filter((r) => r.source === 'adjustment');
    expect(after.map((r) => r.amountCents).sort((x, y) => x - y)).toEqual([-20_000, 20_000]);
  });

  it('gives back a dispute taken before payout, keeping any refund', async () => {
    const t = convexTest(schema, modules);
    const { checkoutId } = await setup(t);
    await t.mutation(internal.holmPartners.storefrontCommission, paid(checkoutId));
    await t.mutation(internal.holmPartners.storefrontReversal, { paymentIntentId: 'pi_1', kind: 'refund', refundedCents: 102_450, chargeCents: 204_900 });
    await t.mutation(internal.holmPartners.storefrontReversal, { paymentIntentId: 'pi_1', kind: 'dispute' });
    expect((await commissions(t))[0]).toMatchObject({ amountCents: 0, status: 'void' });
    await t.mutation(internal.holmPartners.storefrontReversal, { paymentIntentId: 'pi_1', kind: 'dispute_won' });
    expect((await commissions(t))[0]).toMatchObject({ amountCents: 10_000, status: 'pending' });
  });

  it('pays nothing when the buyer email is missing', async () => {
    const t = convexTest(schema, modules);
    const { checkoutId } = await setup(t);
    await t.mutation(internal.holmPartners.storefrontCommission, paid(checkoutId, ''));
    expect(await commissions(t)).toHaveLength(0);
  });

  it('records the partner on the checkout only for a confirmed partner link', async () => {
    const t = convexTest(schema, modules);
    await setup(t);
    const productId = await t.run(async (ctx) => (await ctx.db.query('commerceProducts').first())!._id);
    await t.run(async (ctx) => ctx.db.patch((await ctx.db.query('commerceListings').first())!._id, {
      snapshot: { name: 'Ansel accent chair', description: '', category: 'accent chair', images: [], facts: '', variants: [{ id: 'v1', name: 'Oat', minimum: 1, increment: 1, price: 150_000 }] },
    }));
    const snap = await t.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }], refCode: 'STUDIO42', visitorId: VISITOR });
    const stranger = await t.mutation(internal.retailLaunch.createSnapshot, { items: [{ productId, variantId: 'v1', quantity: 1 }], refCode: 'NOBODY99', visitorId: VISITOR });
    const [withPartner, without] = await t.run(async (ctx) => [await ctx.db.get(snap.id), await ctx.db.get(stranger.id)]);
    expect(withPartner?.partner).toMatchObject({ refCode: 'STUDIO42', channel: 'pin' });
    expect(without?.partner).toBeUndefined();
  });
});

describe('a signed-in buyer on another device', () => {
  it('is still credited through the browser their account remembers', async () => {
    const t = convexTest(schema, modules);
    const { checkoutId, partnerId } = await setup(t);
    const buyerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('users', { email: 'client@home.com' });
      await ctx.db.insert('holmProfiles', { userId: id, displayName: 'Client', tradeStatus: 'none', refVisitorId: VISITOR, refVisitCode: 'STUDIO42', createdAt: 0, updatedAt: 0 });
      return id;
    });
    const otherDevice = 'b'.repeat(32);
    const attr = await t.run(async (ctx) => {
      const { resolveAttribution } = await import('./holmPartners');
      return {
        signedIn: await resolveAttribution(ctx as never, 'STUDIO42', otherDevice, { userId: buyerId, email: 'client@home.com' }),
        guest: await resolveAttribution(ctx as never, 'STUDIO42', otherDevice, { email: 'client@home.com' }),
        // no code on this device at all (e.g. a /trade quote): the account's remembered code counts
        noCode: await resolveAttribution(ctx as never, undefined, otherDevice, { userId: buyerId, email: 'client@home.com' }),
      };
    });
    expect(attr.signedIn?.partnerId).toBe(partnerId);
    expect(attr.guest).toBeNull();
    expect(attr.noCode?.partnerId).toBe(partnerId);
    void checkoutId;
  });
});
