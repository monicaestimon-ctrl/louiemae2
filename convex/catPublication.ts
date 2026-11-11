// Publication state machine and server gates (spec S15, v2 §6, §22, §25). One server-owned path
// from imported draft to published for v2 (Zuo) products. Publishing takes explicit product ids
// (never "all drafts"), publishes only variants that pass every gate, commits both channels
// atomically, and unpublish/rollback never touch paid orders or financial obligations.
import { v } from 'convex/values';
import { mutation, query } from './functions';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { assertSellable } from './catCore';
import { computeScenarios } from './catPricing';
import { audit } from './sysCore';
import { requireFlag } from '../lib/flags';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { supplierPackCostMinor } from '../lib/supplierPackCost';
import { verifiedImageMatches } from './catMedia';

type Ctx = QueryCtx | MutationCtx;
type Stage = Doc<'catProductMeta'>['stage'];
const ORDER: Stage[] = ['imported_draft', 'evidence_review', 'economics_review', 'content_review', 'ready', 'published'];

async function variantsOf(ctx: Ctx, productId: Id<'commerceProducts'>) {
  return ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', productId)).collect();
}

/** What blocks each transition for a product (empty list = gate passes). */
export async function gates(ctx: Ctx, productId: Id<'commerceProducts'>) {
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', productId)).first();
  if (!meta) throw new CommerceError('INVALID_INPUT', 'Product has no catalog record');
  const variants = await variantsOf(ctx, productId);
  const live = variants.filter((cv) => cv.availability !== 'discontinued' && !cv.holds.includes('MANUAL'));
  const out: Record<string, string[]> = { evidence_review: [], economics_review: [], content_review: [], ready: [], published: [] };
  if (!live.length) out.evidence_review.push('No variant is eligible (all held, excluded or discontinued)');
  for (const cv of live) {
    const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
    const cartons = await ctx.db.query('catCartons').withIndex('by_variant', (q) => q.eq('variantId', cv._id)).collect();
    const tag = `${cv.supplierSku}/${cv.packId}`;
    if (!cost || cost.wholesaleMinor === null) out.evidence_review.push(`${tag}: wholesale cost missing`);
    if (!cartons.length) out.evidence_review.push(`${tag}: carton data missing`);
    if (cost && cost.mapApplicability === 'unknown') out.economics_review.push(`${tag}: MAP applicability unresolved`);
    if (cost && !cost.verifiedAt) out.economics_review.push(`${tag}: cost not verified`);
    if (!cv.marginPolicyKey) out.economics_review.push(`${tag}: no margin policy assigned`);
    try {
      const economics = await computeScenarios(ctx, cv);
      if (economics.belowMinimum) out.economics_review.push(`${tag}: retail price is below the current minimum`);
      if (economics.belowTradeMinimum) out.economics_review.push(`${tag}: trade price is below the current minimum`);
      if (cv.referralEligible && !economics.referralQualified) out.economics_review.push(`${tag}: promised commission is not funded`);
    } catch (error) {
      out.economics_review.push(`${tag}: ${commerceErrorData(error)?.detail ?? 'Current economics need review'}`);
    }
    for (const h of cv.holds) out.economics_review.push(`${tag}: hold ${h}`);
    const retail = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
    if (retail?.status !== 'approved') out.content_review.push(`${tag}: no approved retail price`);
    if (cv.referralEligible === undefined) out.content_review.push(`${tag}: commission prequalification not run (or referral not explicitly disabled)`);
  }
  if (meta.commissionCategory === 'review_required') out.content_review.push('Commission category needs review');
  for (const h of meta.holds) out.ready.push(`Product hold ${h}`);
  const media = await ctx.db.query('catMediaAssets').withIndex('by_product', (q) => q.eq('productId', productId)).collect();
  const verified = media.filter((m) => m.status === 'verified' && m.storageId);
  if (!verified.some(m => m.role === 'hero' && live.some(cv => verifiedImageMatches(m, cv)))) out.ready.push('No verified hero image');
  for (const cv of live) if (!verified.some(m => verifiedImageMatches(m, cv)))
    out.ready.push(`${cv.supplierSku}/${cv.packId}: no image verified for this SKU, pack and color`);
  if (verified.some((m) => !m.rights.basis.trim())) out.ready.push('An image has no rights basis');
  if (verified.some(m => live.some(cv => verifiedImageMatches(m, cv)) && m.rights.privateOriginal && !m.derivatives.length))
    out.ready.push('A private original needs a public web derivative');
  if (!meta.louieMaeName.trim()) out.ready.push('No Louie Mae name');
  return { meta, variants, live, gates: out };
}

