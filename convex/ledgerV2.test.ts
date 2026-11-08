// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { accrueForOrder } from './ldgCommissions';
import { onOrderPaid, reserve, settle } from './ldgCredits';
import { applyCreditEvent, obligationEventTotals } from './ldgCore';
import { cutoffFor } from './ldgPayouts';
import { isCommerceError } from '../lib/errors';
import type { PayoutSchedule } from '../lib/config';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ADMIN = 'owner@louiemae.com';
const ADMIN2 = 'finance@louiemae.com';
const DAY = 86_400_000;
const FLAGS = ['COMMISSION_ACCRUAL_V2_ENABLED', 'CREDIT_V2_ENABLED', 'ATTRIBUTION_V2_ENABLED'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'], now: Date.UTC(2026, 10, 1, 12) });
  process.env.CJ_ADMIN_EMAILS = `${ADMIN},${ADMIN2}`;
  for (const f of FLAGS) process.env[f] = 'true';
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CJ_ADMIN_EMAILS;
  for (const f of FLAGS) delete process.env[f];
});

async function setup() {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) => ctx.db.insert('users', { email: ADMIN }));
  const admin2Id = await t.run((ctx) => ctx.db.insert('users', { email: ADMIN2 }));
  const admin = t.withIdentity({ subject: `${adminId}|s`, email: ADMIN });
  const admin2 = t.withIdentity({ subject: `${admin2Id}|s`, email: ADMIN2 });
  await t.mutation(internal.sysConfig.seed, {});
  const approve = async (key: string) => {
    const { records } = await admin.query(api.sysConfig.list, { status: 'proposed' });
    await admin.mutation(api.sysConfig.approve, { id: records.find((r) => r.key === key)!._id });
  };
  return { t, admin, admin2, approve };
}

