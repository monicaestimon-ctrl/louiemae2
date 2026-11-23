import { currentAshcroftInventory } from './ordInventory';
import { retailDelivery } from '../lib/retailLaunch';
import { isLighting } from '../lib/catCategory';
// Publication state machine and server gates (spec S15, v2 §6, §22, §25). One server-owned path
// from imported draft to published for v2 (Zuo) products. Publishing takes explicit product ids
// (never "all drafts"), publishes only variants that pass every gate, commits both channels
// atomically, and unpublish/rollback never touch paid orders or financial obligations.
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query } from './functions';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { assertSellable, evaluate, isCurrentPrice, openHold, resolveHold } from './catCore';
import { requireDeliveryRole } from './dlvAccess';
import { computeScenarios } from './catPricing';
import { audit } from './sysCore';
import { requireFlag } from '../lib/flags';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { supplierPackCostMinor } from '../lib/supplierPackCost';
import { verifiedImageMatches } from './catMedia';

type Ctx = QueryCtx | MutationCtx;
type Stage = Doc<'catProductMeta'>['stage'];
const ORDER: Stage[] = ['imported_draft', 'evidence_review', 'economics_review', 'content_review', 'ready', 'published'];

function stockOnlyExcluded(product: Doc<'commerceProducts'> | null) {
  const staging = product?.zuoStaging;
  return !!staging?.excluded && staging.exclusionReasons.length > 0
    && staging.exclusionReasons.every(reason => reason === 'CURRENTLY_UNAVAILABLE');
}


async function variantsOf(ctx: Ctx, productId: Id<'commerceProducts'>) {
  return ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', productId)).collect();
}

function includedProduct(product: Doc<'commerceProducts'> | null) {
  return product?.provider === 'ashcroft' || (product?.provider === 'zuo' && !!product.zuoStaging && !product.zuoStaging.excluded);
}
async function publicationIdentity(ctx: Ctx, product: Doc<'commerceProducts'>, cv: Doc<'catVariants'>) {
  const supplier = await ctx.db.get(cv.supplierId);
  if (cv.productId !== product._id || supplier?.code !== product.provider || cv.availability === 'discontinued')
    throw new CommerceError('INVALID_INPUT', 'Variant must belong to this supplier and product');
  if (product.provider === 'ashcroft') {
    const retail = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', product._id).eq('channel', 'retail')).unique();
    const options = retail?.snapshot.variants.filter(v => v.id === cv.legacyVariantId) ?? [];
    const routes = retail?.fulfillment?.filter(v => v.id === cv.legacyVariantId) ?? [];
    if (!cv.legacyVariantId || cv.optionKey !== cv.legacyVariantId || cv.packId !== '1' || cv.piecesPerPack !== 1
      || options.length !== 1 || routes.length !== 1 || routes[0].sku !== cv.supplierSku
      || options[0].minimum !== cv.orderMinimumPacks || options[0].increment !== cv.orderIncrementPacks)
      throw new CommerceError('INVALID_INPUT', 'Exact legacy Ashcroft selling-unit identity required');
    return cv.legacyVariantId;
  }
  const draft = product.draft.variants.filter(v => v.id === cv._id);
  if (cv.supplierSku !== product.zuoStaging?.sku || cv.piecesPerPack !== product.zuoStaging?.pack
    || draft.length !== 1 || draft[0].sku !== cv.supplierSku) throw new CommerceError('INVALID_INPUT', 'Canonical product, SKU, pack and draft variant must match');
  return String(cv._id);
}

export const ashcroftPreparationQueue = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'approver');
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 25) throw new CommerceError('INVALID_INPUT');
    const page = await ctx.db.query('commerceProducts').order('desc').paginate(a.paginationOpts);
    const rows = await Promise.all(page.page.map(async product => {
      if (product.provider !== 'ashcroft') return null;
      const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', product._id)).unique();
      return meta ? null : { productId: product._id, name: product.draft.name, revision: product.revision };
    }));
    return { ...page, page: rows.filter((r): r is NonNullable<typeof r> => r !== null) };
  },
});

