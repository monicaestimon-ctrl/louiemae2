import { mutation as indexedMutation } from './functions';
// Retail mappings and the link builder (spec S26, v2 §16, §22). Retail links exist only for
// approved referral members and mapped, published, purchasable retail variants, and always point
// at Louie Mae — even when created inside HOLM. No mapping means a clear unavailable state.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireUser, viewer } from './holmAccess';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit, rateLimit } from './sysCore';
import { assertSellable, evaluate, isCurrentPrice } from './catCore';
import { computeScenarios, recordScenarios } from './catPricing';
import { beneficiaryOf, referralActive } from './prgCore';
import { productRate, schedule } from './prgAttribution';
import { completeExceptionRates } from './prgRateHistory';
import { flag, requireFlag } from '../lib/flags';
import { CommerceError, isCommerceError, customerMessage } from '../lib/errors';
import { retailDetail } from './retailStorefront';
import type { TierKey } from '../lib/config';
import { opaqueId } from '../lib/attribution';

const SITE = 'https://www.louiemae.com';
export const DISCLOSURE_EXAMPLE = '#ad — I earn a commission if you buy through my link.';
// Generic links cannot bypass product qualification or point at authenticated trade pages.
const RETAIL_PAGES = new Set(['/', '/#shop', '/#collection/furniture', '/#collection/decor', '/#new-arrivals']);

async function retailTarget(ctx: QueryCtx, productId: Id<'commerceProducts'>, variantId: string) {
  const retail = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', productId).eq('channel', 'retail')).unique();
  if (retail?.published && retail.snapshot.variants.some((x) => x.id === variantId)) return { productId, variantId, listing: retail };
  // A HOLM variant: use its explicit retail mapping.
  const maps = await ctx.db.query('catRetailMappings').withIndex('by_holm_variant', (q) => q.eq('holmProductId', productId).eq('holmVariantId', variantId).eq('status', 'active')).take(2);
  const map = maps.length === 1 ? maps[0] : null;
  const now = Date.now();
  if (!map || map.effectiveFrom > now || (map.effectiveTo !== undefined && map.effectiveTo <= now)) return null;
  const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', map.retailProductId).eq('channel', 'retail')).unique();
  if (!listing?.published || !listing.snapshot.variants.some((x) => x.id === map.retailVariantId)) return null;
  return { productId: map.retailProductId, variantId: map.retailVariantId, listing };
}

/** The catalog variant behind a retail listing variant (Zuo variants directly; others via their mirror). */
async function catVariantFor(ctx: QueryCtx, productId: Id<'commerceProducts'>, variantId: string) {
  const id = ctx.db.normalizeId('catVariants', variantId);
  if (id) { const row = await ctx.db.get(id); return row?.productId === productId ? row : null; }
  const rows = await ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', productId)).collect();
  return rows.find((r) => r.legacyVariantId === variantId) ?? null;
}

/** Preview and creation share current authority; a recorded qualification flag
 * cannot make a withdrawn, unavailable or unsupported retail listing linkable. */
async function qualifiedRetailTarget(ctx: QueryCtx, productId: Id<'commerceProducts'>, variantId: string, tier: TierKey) {
  const target = await retailTarget(ctx, productId, variantId);
  if (!target) throw new CommerceError('REFERRAL_INELIGIBLE', 'No current retail mapping', "This piece isn't sold on Louie Mae yet, so it has no retail referral link.");
  const current = await retailDetail(ctx, target.productId);
  if (!current?.inStock || !current.variants.some(option => option.id === target.variantId && option.inStock))
    throw new CommerceError('REFERRAL_INELIGIBLE', 'Retail variant unavailable', 'This option is not currently available for retail referrals.');
  const cv = await catVariantFor(ctx, target.productId, target.variantId);
  if (!cv || cv.holds.length || cv.referralEligible !== true) throw new CommerceError('REFERRAL_INELIGIBLE', 'Not prequalified');
  if (cv.availability === 'discontinued') throw new CommerceError('REFERRAL_INELIGIBLE', 'Discontinued', 'This item is no longer sold, so it has no retail referral link.');
  const product = await ctx.db.get(target.productId);
  if (product?.provider === 'zuo') await assertSellable(ctx, cv._id, 'link');
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', target.productId)).first();
  if (!meta || meta.holds.length || meta.commissionCategory === 'review_required') throw new CommerceError('REFERRAL_INELIGIBLE', 'Category under review');
  const sched = await schedule(ctx);
  const rate = await productRate(ctx, target.productId, tier, meta.commissionCategory, sched.value);
  const option = target.listing.snapshot.variants.find(value => value.id === target.variantId)!;
  return { target, category: meta.commissionCategory, rate, option };
}