/** A paid v2 order attributed to a beneficiary at 10% on two lines ($1,000 and $500). */
async function attributedOrder(t: ReturnType<typeof convexTest>, opts: { buyerUserId?: Id<'users'>; credit?: number } = {}) {
  return t.run(async (ctx) => {
    const partner = await ctx.db.insert('users', { email: 'partner@x.com' });
    const ben = await ctx.db.insert('prgBeneficiaries', { kind: 'person', userId: partner, legacyUserId: partner, displayName: 'P', payoutAccountRef: 'acct_1', payoutReadiness: 'ready', taxReadiness: 'approved', tierKey: 'base', status: 'active', createdAt: 0, updatedAt: 0 });
    const productId = await ctx.db.insert('commerceProducts', { provider: 'zuo', sourceKey: 'zuo:x', draft: { name: 'x', description: '', category: '', images: [], referenceImages: [], sourceUrl: '', supplierName: '', supplierContact: '', facts: '', packaging: '', currency: 'USD', usdRate: 1, variants: [], conflicts: [], factsApproved: true, imagesApproved: true, referencePermission: true }, revision: 1, updatedAt: 1 });
    const supplierId = await ctx.db.insert('catSuppliers', { code: 'zuo', name: 'Zuo', publicAttributionAllowed: false, fulfillmentRoute: 'manual_dealer_zuo', freshnessKey: 'freshness-default', createdAt: 1 });
    const variantId = await ctx.db.insert('catVariants', { productId, supplierId, supplierSku: 'S', packId: '1', optionKey: 'o', supplierVariantName: 'v', louieMaeVariantName: 'v', piecesPerPack: 1, orderMinimumPacks: 1, orderIncrementPacks: 1, availability: 'in_stock', fulfillmentRoute: 'manual_dealer_zuo', holds: [], referralEligible: true, createdAt: 1, updatedAt: 1 });
    const estimateId = await ctx.db.insert('dlvEstimates', { channel: 'retail', destination: { zip: '95206', precision: 'full' }, service: 'curbside', lines: [], groups: [], status: 'ok', merchandiseMinor: 150_000, discountMinor: 0, creditMinor: 0, expiresAt: 0, cartHash: '', sourceVersionsHash: '', internal: {}, createdAt: 0 });
    const credit = opts.credit ?? 0;
    const intentId = await ctx.db.insert('ordCheckoutIntents', { idempotencyKey: `k${Math.random()}`, estimateId, cartHash: '', channel: 'retail', buyer: opts.buyerUserId ? { userId: opts.buyerUserId } : {}, lineSnapshot: [], merchandiseMinor: 150_000, deliveryMinor: 5_000, taxMinor: 0, creditMinor: credit, totalMinor: 155_000 - credit, status: 'paid', expiresAt: 0, createdAt: 0 });
    const snapId = await ctx.db.insert('prgAttributionSnapshots', { intentId, clickId: 'c', beneficiaryId: ben, membershipSource: 'creator', scope: 'basket', lines: [{ lineKey: 'a', productId, category: 'furniture', protectedRateBps: 1000, currentRateBps: 1000, appliedRateBps: 1000, eligible: true }, { lineKey: 'b', productId, category: 'furniture', protectedRateBps: 1000, currentRateBps: 1000, appliedRateBps: 1000, eligible: true }], tierKeyAtPurchase: 'base', scheduleVersion: 2, createdAt: 0 });
    await ctx.db.patch(intentId, { attributionSnapshotId: snapId });
    const orderId = await ctx.db.insert('ordOrders', { number: `LM-${Math.random()}`, intentId, channel: 'retail', ...(opts.buyerUserId ? { buyerUserId: opts.buyerUserId } : {}), email: 'b@x.com', paymentIntentId: `pi_${Math.random()}`, paidAt: Date.now(), totals: { merchandise: 150_000, discount: 0, credit, delivery: 5_000, tax: 0, total: 155_000 - credit }, splitKnown: false, accrualPath: 'none', status: 'paid', createdAt: Date.now() });
    const credits = [Math.round((credit * 2) / 3), credit - Math.round((credit * 2) / 3)];
    for (const [i, [key, unit]] of ([['a', 100_000], ['b', 50_000]] as const).entries())
      await ctx.db.insert('ordOrderLines', { orderId, lineNo: i + 1, lineKey: key, variantId, productId, name: key, packs: 1, pieces: 1, unitPackMinor: unit, discountMinor: 0, creditMinor: credits[i], taxMinor: 0, deliveryAllocMinor: 0, commissionCategory: 'furniture', supplierCode: 'zuo', refundedMinor: 0, status: 'open' });
    await accrueForOrder(ctx, orderId);
    const order = (await ctx.db.get(orderId))!;
    return { ben, orderId, partner, pi: order.paymentIntentId! };
  });
}

const obligations = (t: Awaited<ReturnType<typeof setup>>['t'], orderId: Id<'ordOrders'>) => t.run((ctx) => ctx.db.query('ldgObligations').withIndex('by_order', (q) => q.eq('orderId', orderId)).collect());