export const status = query({
  args: { productId: v.id('commerceProducts') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const g = await gates(ctx, a.productId);
    return { stage: g.meta.stage, holds: g.meta.holds, gates: g.gates, variants: g.variants.map((cv) => ({ id: cv._id, sku: cv.supplierSku, holds: cv.holds, availability: cv.availability })) };
  },
});

/** Moves a product one stage forward when that stage's gate passes. */
export const advance = mutation({
  args: { productId: v.id('commerceProducts'), to: v.union(v.literal('evidence_review'), v.literal('economics_review'), v.literal('content_review'), v.literal('ready')) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const g = await gates(ctx, a.productId);
    const from = ORDER.indexOf(g.meta.stage);
    const to = ORDER.indexOf(a.to);
    if (to !== from + 1) throw new CommerceError('INVALID_INPUT', `Move one stage at a time (now ${g.meta.stage})`);
    // Each stage's gate includes every earlier gate.
    const blockers = ORDER.slice(1, to + 1).flatMap((s) => g.gates[s] ?? []);
    if (blockers.length) throw new CommerceError('COST_REVIEW_REQUIRED', blockers.slice(0, 20).join('; '), `Not ready: ${blockers[0]}`);
    await ctx.db.patch(g.meta._id, { stage: a.to, updatedAt: Date.now() });
    await audit(ctx, { actor: admin.email, action: 'publication.advance', entityTable: 'commerceProducts', entityId: a.productId, before: g.meta.stage, after: a.to });
  },
});