/** Prepare existing Ashcroft content for explicit review; does not copy approvals or publish. */
export const prepareAshcroft = mutation({
  args: { productId: v.id('commerceProducts'), expectedRevision: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    const product = await ctx.db.get(a.productId);
    if (product?.provider !== 'ashcroft' || product.revision !== a.expectedRevision || (a.reason.trim().length < 10 || a.reason.length > 1000))
      throw new CommerceError('INVALID_INPUT', 'Review the current Ashcroft product and record a reason');
    const existing = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', a.productId)).unique();
    if (existing) return existing._id;
    const variants = await variantsOf(ctx, a.productId);
    if (!variants.length || variants.length > 50) throw new CommerceError('INVALID_INPUT', 'Prepare canonical identities first');
    for (const cv of variants) await publicationIdentity(ctx, product, cv);
    const now = Date.now();
    const id = await ctx.db.insert('catProductMeta', { productId: product._id, supplierId: variants[0].supplierId,
      supplierName: product.draft.name, louieMaeName: product.draft.name, navCategory: product.draft.category,
      commissionCategory: 'review_required', slug: String(product._id), slugHistory: [], holds: ['MANUAL'],
      stage: 'imported_draft', createdAt: now, updatedAt: now });
    await audit(ctx, { actor: actor.email, action: 'publication.ashcroft_prepared', entityTable: 'commerceProducts', entityId: product._id,
      after: { metaId: id }, reason: a.reason.trim() });
    return id;
  },
});

/** What blocks each transition for a product (empty list = gate passes). */
export async function gates(ctx: Ctx, productId: Id<'commerceProducts'>) {
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', productId)).first();
  if (!meta) throw new CommerceError('INVALID_INPUT', 'Product has no catalog record');
  const product = await ctx.db.get(productId);
  const variants = await variantsOf(ctx, productId);
  const live = variants.filter((cv) => cv.availability !== 'discontinued' && !cv.holds.includes('MANUAL'));
  const out: Record<string, string[]> = { evidence_review: [], economics_review: [], content_review: [], ready: [], published: [] };
  if (!live.length) out.evidence_review.push('No variant is eligible (all held, excluded or discontinued)');
  for (const cv of live) {
    const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
    const cartons = await ctx.db.query('catCartons').withIndex('by_variant', (q) => q.eq('variantId', cv._id)).collect();
    const tag = `${cv.supplierSku}/${cv.packId}`;
    if (!cost || cost.wholesaleMinor === null) out.evidence_review.push(`${tag}: wholesale cost missing`);
    if (product?.provider === 'ashcroft') {
      try { await publicationIdentity(ctx, product, cv); await currentAshcroftInventory(ctx, cv, Date.now(), true); }
      catch { out.evidence_review.push(`${tag}: current Ashcroft identity or feed missing`); }
      if (!retailDelivery(meta.navCategory, meta.louieMaeName)) out.evidence_review.push(`${tag}: no supported Ashcroft delivery model`);
      if (isLighting(`${meta.navCategory} ${meta.louieMaeName}`) && meta.commissionCategory !== 'decor') out.content_review.push('Lighting must be decor');
    } else if (!cartons.length) out.evidence_review.push(`${tag}: carton data missing`);
    if (cost && cost.mapApplicability === 'unknown') out.economics_review.push(`${tag}: MAP applicability unresolved`);
    if (cost && !cost.verifiedAt) out.economics_review.push(`${tag}: cost not verified`);
    if (!cv.marginPolicyKey) out.economics_review.push(`${tag}: no margin policy assigned`);
    try {
      const economics = await computeScenarios(ctx, cv, { reserveRetailCommission: cv.referralEligible !== false });
      if (economics.belowMinimum) out.economics_review.push(`${tag}: retail price is below the current minimum`);
      if (economics.belowTradeMinimum) out.economics_review.push(`${tag}: trade price is below the current minimum`);
      if (cv.referralEligible && !economics.referralQualified) out.economics_review.push(`${tag}: promised commission is not funded`);
    } catch (error) {
      out.economics_review.push(`${tag}: ${commerceErrorData(error)?.detail ?? 'Current economics need review'}`);
    }
    for (const h of cv.holds) if (!(h === 'COMMISSION_UNQUALIFIED' && cv.referralEligible === false)) out.economics_review.push(`${tag}: hold ${h}`);
    const retail = cv.retailPriceRevisionId ? await ctx.db.get(cv.retailPriceRevisionId) : null;
    if (!isCurrentPrice(retail, cv._id, 'retail')) out.content_review.push(`${tag}: no current approved retail price`);
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
    await requireDeliveryRole(ctx, 'approver');
    const g = await gates(ctx, a.productId);
    const product = await ctx.db.get(a.productId);
    return { stockExcluded: stockOnlyExcluded(product), stage: g.meta.stage, holds: g.meta.holds, gates: g.gates, variants: g.variants.map((cv) => ({ id: cv._id, sku: cv.supplierSku, holds: cv.holds, availability: cv.availability })) };
  },
});