describe('commission ledger v2 (S29, LED01, LED02)', () => {
  it('accrues one obligation per eligible line exactly once', async () => {
    const s = await setup();
    const o = await attributedOrder(s.t);
    await s.t.run((ctx) => accrueForOrder(ctx, o.orderId));
    const rows = await obligations(s.t, o.orderId);
    expect(rows.map((r) => r.earnedMinor).sort()).toEqual([10_000, 5_000].sort());
    expect(rows.every((r) => r.state === 'pending' && r.clearsAt === r.paidAt! + 30 * DAY)).toBe(true);
    expect((await s.t.run((ctx) => ctx.db.get(o.orderId)))!.accrualPath).toBe('v2');
  });

  it('reverses cumulative refunds once, in any order, and never more than earned', async () => {
    const s = await setup();
    const o = await attributedOrder(s.t);
    const refund = (cents: number) => s.t.mutation(internal.ldgCommissions.onPaymentEvent, { paymentIntentId: o.pi, kind: 'refund', refundedCents: cents, chargeCents: 155_000 });
    await refund(31_000); // ≈ 20% of the charge → merchandise share 30,000
    await refund(31_000); // duplicate
    await refund(15_500); // out-of-order older total: ignored
    let rows = await obligations(s.t, o.orderId);
    expect(rows.reduce((t, r) => t + r.reversedMinor, 0)).toBe(3_000);
    await refund(155_000); // full refund
    await refund(200_000); // beyond the charge: capped
    rows = await obligations(s.t, o.orderId);
    expect(rows.every((r) => r.state === 'void' && r.reversedMinor === r.earnedMinor)).toBe(true);
    for (const r of rows) {
      const totals = await s.t.run((ctx) => obligationEventTotals(ctx, r._id));
      expect(totals).toMatchObject({ earned: r.earnedMinor, reversed: r.reversedMinor });
    }
  });

  it('holds disputes, restores once if won, voids if lost, and offsets after payout', async () => {
    const s = await setup();
    const o = await attributedOrder(s.t);
    const ev = (kind: 'dispute' | 'dispute_won' | 'dispute_lost', disputeId: string) => s.t.mutation(internal.ldgCommissions.onPaymentEvent, { paymentIntentId: o.pi, kind, disputeId });
    await ev('dispute', 'dp_1');
    expect((await obligations(s.t, o.orderId)).every((r) => r.state === 'held')).toBe(true);
    await ev('dispute_won', 'dp_1');
    await ev('dispute_won', 'dp_1');
    expect((await obligations(s.t, o.orderId)).every((r) => r.state === 'pending')).toBe(true);
    await ev('dispute', 'dp_2');
    await ev('dispute_lost', 'dp_2');
    expect((await obligations(s.t, o.orderId)).every((r) => r.state === 'void')).toBe(true);
    // A second order, cleared and paid out, then refunded: an offset, never a bank debit.
    const o2 = await attributedOrder(s.t);
    vi.setSystemTime(Date.now() + 31 * DAY);
    await s.t.mutation(internal.ldgCommissions.clearDue, {});
    await s.approve('payout-readiness');
    await s.admin.mutation(api.ldgPayouts.recordManualPayout, { beneficiaryId: o2.ben, reference: 'ACH-1' });
    await s.t.mutation(internal.ldgCommissions.onPaymentEvent, { paymentIntentId: o2.pi, kind: 'refund', refundedCents: 155_000, chargeCents: 155_000 });
    const all = await s.t.run((ctx) => ctx.db.query('ldgObligations').withIndex('by_beneficiary_created', (q) => q.eq('beneficiaryId', o2.ben)).collect());
    expect(all.filter((r) => r.source === 'retail_order').every((r) => r.state === 'transferred')).toBe(true);
    expect(all.filter((r) => r.source === 'offset').reduce((t, r) => t + r.earnedMinor, 0)).toBe(-15_000);
  });

  it('needs a second person for large manual adjustments', async () => {
    const s = await setup();
    const o = await attributedOrder(s.t);
    const r = await s.admin.mutation(api.ldgCommissions.requestAdjustment, { beneficiaryId: o.ben, amountMinor: 50_000, reason: 'Goodwill for a lost order' });
    expect('pendingReviewId' in r).toBe(true);
    const reviewId = (r as { pendingReviewId: Id<'sysReviewItems'> }).pendingReviewId;
    await expect(s.admin.mutation(api.ldgCommissions.confirmAdjustment, { reviewId })).rejects.toSatisfy((e) => isCommerceError(e, 'FORBIDDEN'));
    await s.admin2.mutation(api.ldgCommissions.confirmAdjustment, { reviewId });
    const adj = await s.t.run((ctx) => ctx.db.query('ldgObligations').filter((q) => q.eq(q.field('source'), 'adjustment')).collect());
    expect(adj[0]).toMatchObject({ earnedMinor: 50_000, state: 'cleared' });
  });
});