/** Public status, private eligibility/rate only for the current referral member.
 * No link or membership is created by viewing a product. */
export const preview = query({
  args: { productId: v.id('commerceProducts'), variantId: v.string(), refreshToken: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!flag('RETAIL_LINK_GENERATION_V2_ENABLED') || !flag('COMMISSION_ACCRUAL_V2_ENABLED'))
      return { status: 'unavailable' as const, message: 'Retail referral sharing is not active yet.' };
    const me = await viewer(ctx);
    if (!me) return { status: 'sign_in' as const, message: 'Sign in to check your retail referral membership.' };
    const source = await referralActive(ctx, me.userId);
    const beneficiary = await beneficiaryOf(ctx, me.userId);
    if (!source || beneficiary?.status !== 'active') return { status: 'membership_required' as const, message: 'Activate eligible retail referrals in your account before sharing.' };
    try {
      const qualified = await qualifiedRetailTarget(ctx, args.productId, args.variantId, beneficiary.tierKey);
      return { status: 'eligible' as const, productName: qualified.target.listing.snapshot.name, variantName: qualified.option.name,
        destinationUrl: `${SITE}/products/${qualified.target.productId}?variant=${encodeURIComponent(qualified.target.variantId)}`,
        category: qualified.category, applicableRateBps: qualified.rate.rateBps,
        exceptionNote: qualified.rate.exceptionNote ?? null,
        disclosureExample: DISCLOSURE_EXAMPLE };
    } catch (error) {
      if (isCommerceError(error)) return { status: 'unavailable' as const, message: customerMessage(error) };
      throw error;
    }
  },
});