async function snapshotFor(ctx: MutationCtx, product: Doc<'commerceProducts'>, meta: Doc<'catProductMeta'>, channel: 'retail' | 'house', variants: Doc<'catVariants'>[]) {
  const media = await ctx.db.query('catMediaAssets').withIndex('by_product', (q) => q.eq('productId', product._id)).collect();
  const verified = media.filter(m => variants.some(cv => verifiedImageMatches(m, cv))).sort((x, y) => (x.role === 'hero' ? -1 : y.role === 'hero' ? 1 : 0));
  const prepared = await Promise.all(verified.map(async m => {
    const renditions = (await Promise.all(m.derivatives.map(async d => ({
      width: d.width, url: await ctx.storage.getUrl(d.storageId),
    })))).filter((d): d is { width: number; url: string } => !!d.url && d.width > 0)
      .sort((a, b) => a.width - b.width);
    const url = renditions.at(-1)?.url ?? (m.rights.privateOriginal || !m.storageId ? null : await ctx.storage.getUrl(m.storageId));
    return { asset: m, url, renditions };
  }));
  const imageMedia = prepared.flatMap(({ asset, url, renditions }) => url ? [{
    url, altText: asset.altText,
    variantIds: variants.filter(cv => verifiedImageMatches(asset, cv)).map(cv => String(cv._id)),
    renditions,
  }] : []);
  const images = imageMedia.map(m => m.url);
  if (!images.length) throw new CommerceError('COST_REVIEW_REQUIRED', 'No usable public product photography');
  const snapVariants = [];
  const fulfillment = [];
  for (const cv of variants) {
    const retail = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
    const trade = cv.tradePriceRevisionId ? await ctx.db.get(cv.tradePriceRevisionId) : null;
    const price = channel === 'retail' ? retail : trade;
    if (price?.status !== 'approved') throw new CommerceError('COST_REVIEW_REQUIRED', `${cv.supplierSku}: no approved ${channel === 'retail' ? 'retail' : 'trade'} price`);
    const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
    const imageUrl = imageMedia.find(m => m.variantIds.includes(cv._id))?.url;
    if (!imageUrl) throw new CommerceError('COST_REVIEW_REQUIRED', `${cv.supplierSku}: public variant photograph is unavailable`);
    const packCost = supplierPackCostMinor(cost, cv.piecesPerPack);
    if (packCost === null) throw new CommerceError('COST_REVIEW_REQUIRED', `${cv.supplierSku}: supplier cost missing`);
    snapVariants.push({
      id: cv._id as string,
      name: cv.louieMaeVariantName,
      image: imageUrl,
      minimum: cv.orderMinimumPacks,
      increment: cv.orderIncrementPacks,
      price: price.packPriceMinor,
    });
    fulfillment.push({
      id: cv._id as string,
      name: cv.louieMaeVariantName,
      sku: cv.supplierSku,
      cost: packCost / 100,
      minimum: cv.orderMinimumPacks,
      increment: cv.orderIncrementPacks,
      retail: retail?.status === 'approved' ? retail.packPriceMinor : 0,
      commercial: trade?.status === 'approved' ? trade.packPriceMinor : 0,
    });
  }
  return { snapshot: { name: meta.louieMaeName, description: product.draft.description, category: meta.navCategory, images, imageMedia, facts: product.draft.facts, variants: snapVariants }, fulfillment };
}

/**
 * Publishes ready products to the chosen channels. Only variants passing `assertSellable` are
 * listed; a product with none fails, and any failure rolls back the whole call (atomic).
 */
export const publish = mutation({
  args: { productIds: v.array(v.id('commerceProducts')), channels: v.array(v.union(v.literal('retail'), v.literal('house'))) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    requireFlag('CATALOG_PUBLICATION_V2_ENABLED');
    if (!a.productIds.length || a.productIds.length > 50) throw new CommerceError('INVALID_INPUT', 'Publish between 1 and 50 named products at a time.');
    if (!a.channels.length || new Set(a.channels).size !== a.channels.length) throw new CommerceError('INVALID_INPUT', 'Choose distinct channels.');
    const now = Date.now();
    const results = [];
    for (const productId of a.productIds) {
      const product = await ctx.db.get(productId);
      if (!product || product.provider !== 'zuo') throw new CommerceError('INVALID_INPUT', 'Only catalog-reviewed (Zuo) products publish here.');
      const g = await gates(ctx, productId);
      if (g.meta.stage !== 'ready' && g.meta.stage !== 'published') throw new CommerceError('COST_REVIEW_REQUIRED', `${g.meta.louieMaeName} is at ${g.meta.stage}, not ready`);
      const readyBlockers = Object.values(g.gates).flat();
      if (readyBlockers.length) throw new CommerceError('COST_REVIEW_REQUIRED', readyBlockers.slice(0, 10).join('; '));
      const sellable: Doc<'catVariants'>[] = [];
      const skipped: string[] = [];
      for (const cv of g.live) {
        try {
          await assertSellable(ctx, cv._id, 'publish', now);
          sellable.push(cv);
        } catch (e) {
          skipped.push(`${cv.supplierSku}: ${commerceErrorData(e)?.detail ?? 'blocked'}`);
        }
      }
      if (!sellable.length) throw new CommerceError('COST_REVIEW_REQUIRED', `${g.meta.louieMaeName}: no variant passes its gates (${skipped.join('; ')})`);
      for (const channel of a.channels) {
        const { snapshot, fulfillment } = await snapshotFor(ctx, product, g.meta, channel, sellable);
        const old = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', productId).eq('channel', channel)).unique();
        const data = { productId, channel, published: true, revision: product.revision, snapshot, fulfillment, updatedAt: now };
        const listingId = old ? (await ctx.db.patch(old._id, data), old._id) : await ctx.db.insert('commerceListings', data);
        const state = await ctx.db.query('catListingState').withIndex('by_listing', (q) => q.eq('listingId', listingId)).first();
        const st = { stage: 'published' as const, holds: [], publishedRevision: product.revision, publishedAt: now, ...(old?.published ? { previousSnapshot: { snapshot: old.snapshot, fulfillment: old.fulfillment, revision: old.revision } } : {}), updatedAt: now };
        if (state) await ctx.db.patch(state._id, st);
        else await ctx.db.insert('catListingState', { listingId, ...st });
      }
      await ctx.db.patch(g.meta._id, { stage: 'published', updatedAt: now });
      await audit(ctx, { actor: admin.email, action: `publication.publish:${a.channels.join(',')}`, entityTable: 'commerceProducts', entityId: productId, after: { variants: sellable.map((x) => x.supplierSku), skipped } });
      results.push({ productId, variants: sellable.length, skipped });
    }
    return results;
  },
});

