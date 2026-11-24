// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { internal } from './_generated/api';
import { blankCommerceDraft } from '../lib/commerce';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const DAY = 86_400_000;

async function paidPartnerQuote(t: ReturnType<typeof convexTest>, opts: { paidAt: number; tierNow: 'base' | 'active' | 'top' | 'elite'; unitCostUsd?: number }) {
  return t.run(async (ctx) => {
    const partnerId = await ctx.db.insert('users', { email: 'partner@studio.com' });
    await ctx.db.insert('holmProfiles', { userId: partnerId, displayName: 'Studio', tradeStatus: 'none', partnerStatus: 'active', partnerTier: opts.tierNow, refCode: 'STUDIO42', createdAt: 0, updatedAt: 0 });
    const productId = await ctx.db.insert('commerceProducts', { provider: 'owner_managed', sourceKey: 'owner:sofa', draft: { ...blankCommerceDraft(), usdRate: 1 }, revision: 1, updatedAt: 1 });
    if (opts.unitCostUsd)
      // unpublished since the sale: its cost must still count
      await ctx.db.insert('commerceListings', {
        productId, channel: 'house', published: false, revision: 1, updatedAt: 1,
        snapshot: { name: 'Sofa', description: '', category: 'sofa', images: [], facts: '', variants: [] },
        fulfillment: [{ id: 'v1', name: 'Cognac', sku: 'SOF1', cost: opts.unitCostUsd, minimum: 1, increment: 1, retail: 250_000, commercial: 0 }],
      });
    const line = { productId, variantId: 'v1', name: 'Sofa', variantName: 'Cognac', quantity: 2, unitPrice: 250_000, provider: 'owner_managed' as const, sku: 'SOF1' };
    const address = { line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };
    const projectId = await ctx.db.insert('commerceProjects', {
      token: 'tok', channel: 'house', name: 'Client', email: 'client@x.com', phone: '', business: '', address, notes: '',
      requested: [line], lines: [line], delivery: 0, tax: 0, revision: 1, status: 'paid', paidAt: opts.paidAt, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert('holmQuoteRequests', {
      commerceProjectId: projectId, projectName: 'Lobby', priceMode: 'retail', retailSubtotal: 500_000, subtotal: 500_000,
      projectDiscount: 0, tierBps: 0, partnerId, refCode: 'STUDIO42', channel: 'pin', partnerState: 'awaiting_payment', createdAt: opts.paidAt - DAY,
    });
    return { partnerId };
  });
}

describe('partner commission on a paid House order', () => {
  it('locks the tier held when the order was paid and stores each line', async () => {
    const t = convexTest(schema, modules);
    const paidAt = Date.now() - 2 * DAY;
    const { partnerId } = await paidPartnerQuote(t, { paidAt, tierNow: 'top' });
    // The partner was Active when the order was paid and moved up to Top afterwards.
    await t.run(async (ctx) => {
      await ctx.db.insert('holmTierChanges', { partnerId, tier: 'active', from: 'base', at: paidAt - DAY, reason: 'set by the team' });
      await ctx.db.insert('holmTierChanges', { partnerId, tier: 'top', from: 'active', at: paidAt + DAY, reason: 'set by the team' });
    });
    await t.mutation(internal.holmPartners.reconcile, {});
    const [c] = await t.run((ctx) => ctx.db.query('holmCommissions').collect());
    expect(c.tier).toBe('active');
    expect(c.lines).toHaveLength(1);
    expect(c.lines![0]).toMatchObject({ type: 'furniture', baseCents: 500_000, costKnown: false });
    // No listing means no known cost, so the line earns the furniture base rate.
    expect(c.lines![0].rateBps).toBe(1000);
    expect(c.amountCents).toBe(50_000);
    expect(c.status).toBe('pending');
  });

  it('applies the tier rate and the 40% guard when the cost is known, even after unpublishing', async () => {
    const t = convexTest(schema, modules);
    // $2,500 sofa x2 that cost us $2,200 each: profit after card fees is $454.70, so the cap is $181.88
    await paidPartnerQuote(t, { paidAt: Date.now() - DAY, tierNow: 'active', unitCostUsd: 2_200 });
    await t.mutation(internal.holmPartners.reconcile, {});
    const [c] = await t.run((ctx) => ctx.db.query('holmCommissions').collect());
    expect(c.lines![0]).toMatchObject({ rateBps: 1200, costKnown: true, capped: true, amountCents: 18_188 });
    expect(c.amountCents).toBe(18_188);
  });
});
