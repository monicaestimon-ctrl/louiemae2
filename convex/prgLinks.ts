// Retail mappings and the link builder (spec S26, v2 §16, §22). Retail links exist only for
// approved referral members and mapped, published, purchasable retail variants, and always point
// at Louie Mae — even when created inside HOLM. No mapping means a clear unavailable state.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireUser } from './holmAccess';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit, rateLimit } from './sysCore';
import { assertSellable } from './catCore';
import { beneficiaryOf, referralActive } from './prgCore';
import { productRate, schedule } from './prgAttribution';
import { requireFlag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import { opaqueId } from '../lib/attribution';
import { safeRedirect } from '../lib/enrollment';

const SITE = 'https://www.louiemae.com';
export const DISCLOSURE_EXAMPLE = '#ad — I earn a commission if you buy through my link.';

async function retailTarget(ctx: QueryCtx, productId: Id<'commerceProducts'>, variantId: string) {
  const retail = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', productId).eq('channel', 'retail')).unique();
  if (retail?.published && retail.snapshot.variants.some((x) => x.id === variantId)) return { productId, variantId, listing: retail };
  // A HOLM variant: use its explicit retail mapping.
  const map = await ctx.db.query('catRetailMappings').withIndex('by_holm_variant', (q) => q.eq('holmProductId', productId).eq('holmVariantId', variantId).eq('status', 'active')).first();
  if (!map) return null;
  const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', map.retailProductId).eq('channel', 'retail')).unique();
  if (!listing?.published || !listing.snapshot.variants.some((x) => x.id === map.retailVariantId)) return null;
  return { productId: map.retailProductId, variantId: map.retailVariantId, listing };
}

/** The catalog variant behind a retail listing variant (Zuo variants directly; others via their mirror). */
async function catVariantFor(ctx: QueryCtx, productId: Id<'commerceProducts'>, variantId: string) {
  const id = ctx.db.normalizeId('catVariants', variantId);
  if (id) return ctx.db.get(id);
  const rows = await ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', productId)).collect();
  return rows.find((r) => r.legacyVariantId === variantId) ?? null;
}

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
      if (path.length > 200 || safeRedirect(path, '') !== path) throw new CommerceError('INVALID_INPUT', 'Links can only point at louiemae.com pages.');
      const linkId = opaqueId(10);
      await ctx.db.insert('prgReferralLinks', { linkId, beneficiaryId: b._id, membershipSource: source, destination: { kind: 'page', path }, channelTag, createdAt: now });
      return { linkId, url: `${SITE}/r/${linkId}`, destination: path, eligibility: 'eligible' as const, disclosureExample: DISCLOSURE_EXAMPLE };
    }
    if (!a.productId || !a.variantId) throw new CommerceError('INVALID_INPUT', 'Choose a product');
    const target = await retailTarget(ctx, a.productId, a.variantId);
    if (!target) throw new CommerceError('REFERRAL_INELIGIBLE', 'No published retail mapping', "This piece isn't sold on louiemae.com yet, so it has no retail link.");
    const cv = await catVariantFor(ctx, target.productId, target.variantId);
    if (!cv) throw new CommerceError('REFERRAL_INELIGIBLE', 'No catalog variant');
    const product = await ctx.db.get(target.productId);
    if (product?.provider === 'zuo') await assertSellable(ctx, cv._id, 'link');
    else if (cv.referralEligible !== true) throw new CommerceError('REFERRAL_INELIGIBLE', 'Not prequalified');
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', target.productId)).first();
    if (!meta || meta.commissionCategory === 'review_required') throw new CommerceError('REFERRAL_INELIGIBLE', 'Category under review');
    const sched = await schedule(ctx);
    const rate = await productRate(ctx, target.productId, b.tierKey, meta.commissionCategory, sched.value);
    const linkId = opaqueId(10);
    await ctx.db.insert('prgReferralLinks', { linkId, beneficiaryId: b._id, membershipSource: source, destination: { kind: 'variant', productId: target.productId, variantId: target.variantId }, channelTag, createdAt: now });
    const option = target.listing.snapshot.variants.find((x) => x.id === target.variantId);
    return {
      linkId,
      url: `${SITE}/r/${linkId}`,
      destination: `${target.listing.snapshot.name}${option && option.name !== 'Default Title' ? ` — ${option.name}` : ''}`,
      productName: target.listing.snapshot.name,
      variantName: option?.name ?? '',
      category: meta.commissionCategory,
      applicableRateBps: rate.rateBps,
      exceptionNote: rate.exceptionVersion !== undefined ? 'This piece has its own commission schedule.' : null,
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
export const setReferralEligibility = mutation({
  args: { variantId: v.id('catVariants'), eligible: v.boolean(), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT', 'Add the economics reason');
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    await ctx.db.patch(cv._id, { referralEligible: a.eligible, updatedAt: Date.now() });
    await audit(ctx, { actor: admin.email, action: a.eligible ? 'referral.enable' : 'referral.disable', entityTable: 'catVariants', entityId: cv._id, reason: a.reason });
  },
});

/** A visible, dated, tier-by-tier commission schedule for one product (never an undisclosed cap). */
export const createException = mutation({
  args: { productId: v.id('commerceProducts'), rates: v.array(v.object({ tierKey: v.union(v.literal('base'), v.literal('active'), v.literal('top'), v.literal('elite')), rateBps: v.number() })), visibleNote: v.string(), effectiveFrom: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (a.rates.length !== 4 || a.rates.some((r) => !Number.isInteger(r.rateBps) || r.rateBps < 0 || r.rateBps > 2300)) throw new CommerceError('INVALID_INPUT', 'Give a rate for each of the four tiers (0–23%).');
    if (!a.visibleNote.trim()) throw new CommerceError('INVALID_INPUT', 'Exceptions must carry a note shown to partners.');
    const now = Date.now();
    const prev = await ctx.db.query('prgSkuCommissionExceptions').withIndex('by_product_effective', (q) => q.eq('productId', a.productId)).order('desc').first();
    if (prev && prev.effectiveTo === undefined) await ctx.db.patch(prev._id, { effectiveTo: a.effectiveFrom ?? now });
    const id = await ctx.db.insert('prgSkuCommissionExceptions', { productId: a.productId, rates: a.rates, effectiveFrom: a.effectiveFrom ?? now, visibleNote: a.visibleNote, approvedBy: admin.email, version: (prev?.version ?? 0) + 1, createdAt: now });
    await audit(ctx, { actor: admin.email, action: 'commission.exception', entityTable: 'prgSkuCommissionExceptions', entityId: id, after: a });
    return id;
  },
});