describe('payout runs v2 (S30, PAY01, PAY02, G7)', () => {
  it('computes the 23:59:59.999 Chicago cutoff on the 14th across DST', () => {
    const s: PayoutSchedule = { day: 15, localTime: '09:00', tz: 'America/Chicago', cutoffDay: 14, cutoffLocalTime: '23:59:59', minimumMinor: 5000 };
    expect(new Date(cutoffFor('2026-07', s)).toISOString()).toBe('2026-07-15T04:59:59.999Z'); // CDT
    expect(new Date(cutoffFor('2026-12', s)).toISOString()).toBe('2026-12-15T05:59:59.999Z'); // CST
  });

  it('carries balances under $50, reserves each payable cent once, and blocks a concurrent manual payout', async () => {
    const s = await setup();
    await s.approve('payout-schedule');
    await s.approve('payout-readiness');
    const o = await attributedOrder(s.t);
    vi.setSystemTime(Date.UTC(2026, 11, 10)); // cleared before the December cutoff
    await s.t.mutation(internal.ldgCommissions.clearDue, {});
    // a separate beneficiary under the minimum
    const small = await s.t.run(async (ctx) => {
      const ben = await ctx.db.insert('prgBeneficiaries', { kind: 'person', displayName: 'S', payoutAccountRef: 'acct_2', payoutReadiness: 'ready', taxReadiness: 'approved', tierKey: 'base', status: 'active', createdAt: 0, updatedAt: 0 });
      await ctx.db.insert('ldgObligations', { beneficiaryId: ben, source: 'retail_order', rateBps: 1000, basisMinor: 49_990, earnedMinor: 4_999, reversedMinor: 0, heldMinor: 0, refundedBasisMinor: 0, state: 'cleared', clearsAt: 0, clearedAt: 0, currency: 'USD', createdAt: 0, updatedAt: 0 });
      return ben;
    });
    const { runId } = await s.t.mutation(internal.ldgPayouts.openRun, { period: '2026-12', kind: 'monthly', by: 'test' });
    const again = await s.t.mutation(internal.ldgPayouts.openRun, { period: '2026-12', kind: 'monthly', by: 'test' });
    expect(again).toEqual({ runId, existing: true });
    await s.t.mutation(internal.ldgPayouts.planPage, { runId, cursor: null });
    const run = (await s.t.run((ctx) => ctx.db.get(runId)))!;
    expect(run.totals).toMatchObject({ eligibleMinor: 15_000 + 4_999, reservedMinor: 15_000, carriedMinor: 4_999 });
    // Manual payout can't take reserved cents; replanning reserves nothing new.
    await expect(s.admin.mutation(api.ldgPayouts.recordManualPayout, { beneficiaryId: o.ben, reference: 'X' })).rejects.toThrow();
    await s.t.mutation(internal.ldgPayouts.planPage, { runId, cursor: null });
    const attempts = await s.t.run((ctx) => ctx.db.query('ldgTransferAttempts').collect());
    expect(attempts).toHaveLength(1);
    expect((await s.t.run((ctx) => ctx.db.query('ldgObligations').withIndex('by_beneficiary_state', (q) => q.eq('beneficiaryId', small).eq('state', 'cleared')).collect())).length).toBe(1);
  });

  it('aborts on insufficient funds, and reconciles an uncertain transfer before any retry', async () => {
    const s = await setup();
    await s.approve('payout-schedule');
    await s.approve('payout-readiness');
    await attributedOrder(s.t);
    vi.setSystemTime(Date.UTC(2026, 11, 10));
    await s.t.mutation(internal.ldgCommissions.clearDue, {});
    const { runId } = await s.t.mutation(internal.ldgPayouts.openRun, { period: '2026-12', kind: 'monthly', by: 'test' });
    await s.t.mutation(internal.ldgPayouts.planPage, { runId, cursor: null });
    expect(await s.t.mutation(internal.ldgPayouts.recordFunding, { runId, availableMinor: 1 })).toBe(false);
    expect((await s.t.run((ctx) => ctx.db.query('ldgObligations').collect())).every((o) => o.state === 'cleared')).toBe(true);
    // Fresh run: submit → timeout (uncertain) → a retry is impossible → reconciliation finds it paid.
    const { runId: r2 } = await s.t.mutation(internal.ldgPayouts.openRun, { period: '2027-01', kind: 'monthly', by: 'test' });
    await s.t.mutation(internal.ldgPayouts.planPage, { runId: r2, cursor: null });
    expect(await s.t.mutation(internal.ldgPayouts.recordFunding, { runId: r2, availableMinor: 1_000_000 })).toBe(true);
    const [att] = await s.t.query(internal.ldgPayouts.attemptsToSubmit, { runId: r2 });
    expect(await s.t.mutation(internal.ldgPayouts.markSubmitted, { attemptId: att._id })).toBe(true);
    expect(await s.t.mutation(internal.ldgPayouts.markSubmitted, { attemptId: att._id })).toBe(false); // never sent twice
    await s.t.mutation(internal.ldgPayouts.recordResult, { attemptId: att._id, outcome: 'uncertain', error: 'timeout' });
    expect(await s.t.query(internal.ldgPayouts.attemptsToSubmit, { runId: r2 })).toHaveLength(0);
    await s.t.mutation(internal.ldgPayouts.recordResult, { attemptId: att._id, outcome: 'succeeded', transferId: 'tr_1' });
    expect((await s.t.run((ctx) => ctx.db.query('ldgObligations').collect())).every((o) => o.state === 'transferred')).toBe(true);
    // Bank arrival is observed separately; a reversed transfer makes the cents payable again.
    await s.t.mutation(internal.ldgPayouts.observeBankPayout, { accountId: 'acct_1', stripePayoutId: 'po_1', amountMinor: 15_000, status: 'in_transit' });
    await s.t.mutation(internal.ldgPayouts.onTransferReversed, { transferId: 'tr_1' });
    expect((await s.t.run((ctx) => ctx.db.query('ldgObligations').collect())).every((o) => o.state === 'cleared')).toBe(true);
  });
});

