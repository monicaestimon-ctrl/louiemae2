// Attribution v2 and rate protection (spec S27, v2 §16). Clicks are recorded server-side with an
// opaque id, the beneficiary, consent, terms and a rate snapshot. At checkout the last eligible
// click within exactly 30×24h wins; every eligible basket line gets the higher of its protected
// and current rate. The client never sends a beneficiary or a commission amount.
import { v } from 'convex/values';
import { mutation } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { viewer } from './holmAccess';
import { activeConfig, maybeConfig } from './sysConfig';
import { bumpMetric, openReview, rateLimit } from './sysCore';
import { orgRole } from './prgCore';
import { currentTerms } from './prgMemberships';
import { flag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import { ATTRIBUTION_WINDOW_MS, appliedRate, looksLikeBot, opaqueId, visitorKeyHash, winningClick } from '../lib/attribution';
import { rateFor } from '../lib/tiers';
import type { AttributionPolicy, CommissionCategory, CommissionSchedule, TierKey } from '../lib/config';
import { REF_CODE } from '../lib/holmPartners';

type Ctx = QueryCtx | MutationCtx;

export async function schedule(ctx: Ctx) {
  const s = await activeConfig<CommissionSchedule>(ctx, 'commissionSchedule', 'commission-schedule');
  return { value: s.value, version: s.version };
}

/** The rate for a product and tier: a visible SKU exception schedule wins over the category schedule. */
export async function productRate(ctx: Ctx, productId: Id<'commerceProducts'>, tier: TierKey, category: CommissionCategory, sched: CommissionSchedule, at = Date.now()) {
  const exc = await ctx.db.query('prgSkuCommissionExceptions').withIndex('by_product_effective', (q) => q.eq('productId', productId)).order('desc').take(10);
  const live = exc.find((e) => e.effectiveFrom <= at && (e.effectiveTo === undefined || e.effectiveTo > at));
  const fromException = live?.rates.find((r) => r.tierKey === tier)?.rateBps;
  return { rateBps: Math.min(fromException ?? rateFor(sched, tier, category), sched.ceilingBps), exceptionVersion: live?.version };
}

async function isSelf(ctx: Ctx, b: Doc<'prgBeneficiaries'>, userId: Id<'users'> | undefined, email?: string) {
  if (userId && (b.userId === userId || b.legacyUserId === userId)) return true;
  if (userId && b.organizationId && (await orgRole(ctx, b.organizationId, userId))) return true;
  if (email && b.userId) {
    const u = await ctx.db.get(b.userId);
    if (typeof u?.email === 'string' && u.email.toLowerCase() === email.toLowerCase()) return true;
  }
  return false;
}

/** Records one click. Returns its opaque id and whether it can win attribution. */
export async function recordClickCore(
  ctx: MutationCtx,
  a: { linkId?: string; refCode?: string; visitorKey: string; userAgent: string; referrerHost?: string; consent: 'granted' | 'denied' | 'unknown' }
) {
  if (!/^[\w-]{16,64}$/.test(a.visitorKey)) throw new CommerceError('INVALID_INPUT', 'Bad visitor key');
  if (!(await rateLimit(ctx, `click:${a.visitorKey}`, 30, 30))) return { clickId: null, eligible: false };
  let beneficiary: Doc<'prgBeneficiaries'> | null = null;
  let link: Doc<'prgReferralLinks'> | null = null;
  if (a.linkId) {
    link = await ctx.db.query('prgReferralLinks').withIndex('by_link', (q) => q.eq('linkId', a.linkId!)).first();
    if (link && !link.revokedAt) beneficiary = await ctx.db.get(link.beneficiaryId);
  } else if (a.refCode && REF_CODE.test(a.refCode)) beneficiary = await ctx.db.query('prgBeneficiaries').withIndex('by_refCode', (q) => q.eq('refCode', a.refCode)).first();
  if (!beneficiary) return { clickId: null, eligible: false };
  const me = await viewer(ctx);
  const policy = await maybeConfig<AttributionPolicy>(ctx, 'attributionPolicy', 'attribution');
  const reasons: string[] = [];
  if (looksLikeBot(a.userAgent)) reasons.push('bot');
  if (beneficiary.status !== 'active') reasons.push('beneficiary_inactive');
  if (await isSelf(ctx, beneficiary, me?.userId)) reasons.push('self');
  if (a.referrerHost && /(^|\.)louiemae\.com$/i.test(a.referrerHost) && !a.linkId) reasons.push('internal');
  if (a.consent === 'denied' || (a.consent === 'unknown' && !policy?.value.consentUnknownAllowsStorage)) reasons.push('consent');
  const sched = await schedule(ctx);
  let product: Doc<'prgReferralClicks'>['rateSnapshot']['product'];
  if (link?.destination.kind === 'variant' && link.destination.productId) {
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', link!.destination.productId!)).first();
    const category = meta?.commissionCategory ?? 'review_required';
    if (category !== 'review_required') {
      const r = await productRate(ctx, link.destination.productId, beneficiary.tierKey, category, sched.value);
      product = { productId: link.destination.productId, category, rateBps: r.rateBps, ...(r.exceptionVersion !== undefined ? { exceptionVersion: r.exceptionVersion } : {}) };
    }
  }
  const now = Date.now();
  const clickId = opaqueId(12);
  const terms = await currentTerms(ctx, 'referral');
  await ctx.db.insert('prgReferralClicks', {
    clickId,
    ...(link ? { linkId: link.linkId } : {}),
    ...(a.refCode ? { legacyRefCode: a.refCode } : {}),
    beneficiaryId: beneficiary._id,
    membershipSource: link?.membershipSource ?? 'creator',
    visitorKeyHash: await visitorKeyHash(a.visitorKey),
    ...(me ? { userId: me.userId } : {}),
    consent: a.consent,
    eligible: reasons.length === 0,
    ...(reasons.length ? { ineligibleReason: reasons.join(',') } : {}),
    ...(terms ? { termsVersion: terms.version } : {}),
    rateSnapshot: { tierKey: beneficiary.tierKey, scheduleVersion: sched.version, ...(product ? { product } : {}) },
    at: now,
    expiresAt: now + (policy?.value.windowMs ?? ATTRIBUTION_WINDOW_MS),
  });
  await bumpMetric(ctx, reasons.length ? 'attribution.click_ineligible' : 'attribution.click');
  return { clickId, eligible: reasons.length === 0 };
}

export const recordClick = mutation({
  args: { linkId: v.optional(v.string()), refCode: v.optional(v.string()), visitorKey: v.string(), userAgent: v.string(), referrerHost: v.optional(v.string()), consent: v.union(v.literal('granted'), v.literal('denied'), v.literal('unknown')) },
  handler: async (ctx, a) => {
    if (!flag('ATTRIBUTION_V2_ENABLED')) return { clickId: null, eligible: false };
    return recordClickCore(ctx, a);
  },
});

/** A signed-in visitor: associate this browser's clicks with the account for cross-device credit. */
export const associateVisitor = mutation({
  args: { visitorKey: v.string() },
  handler: async (ctx, a) => {
    if (!flag('ATTRIBUTION_V2_ENABLED')) return;
    const me = await viewer(ctx);
    if (!me || !/^[\w-]{16,64}$/.test(a.visitorKey)) return;
    const hash = await visitorKeyHash(a.visitorKey);
    const clicks = await ctx.db.query('prgReferralClicks').withIndex('by_visitor_at', (q) => q.eq('visitorKeyHash', hash).gte('at', Date.now() - ATTRIBUTION_WINDOW_MS)).take(50);
    for (const c of clicks) if (!c.userId) await ctx.db.patch(c._id, { userId: me.userId });
  },
});

/** The winning click for a buyer (this browser, or the signed-in account's associated clicks). */
export async function winningFor(ctx: Ctx, visitorKey: string | undefined, userId: Id<'users'> | undefined, now = Date.now()) {
  const since = now - ATTRIBUTION_WINDOW_MS - 1;
  const rows: Doc<'prgReferralClicks'>[] = [];
  if (visitorKey && /^[\w-]{16,64}$/.test(visitorKey)) {
    const hash = await visitorKeyHash(visitorKey);
    rows.push(...(await ctx.db.query('prgReferralClicks').withIndex('by_visitor_at', (q) => q.eq('visitorKeyHash', hash).gte('at', since)).take(200)));
  }
  if (userId) rows.push(...(await ctx.db.query('prgReferralClicks').withIndex('by_user_at', (q) => q.eq('userId', userId).gte('at', since)).take(200)));
  return winningClick(rows, now);
}

export type SnapshotLine = { lineKey: string; productId: Id<'commerceProducts'>; variantId: Id<'catVariants'>; category: CommissionCategory | 'review_required' };

/**
 * Freezes attribution for a retail checkout: beneficiary, scope (whole basket) and each line's
 * protected, current and applied rate. Self-referrals and trade checkouts get no snapshot.
 */
export async function snapshotForIntent(ctx: MutationCtx, a: { intentId: Id<'ordCheckoutIntents'>; visitorKey?: string; buyer: { userId?: Id<'users'>; email?: string }; lines: SnapshotLine[]; channel: 'retail' | 'trade'; businessReferral?: boolean }) {
  if (!flag('ATTRIBUTION_V2_ENABLED') || a.channel !== 'retail') return null;
  const click = await winningFor(ctx, a.visitorKey, a.buyer.userId);
  if (!click) return null;
  const b = await ctx.db.get(click.beneficiaryId);
  if (!b || b.status !== 'active') return null;
  if (await isSelf(ctx, b, a.buyer.userId, a.buyer.email)) {
    await bumpMetric(ctx, 'attribution.self_referral_blocked');
    return null;
  }
  // A referred business buying through its referrer's link: the business-referral credit flow is
  // chosen before checkout, so the same beneficiary earns no retail commission on this order.
  let businessReferral = !!a.businessReferral;
  if (!businessReferral && flag('CREDIT_V2_ENABLED') && a.buyer.userId && b.legacyUserId) {
    const ref = await ctx.db.query('holmReferrals').withIndex('by_referred', (q) => q.eq('referredUserId', a.buyer.userId!)).first();
    businessReferral = !!ref && ref.referrerId === b.legacyUserId && ref.status !== 'credited';
  }
  const sched = await schedule(ctx);
  const lines = [];
  for (const l of a.lines) {
    const variant = await ctx.db.get(l.variantId);
    const eligible = l.category !== 'review_required' && variant?.referralEligible === true && !businessReferral;
    if (!eligible || l.category === 'review_required') {
      lines.push({ lineKey: l.lineKey, productId: l.productId, category: l.category, protectedRateBps: 0, currentRateBps: 0, appliedRateBps: 0, eligible: false, reason: businessReferral ? 'business referral chosen' : 'not referral-eligible' });
      continue;
    }
    const current = (await productRate(ctx, l.productId, b.tierKey, l.category, sched.value)).rateBps;
    const snap = click.rateSnapshot;
    const protectedBps = snap.product?.productId === l.productId ? snap.product.rateBps : (await productRate(ctx, l.productId, snap.tierKey, l.category, sched.value)).rateBps;
    lines.push({ lineKey: l.lineKey, productId: l.productId, category: l.category, protectedRateBps: protectedBps, currentRateBps: current, appliedRateBps: appliedRate(protectedBps, current), eligible: true });
  }
  return ctx.db.insert('prgAttributionSnapshots', { intentId: a.intentId, clickId: click.clickId, beneficiaryId: b._id, membershipSource: click.membershipSource, scope: 'basket', lines, tierKeyAtPurchase: b.tierKey, scheduleVersion: sched.version, createdAt: Date.now() });
}

/** A shared delivery address alone opens review; it never makes an automatic, irreversible finding. */
export async function flagSharedAddress(ctx: MutationCtx, snapshotId: Id<'prgAttributionSnapshots'>, detail: string) {
  await openReview(ctx, 'attribution_shared_address', 'prgAttributionSnapshots', snapshotId, detail);
}
