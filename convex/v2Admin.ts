import { requireDeliveryRole } from './dlvAccess';
// Admin consoles for v2 operations (spec S35, v2 §20) and public flag states for the portals.
// Every admin query requires the admin allowlist; supplier costs and customer details never
// reach creators or trade users through these.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit } from './sysCore';
import { resolveHold } from './catCore';
import { flag } from '../lib/flags';
import { holdReason } from './v2Validators';
import { CommerceError } from '../lib/errors';
import { maybeConfig } from './sysConfig';
import { programTerms } from '../lib/programTerms';
import type { AttributionPolicy, CommissionSchedule, CreditPolicy, OperatorDetails, PayoutSchedule, TierPolicy } from '../lib/config';

/** Which v2 experiences are switched on (booleans only; safe for any visitor). */
export const publicFlags = query({
  args: {},
  handler: () => ({
    creatorEnrollment: flag('CREATOR_ENROLLMENT_V2_ENABLED'),
    retailLinks: flag('RETAIL_LINK_GENERATION_V2_ENABLED') && flag('COMMISSION_ACCRUAL_V2_ENABLED'),
    ledger: flag('COMMISSION_ACCRUAL_V2_ENABLED'),
    credit: flag('CREDIT_V2_ENABLED'),
    delivery: flag('DELIVERY_AUTOMATION_ENABLED'),
    zuoCheckout: flag('RETAIL_ZUO_CHECKOUT_ENABLED'),
    tradeOnly: flag('HOLM_TRADE_ONLY_ENABLED'),
    payouts: flag('PAYOUT_EXECUTION_ENABLED'),
  }),
});

export const reviewQueue = query({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    if (a.kind) return ctx.db.query('sysReviewItems').withIndex('by_kind_status', (q) => q.eq('kind', a.kind!).eq('status', 'open')).order('desc').take(200);
    const rows = await ctx.db.query('sysReviewItems').order('desc').take(400);
    return rows.filter((r) => r.status === 'open');
  },
});

export const resolveReview = mutation({
  args: { id: v.id('sysReviewItems'), resolution: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.resolution.trim()) throw new CommerceError('INVALID_INPUT', 'Describe the resolution');
    const r = await ctx.db.get(a.id);
    if (!r || r.status !== 'open') return;
    if (r.kind === 'ledger_adjustment_pending') throw new CommerceError('INVALID_INPUT', 'Confirm or decline large adjustments from the ledger screen');
    await ctx.db.patch(r._id, { status: 'resolved', resolution: a.resolution.slice(0, 1000), resolvedBy: admin.email, resolvedAt: Date.now() });
    await audit(ctx, { actor: admin.email, action: 'review.resolve', entityTable: 'sysReviewItems', entityId: r._id, reason: a.resolution });
  },
});

/** Cost and policy queue: open holds by reason, with the variant and product they block. */
export const openHolds = query({
  args: { reason: v.optional(holdReason) },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const rows = a.reason
      ? await ctx.db.query('catHolds').withIndex('by_reason_open', (q) => q.eq('reason', a.reason!).eq('resolvedAt', undefined)).take(300)
      : (await ctx.db.query('catHolds').order('desc').take(600)).filter((h) => h.resolvedAt === undefined);
    return Promise.all(
      rows.map(async (h) => {
        const cv = await ctx.db.get(h.variantId);
        const meta = cv ? await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', cv.productId)).first() : null;
        return { ...h, sku: cv?.supplierSku ?? '', packId: cv?.packId ?? '', productId: cv?.productId ?? null, product: meta?.louieMaeName ?? '' };
      })
    );
  },
});

/** People-resolved holds (e.g. METHOD_CHANGED after a delivery quote, SOURCE_ABSENT after verification). */
export const resolveHoldAdmin = mutation({
  args: { variantId: v.id('catVariants'), reason: holdReason, resolution: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (a.resolution.trim().length < 5) throw new CommerceError('INVALID_INPUT', 'Record how it was resolved');
    await resolveHold(ctx, a.variantId, a.reason, admin.email, a.resolution);
    await audit(ctx, { actor: admin.email, action: 'hold.resolve', entityTable: 'catVariants', entityId: a.variantId, after: a.reason, reason: a.resolution });
  },
});

export const paidExceptions = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'finance');
    return ctx.db.query('ordPaidExceptions').withIndex('by_status', (q) => q.eq('status', 'open')).order('desc').take(200);
  },
});

/** Paid-but-unfulfillable payments: resolved with the customer (refund or new order), never silently. */
export const resolvePaidException = mutation({
  args: { id: v.id('ordPaidExceptions'), resolution: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    if (a.resolution.trim().length < 5) throw new CommerceError('INVALID_INPUT', 'Record what was agreed with the customer');
    await ctx.db.patch(a.id, { status: 'resolved', resolution: a.resolution.slice(0, 1000) });
    await audit(ctx, { actor: admin.email, action: 'paid_exception.resolve', entityTable: 'ordPaidExceptions', entityId: a.id, reason: a.resolution });
  },
});

export const creatorReviews = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const rows = await ctx.db.query('prgMemberships').withIndex('by_program_state', (q) => q.eq('program', 'creator').eq('state', 'review')).take(100);
    return Promise.all(rows.map(async (m) => ({ userId: m.userId, email: ((await ctx.db.get(m.userId))?.email as string) ?? '', profile: m.profile ?? null, reasons: m.reviewReasons ?? [], since: m.updatedAt })));
  },
});

export const beneficiaries = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    return (await ctx.db.query('prgBeneficiaries').order('desc').take(300)).map((b) => ({ id: b._id, name: b.displayName, tier: b.tierKey, status: b.status, payoutReadiness: b.payoutReadiness, taxReadiness: b.taxReadiness, refCode: b.refCode ?? null }));
  },
});

/** Publication pipeline at a glance: products per stage. */
export const pipeline = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const stages = ['imported_draft', 'evidence_review', 'economics_review', 'content_review', 'ready', 'published', 'archived'] as const;
    const out: Record<string, { count: number; sample: { productId: string; name: string; holds: string[] }[] }> = {};
    for (const s of stages) {
      const rows = await ctx.db.query('catProductMeta').withIndex('by_stage', (q) => q.eq('stage', s)).take(500);
      out[s] = { count: rows.length, sample: rows.slice(0, 25).map((m) => ({ productId: m.productId, name: m.louieMaeName, holds: m.holds })) };
    }
    return out;
  },
});

/** The v2 program terms built from approved configuration, or what is still missing (no placeholders). */
export const programTermsView = query({
  args: {},
  handler: async (ctx) => {
    const get = async <T,>(kind: Parameters<typeof maybeConfig>[1], key: string) => (await maybeConfig<T>(ctx, kind, key))?.value ?? null;
    const clearing = await get<{ clearAfterDays: number }>('clearingPolicy', 'clearing');
    return programTerms({
      operator: await get<OperatorDetails>('operatorDetails', 'operator'),
      schedule: await get<CommissionSchedule>('commissionSchedule', 'commission-schedule'),
      tier: await get<TierPolicy>('tierPolicy', 'tier-policy'),
      attribution: await get<AttributionPolicy>('attributionPolicy', 'attribution'),
      payout: await get<PayoutSchedule>('payoutSchedule', 'payout-schedule'),
      credit: await get<CreditPolicy>('creditPolicy', 'business-credit'),
      clearingDays: clearing?.clearAfterDays ?? null,
    });
  },
});