describe('business referral credit v2 (S31, CRE01, CRE02)', () => {
  async function referredBusiness(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const referrer = await ctx.db.insert('users', { email: 'ref@x.com' });
      const biz = await ctx.db.insert('users', { email: 'biz@x.com' });
      await ctx.db.insert('holmProfiles', { userId: biz, displayName: 'Biz', tradeStatus: 'approved', createdAt: 0, updatedAt: 0 });
      await ctx.db.insert('holmReferrals', { referrerId: referrer, referredUserId: biz, status: 'verified', creditCents: 0, createdAt: 0 });
      return { referrer, biz };
    });
  }

  it('awards $100 once after 30 days for $500 of qualifying merchandise, and not for $499.99', async () => {
    const s = await setup();
    await s.approve('business-credit');
    const { referrer, biz } = await referredBusiness(s.t);
    const order = await attributedOrder(s.t, { buyerUserId: biz }); // $1,500 merchandise, attributed to another partner
    expect(await s.t.run((ctx) => onOrderPaid(ctx, order.orderId))).toBe(`award:${biz}`);
    expect(await s.t.run((ctx) => onOrderPaid(ctx, order.orderId))).toBeNull(); // one award per business
    let acct = await s.t.run((ctx) => ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', referrer)).first());
    expect(acct).toMatchObject({ pendingAwardMinor: 10_000, availableMinor: 0 });
    await s.t.mutation(internal.ldgCredits.awardDue, {});
    expect((await s.t.run((ctx) => ctx.db.get(acct!._id)))!.availableMinor).toBe(0); // still pending
    vi.setSystemTime(Date.now() + 30 * DAY);
    await s.t.mutation(internal.ldgCredits.awardDue, {});
    await s.t.mutation(internal.ldgCredits.awardDue, {});
    acct = await s.t.run((ctx) => ctx.db.get(acct!._id));
    expect(acct).toMatchObject({ pendingAwardMinor: 0, availableMinor: 10_000, lifetimeIssuedMinor: 10_000 });
    // $499.99 qualifying (after credit) earns nothing
    const s2 = await setup();
    await s2.approve('business-credit');
    const b2 = await referredBusiness(s2.t);
    const small = await attributedOrder(s2.t, { buyerUserId: b2.biz, credit: 100_001 });
    expect(await s2.t.run((ctx) => onOrderPaid(ctx, small.orderId))).toBeNull();
  });

  it('cancels a pending award when a refund takes the order below $500', async () => {
    const s = await setup();
    await s.approve('business-credit');
    const { biz, referrer } = await referredBusiness(s.t);
    const order = await attributedOrder(s.t, { buyerUserId: biz });
    await s.t.run((ctx) => onOrderPaid(ctx, order.orderId));
    await s.t.run(async (ctx) => {
      for (const l of await ctx.db.query('ordOrderLines').withIndex('by_order', (q) => q.eq('orderId', order.orderId)).collect()) await ctx.db.patch(l._id, { refundedMinor: l.unitPackMinor - 1_000 });
    });
    vi.setSystemTime(Date.now() + 30 * DAY);
    await s.t.mutation(internal.ldgCredits.awardDue, {});
    const acct = await s.t.run((ctx) => ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', referrer)).first());
    expect(acct).toMatchObject({ pendingAwardMinor: 0, availableMinor: 0 });
  });

  it('never lets concurrent checkouts overspend, releases expired holds and reinstates credit (not cash) on refunds', async () => {
    const s = await setup();
    const user = await s.t.run((ctx) => ctx.db.insert('users', { email: 'm@x.com' }));
    await s.t.run((ctx) => applyCreditEvent(ctx, { eventKey: 'open', userId: user, type: 'opening_balance', amountMinor: 10_000, actor: 't' }));
    const holds = await Promise.allSettled([1, 2].map((i) => s.t.run((ctx) => reserve(ctx, user, 10_000, `intent:${i}`))));
    const amounts = holds.map((h) => (h.status === 'fulfilled' ? h.value : -1));
    expect(amounts.filter((x) => x === 10_000)).toHaveLength(1);
    expect(amounts.filter((x) => x === 10_000 || x === 0 || x === -1)).toHaveLength(2);
    const winner = amounts[0] === 10_000 ? 'intent:1' : 'intent:2';
    await s.t.run((ctx) => settle(ctx, winner, 'released'));
    expect((await s.t.run((ctx) => ctx.db.query('ldgCreditAccounts').first()))!.availableMinor).toBe(10_000);
    // A v2 order paid partly with credit, then half refunded: half of the credit share comes back as credit.
    const o = await attributedOrder(s.t, { buyerUserId: user, credit: 10_000 });
    await s.t.run(async (ctx) => {
      const order = (await ctx.db.get(o.orderId))!;
      await reserve(ctx, user, 10_000, `intent:${order.intentId}`);
      await settle(ctx, `intent:${order.intentId}`, 'redeemed', 10_000, order._id);
    });
    await s.t.mutation(internal.ldgCredits.reinstateForOrder, { orderId: o.orderId, refundedCents: 72_500, chargeCents: 145_000 });
    await s.t.mutation(internal.ldgCredits.reinstateForOrder, { orderId: o.orderId, refundedCents: 72_500, chargeCents: 145_000 });
    expect((await s.t.run((ctx) => ctx.db.query('ldgCreditAccounts').first()))!.availableMinor).toBe(5_000);
    // commission basis excludes the credit-funded share
    const rows = await obligations(s.t, o.orderId);
    expect(rows.reduce((t, r) => t + r.basisMinor, 0)).toBe(140_000);
  });
});
