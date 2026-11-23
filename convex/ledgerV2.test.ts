// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { accrueForOrder } from './ldgCommissions';
import { onOrderPaid, reserve, settle, available } from './ldgCredits';
import { applyCreditEvent, obligationEventTotals } from './ldgCore';
import { reconcileAward, reconcileAwardsForOrder } from './businessCreditAwards';
import { rollUp } from './ordFulfillment';
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
  it('honors an existing frozen retail rate during recovery while new accrual is paused, without rewarding trade purchases', async () => {
    const s = await setup();
    process.env.COMMISSION_ACCRUAL_V2_ENABLED = 'false';
    const retail = await attributedOrder(s.t);
    expect(await obligations(s.t, retail.orderId)).toHaveLength(0);
    await s.t.run(ctx => accrueForOrder(ctx, retail.orderId, true));
    await s.t.run(ctx => accrueForOrder(ctx, retail.orderId, true));
    expect((await obligations(s.t, retail.orderId)).map(o => o.earnedMinor).sort()).toEqual([10000, 5000].sort());
    const trade = await attributedOrder(s.t);
    await s.t.run(ctx => ctx.db.patch(trade.orderId, { channel: 'trade' }));
    expect(await s.t.run(ctx => accrueForOrder(ctx, trade.orderId, true))).toBe(0);
    expect(await obligations(s.t, trade.orderId)).toHaveLength(0);
  });
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
    await expect(refund(200_000)).rejects.toSatisfy(e => isCommerceError(e, 'INVALID_INPUT')); // impossible evidence cannot alter either ledger
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

  async function businessAward() {
    const s = await setup();
    await s.approve('business-credit');
    const b = await referredBusiness(s.t);
    const order = await attributedOrder(s.t, { buyerUserId: b.biz });
    await s.t.run(ctx => onOrderPaid(ctx, order.orderId));
    const award = (await s.t.run(ctx => ctx.db.query('ldgCreditEvents').filter(q => q.eq(q.field('type'), 'award_pending')).unique()))!;
    const account = () => s.t.run(ctx => ctx.db.get(award.accountId));
    const clear = async () => {
      vi.setSystemTime(Date.now() + 31 * DAY);
      await s.t.mutation(internal.ldgCredits.awardDue, {});
      // The installed harness caps recursive draining at 100 by default; this fixture deliberately exceeds it.
      for (let page = 0; page < 110; page++) {
        vi.runAllTimers();
        await s.t.finishInProgressScheduledFunctions();
      }
      await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    return { ...s, ...b, order, award, account, clear };
  }

  it('rejects impossible refund evidence and keeps the confirmed cumulative amount monotonic', async () => {
    const s = await businessAward();
    const refund = (refundedMinor: number, chargeMinor = 155000) => s.t.run(ctx => reconcileAwardsForOrder(ctx, s.order.orderId, { refundedMinor, chargeMinor }));
    await refund(10000);
    await refund(5000);
    for (const [amount, charge] of [[-1,155000], [155001,155000], [1,154999], [1.5,155000]]) {
      await expect(refund(amount, charge)).rejects.toSatisfy(e => isCommerceError(e, 'INVALID_INPUT'));
    }
    expect((await s.t.run(ctx => ctx.db.get(s.order.orderId)))?.confirmedCashRefundMinor).toBe(10000);
  });

  it('cancels a fully refunded pending award without falling back to original merchandise', async () => {
    const s = await businessAward();
    await s.t.run(async ctx => {
      for (const line of await ctx.db.query('ordOrderLines').withIndex('by_order', q => q.eq('orderId', s.order.orderId)).collect()) {
        await ctx.db.patch(line._id, { refundedMinor: line.unitPackMinor });
      }
      await reconcileAwardsForOrder(ctx, s.order.orderId);
    });
    await s.clear();
    expect(await s.account()).toMatchObject({ pendingAwardMinor: 0, availableMinor: 0 });
  });

  it('reverses a cleared award once after verified full cash refund, including duplicate and older notifications', async () => {
    const s = await businessAward();
    await s.clear();
    for (const refundedCents of [155000, 155000, 10000]) {
      await s.t.mutation(internal.ldgCommissions.onPaymentEvent, { paymentIntentId: s.order.pi, kind: 'refund', refundedCents, chargeCents: 155000 });
    }
    expect(await s.account()).toMatchObject({ availableMinor: 0, pendingAwardMinor: 0 });
    const reversals = await s.t.run(ctx => ctx.db.query('ldgCreditEvents').filter(q => q.eq(q.field('type'), 'reversed')).collect());
    expect(reversals.map(e => e.amountMinor)).toEqual([10000]);
  });

  it('preserves spent award history and records one future offset through source-bound admin reversal', async () => {
    const s = await businessAward();
    await s.clear();
    await s.t.run(async ctx => {
      await reserve(ctx, s.referrer, 6000, 'spent-credit');
      await settle(ctx, 'spent-credit', 'redeemed');
    });
    const args = { awardEventId: s.award._id, reason: 'Verified referral fraud' };
    await expect(s.t.mutation(api.ldgCredits.reverseAward, args)).rejects.toThrow();
    await s.admin.mutation(api.ldgCredits.reverseAward, args);
    await s.admin.mutation(api.ldgCredits.reverseAward, args);
    expect(await s.account()).toMatchObject({ availableMinor: -6000 });
    const offsets = await s.t.run(ctx => ctx.db.query('ldgCreditEvents').filter(q => q.eq(q.field('type'), 'offset_created')).collect());
    expect(offsets.map(e => e.amountMinor)).toEqual([6000]);
  });

  it('holds ambiguous partial refunds visibly, blocks new credit holds, and resolves from exact line evidence', async () => {
    const s = await businessAward();
    await s.clear();
    await s.t.run(ctx => reconcileAwardsForOrder(ctx, s.order.orderId, { refundedMinor: 105000, chargeMinor: 155000 }));
    expect(await s.account()).toMatchObject({ availableMinor: 10000 }); // ledger is not guessed away
    expect(await s.t.run(ctx => available(ctx, s.referrer))).toBe(0);
    expect(await s.t.run(ctx => reserve(ctx, s.referrer, 10000, 'new-checkout'))).toBe(0);
    const signed = s.t.withIdentity({ subject: `${s.referrer}|s`, email: 'ref@x.com' });
    expect(await signed.query(api.ldgCredits.myCreditV2, {})).toMatchObject({ reviewRequired: true, availableMinor: 0 });
    await s.t.run(async ctx => {
      const lines = await ctx.db.query('ordOrderLines').withIndex('by_order', q => q.eq('orderId', s.order.orderId)).collect();
      for (const line of lines) await ctx.db.patch(line._id, { refundedMinor: line.unitPackMinor });
      await reconcileAwardsForOrder(ctx, s.order.orderId);
    });
    expect(await signed.query(api.ldgCredits.myCreditV2, {})).toMatchObject({ reviewRequired: false, availableMinor: 0 });
    expect(await s.account()).toMatchObject({ availableMinor: 0 });
  });

  it('resolves allocated refunds at the exact threshold and excludes retained restocking fees', async () => {
    const s = await businessAward();
    await s.clear();
    await s.t.run(ctx => reconcileAwardsForOrder(ctx, s.order.orderId, { refundedMinor: 105000, chargeMinor: 155000 }));
    await s.t.run(async ctx => {
      const line = (await ctx.db.query('ordOrderLines').withIndex('by_order', q => q.eq('orderId', s.order.orderId)).collect()).find(l => l.unitPackMinor === 100000)!;
      await ctx.db.patch(line._id, { refundedMinor: 100000 });
      await ctx.db.insert('ordReturns', { orderLineId: line._id, policyKey: 'fixture', reason: 'Return', pieces: 1, restockingMinor: 0, refund: { merchandise: 100000, tax: 0, delivery: 5000, creditRestored: 0, cash: 105000 }, goodwill: false, status: 'refunded', createdBy: 'fixture', createdAt: Date.now() });
      await reconcileAwardsForOrder(ctx, s.order.orderId);
    });
    expect(await s.t.run(ctx => available(ctx, s.referrer))).toBe(10000); // $500 kept, delivery excluded
    await s.t.run(async ctx => {
      const line = (await ctx.db.query('ordOrderLines').withIndex('by_order', q => q.eq('orderId', s.order.orderId)).collect()).find(l => l.unitPackMinor === 50000)!;
      await ctx.db.patch(line._id, { refundedMinor: 40000 });
      await ctx.db.insert('ordReturns', { orderLineId: line._id, policyKey: 'fixture', reason: 'Return', pieces: 1, restockingMinor: 10000, refund: { merchandise: 40000, tax: 0, delivery: 0, creditRestored: 0, cash: 40000 }, goodwill: false, status: 'authorized', createdBy: 'fixture', createdAt: Date.now() });
      // Reset the line: the real transition owns the refunded counter.
      await ctx.db.patch(line._id, { refundedMinor: 0 });
    });
    const returns = await s.t.run(ctx => ctx.db.query('ordReturns').collect());
    await s.admin.mutation(api.ordReturns.transition, { returnId: returns.find(r => r.status === 'authorized')!._id, to: 'refunded' });
    expect(await s.account()).toMatchObject({ availableMinor: 0 });
  });

  it('allows a later first qualifying order but rejects self-referrals and pre-referral customers', async () => {
    const s = await setup();
    await s.approve('business-credit');
    const b = await referredBusiness(s.t);
    const small = await attributedOrder(s.t, { buyerUserId: b.biz, credit: 100001 });
    expect(await s.t.run(ctx => onOrderPaid(ctx, small.orderId))).toBeNull();
    const next = await attributedOrder(s.t, { buyerUserId: b.biz });
    expect(await s.t.run(ctx => onOrderPaid(ctx, next.orderId))).toBe(`award:${b.biz}`);
    const self = await referredBusiness(s.t);
    await s.t.run(async ctx => {
      const referral = (await ctx.db.query('holmReferrals').withIndex('by_referred', q => q.eq('referredUserId', self.biz)).unique())!;
      await ctx.db.patch(referral._id, { referrerId: self.biz });
    });
    const own = await attributedOrder(s.t, { buyerUserId: self.biz });
    expect(await s.t.run(ctx => onOrderPaid(ctx, own.orderId))).toBeNull();
    const old = await referredBusiness(s.t);
    const paid = await attributedOrder(s.t, { buyerUserId: old.biz });
    await s.t.run(async ctx => {
      const referral = (await ctx.db.query('holmReferrals').withIndex('by_referred', q => q.eq('referredUserId', old.biz)).unique())!;
      await ctx.db.patch(referral._id, { createdAt: Date.now() + 1 });
    });
    expect(await s.t.run(ctx => onOrderPaid(ctx, paid.orderId))).toBeNull();
  });

  it('uses original award terms and withholds records whose accepted terms or complete lines are missing', async () => {
    const s = await businessAward();
    await s.t.run(async ctx => {
      const config = (await ctx.db.get(s.award.awardPolicy!.configId))!;
      await ctx.db.patch(config._id, { value: { ...config.value as object, qualifyingMinMinor: 200000 } });
    });
    await s.clear();
    expect(await s.account()).toMatchObject({ availableMinor: 10000 });
    await s.t.run(async ctx => {
      await ctx.db.patch(s.award._id, { awardPolicy: undefined });
      expect((await reconcileAward(ctx, (await ctx.db.get(s.award._id))!)).status).toBe('review');
      await ctx.db.patch(s.award._id, { awardPolicy: s.award.awardPolicy });
      for (const line of await ctx.db.query('ordOrderLines').withIndex('by_order', q => q.eq('orderId', s.order.orderId)).collect()) await ctx.db.delete(line._id);
      expect((await reconcileAward(ctx, (await ctx.db.get(s.award._id))!)).status).toBe('review');
    });
    expect(await s.t.run(ctx => available(ctx, s.referrer))).toBe(0);
  });

  it('walks past more than 100 settled historical awards to release the later eligible one', async () => {
    const s = await businessAward();
    await s.t.run(async ctx => {
      for (let i = 0; i < 101; i++) {
        const key = `historical:${i}`;
        await applyCreditEvent(ctx, { eventKey: key, userId: s.referrer, type: 'award_pending', amountMinor: 100, ref: key, availableAt: 0, actor: 'fixture' });
        await applyCreditEvent(ctx, { eventKey: `award-settled:${key}`, userId: s.referrer, type: 'award_cancelled', amountMinor: 100, ref: key, actor: 'fixture' });
      }
    });
    await s.clear();
    expect(await s.account()).toMatchObject({ pendingAwardMinor: 0, availableMinor: 10000 });
  });

  it('reconciles cancelled parent orders and does not settle while the program is disabled', async () => {
    const s = await businessAward();
    process.env.CREDIT_V2_ENABLED = 'false';
    await s.clear();
    expect(await s.account()).toMatchObject({ pendingAwardMinor: 10000, availableMinor: 0 });
    await s.t.run(ctx => rollUp(ctx, s.order.orderId)); // no live allocations -> cancelled
    expect(await s.account()).toMatchObject({ pendingAwardMinor: 0, availableMinor: 0 });
    process.env.CREDIT_V2_ENABLED = 'true';
    await expect(s.t.mutation(internal.ldgCredits.awardDue, { cutoff: Date.now() + DAY })).rejects.toSatisfy(e => isCommerceError(e, 'INVALID_INPUT'));
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

describe('legacy ledger sync at payout cutover', () => {
  it('mirrors legacy commissions and follows later reductions and voids, only on the v2 route', async () => {
    const s = await setup();
    const ids = await s.t.run(async (ctx) => {
      const partner = await ctx.db.insert('users', { email: 'legacy@x.com' });
      await ctx.db.insert('holmProfiles', { userId: partner, displayName: 'Legacy', tradeStatus: 'none', partnerStatus: 'active', partnerTier: 'base', refCode: 'LEGACY1', createdAt: 0, updatedAt: 0 });
      const c1 = await ctx.db.insert('holmCommissions', { partnerId: partner, source: 'storefront_order', baseCents: 10_000, rateBps: 1000, amountCents: 1_000, status: 'cleared', clearsAt: 0, createdAt: 0 });
      const c2 = await ctx.db.insert('holmCommissions', { partnerId: partner, source: 'house_quote', baseCents: 20_000, rateBps: 1000, amountCents: 2_000, status: 'pending', clearsAt: Date.now() + DAY, createdAt: 0 });
      return { c1, c2 };
    });
    expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toEqual({ skipped: 'legacy payout route active' });
    process.env.PAYOUT_EXECUTION_ENABLED = 'true';
    expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toEqual({ mirrored: 2, adjusted: 0 });
    expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toEqual({ mirrored: 0, adjusted: 0 });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(ids.c1, { amountCents: 400 });
      await ctx.db.patch(ids.c2, { amountCents: 0, status: 'void' });
    });
    expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toEqual({ mirrored: 0, adjusted: 2 });
    expect(await s.t.mutation(internal.v2Migrations.syncLegacyLedgerPage, {})).toEqual({ mirrored: 0, adjusted: 0 });
    const parity = await s.t.query(internal.v2Migrations.ledgerParity, {});
    expect(parity.mismatches).toEqual([]);
    delete process.env.PAYOUT_EXECUTION_ENABLED;
  });
});