/** Copy retail referral link: validated destination, the beneficiary's applicable rate and the disclosure example. */
export const create = mutation({
  args: { productId: v.optional(v.id('commerceProducts')), variantId: v.optional(v.string()), path: v.optional(v.string()), channelTag: v.string() },
  handler: async (ctx, a) => {
    requireFlag('RETAIL_LINK_GENERATION_V2_ENABLED');
    // Never promise a rate that the ledger would not pay.
    requireFlag('COMMISSION_ACCRUAL_V2_ENABLED');
    const me = await requireUser(ctx);
    if (!(await rateLimit(ctx, `link:${me.userId}`, 60, 20))) throw new CommerceError('INVALID_INPUT', 'Too many links; wait a moment.');
    const source = await referralActive(ctx, me.userId);
    if (!source) throw new CommerceError('REFERRAL_INELIGIBLE', 'No active referral membership', 'Join the Creator Program, or turn on referrals for your trade account, to make links.');
    const b = await beneficiaryOf(ctx, me.userId);
    if (!b || b.status !== 'active') throw new CommerceError('REFERRAL_INELIGIBLE', 'Beneficiary inactive');
    const channelTag = a.channelTag.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || 'link';
    const now = Date.now();
    if (a.path !== undefined) {
      const path = a.path.trim();
      if (!RETAIL_PAGES.has(path)) throw new CommerceError('INVALID_INPUT', 'Choose a supported Louie Mae retail page. Product links require an eligible product.');
      const linkId = opaqueId(10);
      await ctx.db.insert('prgReferralLinks', { linkId, beneficiaryId: b._id, membershipSource: source, destination: { kind: 'page', path }, channelTag, createdAt: now });
      return { linkId, url: `${SITE}/r/${linkId}`, destination: path, eligibility: 'eligible' as const, disclosureExample: DISCLOSURE_EXAMPLE };
    }
    if (!a.productId || !a.variantId) throw new CommerceError('INVALID_INPUT', 'Choose a product');
    const { target, category, rate, option } = await qualifiedRetailTarget(ctx, a.productId, a.variantId, b.tierKey);
    const linkId = opaqueId(10);
    await ctx.db.insert('prgReferralLinks', { linkId, beneficiaryId: b._id, membershipSource: source, destination: { kind: 'variant', productId: target.productId, variantId: target.variantId }, channelTag, createdAt: now });
    return {
      linkId,
      url: `${SITE}/r/${linkId}`,
      destination: `${target.listing.snapshot.name}${option && option.name !== 'Default Title' ? ` — ${option.name}` : ''}`,
      productName: target.listing.snapshot.name,
      variantName: option?.name ?? '',
      category,
      applicableRateBps: rate.rateBps,
      exceptionNote: rate.exceptionNote ?? null,
      eligibility: 'eligible' as const,
      disclosureExample: DISCLOSURE_EXAMPLE,
    };
  },
});

/** Where an /r/<linkId> visit should land (no beneficiary details are exposed). */
export const resolve = query({
  args: { linkId: v.string() },
  handler: async (ctx, a) => {
    const link = await ctx.db.query('prgReferralLinks').withIndex('by_link', (q) => q.eq('linkId', a.linkId)).first();
    if (!link || link.revokedAt) return { kind: 'home' as const };
    if (link.destination.kind === 'page') return { kind: 'page' as const, path: link.destination.path ?? '/' };
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', link.destination.productId!)).first();
    return { kind: 'product' as const, productId: link.destination.productId!, variantId: link.destination.variantId ?? null, collection: meta?.commissionCategory === 'decor' ? 'decor' : 'furniture' };
  },
});

export const myLinks = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const b = await beneficiaryOf(ctx, me.userId);
    if (!b) return [];
    const rows = await ctx.db.query('prgReferralLinks').withIndex('by_beneficiary', (q) => q.eq('beneficiaryId', b._id)).order('desc').take(100);
    return rows.map((r) => ({ linkId: r.linkId, url: `${SITE}/r/${r.linkId}`, channelTag: r.channelTag, kind: r.destination.kind, createdAt: r.createdAt, revoked: !!r.revokedAt }));
  },
});

// ---------------- admin: retail mappings and manual prequalification ----------------
async function assertRetailVariant(ctx: MutationCtx, productId: Id<'commerceProducts'>, variantId: string) {
  const l = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', productId).eq('channel', 'retail')).unique();
  if (!l?.published || !l.snapshot.variants.some((x) => x.id === variantId)) throw new CommerceError('INVALID_INPUT', 'Retail variant is not published');
}

export const createMapping = mutation({
  args: { holmProductId: v.id('commerceProducts'), holmVariantId: v.string(), retailProductId: v.id('commerceProducts'), retailVariantId: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    await assertRetailVariant(ctx, a.retailProductId, a.retailVariantId);
    const now = Date.now();
    const old = await ctx.db.query('catRetailMappings').withIndex('by_holm_variant', (q) => q.eq('holmProductId', a.holmProductId).eq('holmVariantId', a.holmVariantId).eq('status', 'active')).first();
    if (old) await ctx.db.patch(old._id, { status: 'retired', effectiveTo: now });
    const id = await ctx.db.insert('catRetailMappings', { ...a, status: 'active', ...(old ? { redirectFrom: `${old.retailProductId}:${old.retailVariantId}` } : {}), createdAt: now, createdBy: admin.email, effectiveFrom: now, source: 'admin' });
    await audit(ctx, { actor: admin.email, action: 'mapping.create', entityTable: 'catRetailMappings', entityId: id, after: a });
    return id;
  },
});