/** Stops new sales on the chosen channels. URLs, orders, tracking and obligations keep working. */
export const unpublish = mutation({
  args: { productIds: v.array(v.id('commerceProducts')), channels: v.array(v.union(v.literal('retail'), v.literal('house'))), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT', 'Add a reason.');
    const now = Date.now();
    for (const productId of a.productIds.slice(0, 100)) {
      for (const channel of a.channels) {
        const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', productId).eq('channel', channel)).unique();
        if (!listing?.published) continue;
        await ctx.db.patch(listing._id, { published: false, updatedAt: now });
        const state = await ctx.db.query('catListingState').withIndex('by_listing', (q) => q.eq('listingId', listing._id)).first();
        if (state) await ctx.db.patch(state._id, { stage: 'ready', unpublishedAt: now, reason: a.reason, updatedAt: now });
      }
      const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', productId)).first();
      const stillLive = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', productId)).collect();
      if (meta && !stillLive.some((l) => l.published)) await ctx.db.patch(meta._id, { stage: 'ready', updatedAt: now });
      await audit(ctx, { actor: admin.email, action: `publication.unpublish:${a.channels.join(',')}`, entityTable: 'commerceProducts', entityId: productId, reason: a.reason });
    }
  },
});

/** Restores a listing's previous published revision, or unpublishes it when there is none (import rollback). */
export const rollback = mutation({
  args: { productId: v.id('commerceProducts'), channel: v.union(v.literal('retail'), v.literal('house')), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', a.productId).eq('channel', a.channel)).unique();
    if (!listing) throw new CommerceError('INVALID_INPUT', 'No listing');
    const state = await ctx.db.query('catListingState').withIndex('by_listing', (q) => q.eq('listingId', listing._id)).first();
    const prev = state?.previousSnapshot as { snapshot: Doc<'commerceListings'>['snapshot']; fulfillment?: Doc<'commerceListings'>['fulfillment']; revision: number } | undefined;
    const now = Date.now();
    if (prev) await ctx.db.patch(listing._id, { snapshot: prev.snapshot, ...(prev.fulfillment ? { fulfillment: prev.fulfillment } : {}), revision: prev.revision, updatedAt: now });
    else await ctx.db.patch(listing._id, { published: false, updatedAt: now });
    if (state) await ctx.db.patch(state._id, { previousSnapshot: undefined, reason: `rollback: ${a.reason}`, updatedAt: now, ...(prev ? {} : { stage: 'ready' as const, unpublishedAt: now }) });
    await audit(ctx, { actor: admin.email, action: 'publication.rollback', entityTable: 'commerceListings', entityId: listing._id, reason: a.reason, after: prev ? 'restored previous revision' : 'unpublished' });
  },
});