export const reviewQueue = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'approver');
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 25) throw new CommerceError('INVALID_INPUT');
    const page = await ctx.db.query('catProductMeta').order('desc').paginate(a.paginationOpts);
    const rows = await Promise.all(page.page.map(async meta => {
      const product = await ctx.db.get(meta.productId);
      return product && ['zuo', 'ashcroft'].includes(product.provider) ? { productId: meta.productId, name: meta.louieMaeName,
        stage: meta.stage, holds: meta.holds, stockExcluded: stockOnlyExcluded(product), included: includedProduct(product) } : null;
    }));
    return { ...page, page: rows.filter((r): r is NonNullable<typeof r> => r !== null) };
  },
});

/** Reinclude only an initially stock-excluded draft after current available-to-sell evidence.
 * This restores review access, never publication or an automatic purchase promise. */
export const restoreStockExcludedDraft = mutation({
  args: { productId: v.id('commerceProducts'), variantIds: v.array(v.id('catVariants')), reason: v.string() },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    if (a.reason.trim().length < 10 || a.reason.length > 1000 || !a.variantIds.length
      || a.variantIds.length > 50 || new Set(a.variantIds).size !== a.variantIds.length)
      throw new CommerceError('INVALID_INPUT', 'Choose distinct variants and record the restocking evidence');
    const product = await ctx.db.get(a.productId);
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', a.productId)).unique();
    if (!product || product.provider !== 'zuo' || !product.zuoStaging || !stockOnlyExcluded(product)
      || !meta || meta.stage !== 'imported_draft')
      throw new CommerceError('INVALID_INPUT', 'Only an initially stock-excluded staged draft can be restored');
    const listings = await ctx.db.query('commerceListings').withIndex('by_product_channel', q => q.eq('productId', product._id)).collect();
    if (listings.some(l => l.published)) throw new CommerceError('INVALID_INPUT', 'Published products need a separate availability review');
    for (const id of a.variantIds) {
      const cv = await ctx.db.get(id);
      const stock = cv?.currentStockRevisionId ? await ctx.db.get(cv.currentStockRevisionId) : null;
      if (!cv || cv.productId !== product._id || cv.availability === 'discontinued'
        || cv.supplierSku !== product.zuoStaging.sku || cv.piecesPerPack !== product.zuoStaging.pack
        || !stock || stock.variantId !== cv._id || stock.kind !== 'available_to_sell' || !stock.confirmed)
        throw new CommerceError('STOCK_UNAVAILABLE', 'Exact SKU, pack and verified available-to-sell stock required');
      const current = await evaluate(ctx, cv);
      if (current.availability !== 'in_stock' || current.holds.includes('STOCK_UNVERIFIED'))
        throw new CommerceError('STOCK_UNAVAILABLE', 'Stock evidence is not current and available');
      await openHold(ctx, cv._id, 'MANUAL', 'Restocked draft requires full publication review', actor.email);
    }
    await ctx.db.patch(product._id, { zuoStaging: { ...product.zuoStaging, excluded: false, exclusionReasons: [] }, updatedAt: Date.now() });
    await ctx.db.patch(meta._id, { holds: [...new Set([...meta.holds, 'MANUAL' as const])], updatedAt: Date.now() });
    await audit(ctx, { actor: actor.email, action: 'publication.stock_draft_restored', entityTable: 'commerceProducts',
      entityId: product._id, before: product.zuoStaging.exclusionReasons, after: { variantIds: a.variantIds, stage: 'imported_draft' }, reason: a.reason.trim() });
    return { restoredVariants: a.variantIds.length };
  },
});

/** The staged importer uses one canonical product/variant in both channels.
 * Verify that identity before publication without pretending a retail listing exists. */