export const retireMapping = mutation({
  args: { mappingId: v.id('catRetailMappings'), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    await ctx.db.patch(a.mappingId, { status: 'retired', effectiveTo: Date.now() });
    await audit(ctx, { actor: admin.email, action: 'mapping.retire', entityTable: 'catRetailMappings', entityId: a.mappingId, reason: a.reason });
  },
});

/** Explicit, visible referral eligibility for a variant (manual prequalification or disabling referrals). */
export const setReferralEligibility = indexedMutation({
  args: { variantId: v.id('catVariants'), eligible: v.boolean(), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT', 'Add the economics reason');
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    const supplier = await ctx.db.get(cv.supplierId);
    if (a.eligible && supplier?.code === 'zuo') {
      const freshness = await evaluate(ctx, cv);
      const price = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
      if (freshness.holds.length || !isCurrentPrice(price, cv._id, 'retail'))
        throw new CommerceError('COST_REVIEW_REQUIRED', 'Current cost, stock and approved retail price are required before enabling referrals');
      const economics = await computeScenarios(ctx, cv);
      if (!economics.referralQualified || economics.belowMinimum)
        throw new CommerceError('REFERRAL_INELIGIBLE', 'The approved retail price does not fund its current commission and margin policy');
      await recordScenarios(ctx, cv._id, admin.email);
    }
    await ctx.db.patch(cv._id, { referralEligible: a.eligible, updatedAt: Date.now() });
    await audit(ctx, { actor: admin.email, action: a.eligible ? 'referral.enable' : 'referral.disable', entityTable: 'catVariants', entityId: cv._id, reason: a.reason });
  },
});

/** A visible, dated, tier-by-tier commission schedule for one product (never an undisclosed cap). */
export const createException = mutation({
  args: { productId: v.id('commerceProducts'), rates: v.array(v.object({ tierKey: v.union(v.literal('base'), v.literal('active'), v.literal('top'), v.literal('elite')), rateBps: v.number() })), visibleNote: v.string(), effectiveFrom: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!completeExceptionRates(a.rates)) throw new CommerceError('INVALID_INPUT', 'Give exactly one rate for each of the four tiers (0–23%).');
    if (!a.visibleNote.trim()) throw new CommerceError('INVALID_INPUT', 'Exceptions must carry a note shown to partners.');
    const now = Date.now();
    const starts = a.effectiveFrom ?? now;
    if (!Number.isSafeInteger(starts) || starts < now) throw new CommerceError('INVALID_INPUT', 'Exception effective date must be now or in the future.');
    if (!(await ctx.db.get(a.productId))) throw new CommerceError('INVALID_INPUT', 'Product not found.');
    const prev = await ctx.db.query('prgSkuCommissionExceptions').withIndex('by_product_effective', (q) => q.eq('productId', a.productId)).order('desc').first();
    if (prev && starts <= prev.effectiveFrom) throw new CommerceError('INVALID_INPUT', 'The next exception must start after the latest scheduled version.');
    if (prev && (prev.effectiveTo === undefined || prev.effectiveTo > starts)) await ctx.db.patch(prev._id, { effectiveTo: starts });
    const id = await ctx.db.insert('prgSkuCommissionExceptions', { productId: a.productId, rates: a.rates, effectiveFrom: starts, visibleNote: a.visibleNote.trim(), approvedBy: admin.email, version: (prev?.version ?? 0) + 1, createdAt: now });
    await audit(ctx, { actor: admin.email, action: 'commission.exception', entityTable: 'prgSkuCommissionExceptions', entityId: id, after: a });
    return id;
  },
});