export const verifyCanonicalIdentity = mutation({
  args: { productId: v.id('commerceProducts'), variantIds: v.array(v.id('catVariants')) },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    if (!a.variantIds.length || a.variantIds.length > 50 || new Set(a.variantIds).size !== a.variantIds.length)
      throw new CommerceError('INVALID_INPUT', 'Choose 1–50 distinct variants');
    const product = await ctx.db.get(a.productId);
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', a.productId)).unique();
    if (!product || !includedProduct(product) || !meta || meta.stage === 'archived')
      throw new CommerceError('INVALID_INPUT', 'Included staged Zuo product required');
    const now = Date.now();
    for (const id of a.variantIds) {
      const cv = await ctx.db.get(id);
      if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant missing');
      const publicId = await publicationIdentity(ctx, product, cv);
      const maps = await ctx.db.query('catRetailMappings').withIndex('by_holm_variant', q => q.eq('holmProductId', product._id).eq('holmVariantId', publicId).eq('status', 'active')).collect();
      if (maps.length > 1 || maps.some(m => m.retailProductId !== product._id || m.retailVariantId !== publicId || m.effectiveFrom > now || (m.effectiveTo !== undefined && m.effectiveTo <= now)))
        throw new CommerceError('INVALID_INPUT', 'Existing retail mapping needs explicit conflict review');
      if (!maps.length) await ctx.db.insert('catRetailMappings', { holmProductId: product._id, holmVariantId: publicId,
        retailProductId: product._id, retailVariantId: publicId, status: 'active', createdAt: now,
        createdBy: actor.email, effectiveFrom: now, source: 'verified_staged_canonical_identity' });
      await resolveHold(ctx, id, 'MAPPING_MISSING', actor.email, 'Verified staged canonical product, supplier SKU, pack and draft variant identity');
    }
    await audit(ctx, { actor: actor.email, action: 'publication.identity_verified', entityTable: 'commerceProducts',
      entityId: product._id, after: { variantIds: a.variantIds }, reason: 'Same canonical variant in retail and HOLM; publication and eligibility checked separately' });
    return { verifiedVariants: a.variantIds.length };
  },
});

/** Release only the manual review hold after every other current gate passes.
 * A failed check rolls back both product and variant changes in this transaction. */
export const releaseManualReview = mutation({
  args: { productId: v.id('commerceProducts'), variantIds: v.array(v.id('catVariants')), reason: v.string() },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    if (a.reason.trim().length < 10 || a.reason.length > 1000)
      throw new CommerceError('INVALID_INPUT', 'Record the completed review in 10–1000 characters');
    if (!a.variantIds.length || a.variantIds.length > 50 || new Set(a.variantIds).size !== a.variantIds.length)
      throw new CommerceError('INVALID_INPUT', 'Choose 1–50 distinct variants for this product');
    const product = await ctx.db.get(a.productId);
    const meta = await ctx.db.query('catProductMeta').withIndex('by_product', q => q.eq('productId', a.productId)).unique();
    if (!product || !includedProduct(product) || !meta || meta.stage === 'archived')
      throw new CommerceError('INVALID_INPUT', 'An included, non-archived staged Zuo product is required');
    for (const id of a.variantIds) {
      const cv = await ctx.db.get(id);
      if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant missing');
      await publicationIdentity(ctx, product, cv);
      await resolveHold(ctx, id, 'MANUAL', actor.email, a.reason.trim());
    }
    await ctx.db.patch(meta._id, { holds: meta.holds.filter(h => h !== 'MANUAL'), updatedAt: Date.now() });
    const current = await gates(ctx, product._id);
    const blockers = Object.values(current.gates).flat();
    if (blockers.length)
      throw new CommerceError('COST_REVIEW_REQUIRED', blockers.slice(0, 20).join('; '));
    for (const id of a.variantIds) await assertSellable(ctx, id, 'publish');
    await audit(ctx, { actor: actor.email, action: 'publication.manual_review', entityTable: 'commerceProducts',
      entityId: product._id, before: meta.holds, after: { variantIds: a.variantIds, holds: current.meta.holds }, reason: a.reason.trim() });
    return { productId: product._id, reviewedVariants: a.variantIds.length, stage: current.meta.stage };
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
    variantIds: variants.filter(cv => verifiedImageMatches(asset, cv)).map(cv => product.provider === 'ashcroft' ? cv.legacyVariantId! : String(cv._id)),
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
    if (!isCurrentPrice(price, cv._id, channel === 'retail' ? 'retail' : 'trade')) throw new CommerceError('COST_REVIEW_REQUIRED', `${cv.supplierSku}: no current approved ${channel === 'retail' ? 'retail' : 'trade'} price`);
    const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
    const publicId = product.provider === 'ashcroft' ? cv.legacyVariantId! : String(cv._id);
    const imageUrl = imageMedia.find(m => m.variantIds.includes(publicId))?.url;
    if (!imageUrl) throw new CommerceError('COST_REVIEW_REQUIRED', `${cv.supplierSku}: public variant photograph is unavailable`);
    const packCost = supplierPackCostMinor(cost, cv.piecesPerPack);
    if (packCost === null) throw new CommerceError('COST_REVIEW_REQUIRED', `${cv.supplierSku}: supplier cost missing`);
    snapVariants.push({
      id: publicId,
      name: cv.louieMaeVariantName,
      image: imageUrl,
      minimum: cv.orderMinimumPacks,
      increment: cv.orderIncrementPacks,
      price: price.packPriceMinor,
    });
    fulfillment.push({
      id: publicId,
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
      if (!product || !['zuo', 'ashcroft'].includes(product.provider) || product.zuoStaging?.excluded) throw new CommerceError('INVALID_INPUT', 'Included catalog-reviewed supplier product required.');
      const g = await gates(ctx, productId);
      if (g.meta.stage !== 'ready' && g.meta.stage !== 'published') throw new CommerceError('COST_REVIEW_REQUIRED', `${g.meta.louieMaeName} is at ${g.meta.stage}, not ready`);
      const readyBlockers = Object.values(g.gates).flat();
      if (readyBlockers.length) throw new CommerceError('COST_REVIEW_REQUIRED', readyBlockers.slice(0, 10).join('; '));
      const sellable: Doc<'catVariants'>[] = [];
      const skipped: string[] = [];
      for (const cv of g.live) {
        try {
          if (product.provider === 'ashcroft') await publicationIdentity(ctx, product, cv);
          for (const channel of a.channels) await assertSellable(ctx, cv._id, 'publish', now, channel === 'house' ? 'trade' : 'retail');
          sellable.push(cv);
        } catch (e) {
          skipped.push(`${cv.supplierSku}: ${commerceErrorData(e)?.detail ?? 'blocked'}`);
        }
      }
      if (!sellable.length) throw new CommerceError('COST_REVIEW_REQUIRED', `${g.meta.louieMaeName}: no variant passes its gates (${skipped.join('; ')})`);
      for (const channel of a.channels) {
        const { snapshot, fulfillment } = await snapshotFor(ctx, product, g.meta, channel, sellable);
        const old = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', productId).eq('channel', channel)).unique();
        const data = { productId, channel, pricingMode: 'approved_v2' as const, published: true, revision: product.revision, snapshot, fulfillment, updatedAt: now };
        const listingId = old ? (await ctx.db.patch(old._id, data), old._id) : await ctx.db.insert('commerceListings', data);
        const state = await ctx.db.query('catListingState').withIndex('by_listing', (q) => q.eq('listingId', listingId)).first();
        const st = { stage: 'published' as const, holds: [], publishedRevision: product.revision, publishedAt: now, ...(old?.published ? { previousSnapshot: { snapshot: old.snapshot, fulfillment: old.fulfillment, revision: old.revision, pricingMode: old.pricingMode } } : {}), updatedAt: now };
        if (state) await ctx.db.patch(state._id, st);
        else await ctx.db.insert('catListingState', { listingId, ...st });
      }
      // Verify the final content/rate identity too; any mismatch rolls back both channel writes.
      if (product.provider === 'ashcroft') for (const cv of sellable) for (const channel of a.channels)
        await assertSellable(ctx, cv._id, 'publish', now, channel === 'house' ? 'trade' : 'retail');
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
    const prev = state?.previousSnapshot as { snapshot: Doc<'commerceListings'>['snapshot']; fulfillment?: Doc<'commerceListings'>['fulfillment']; revision: number; pricingMode?: 'approved_v2' } | undefined;
    const now = Date.now();
    if (prev) await ctx.db.patch(listing._id, { snapshot: prev.snapshot, fulfillment: prev.fulfillment, pricingMode: prev.pricingMode, revision: prev.revision, updatedAt: now });
    else await ctx.db.patch(listing._id, { published: false, updatedAt: now });
    if (state) await ctx.db.patch(state._id, { previousSnapshot: undefined, reason: `rollback: ${a.reason}`, updatedAt: now, ...(prev ? {} : { stage: 'ready' as const, unpublishedAt: now }) });
    await audit(ctx, { actor: admin.email, action: 'publication.rollback', entityTable: 'commerceListings', entityId: listing._id, reason: a.reason, after: prev ? 'restored previous revision' : 'unpublished' });
  },
});
