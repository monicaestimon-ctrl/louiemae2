import { legacySearchProjection, listingSearchProjection, sameSearchProjection, syncPublicSearch } from './publicSearchMaintenance';
import { discoveryProjection, sameDiscovery, syncDiscovery } from './holmDiscoveryMaintenance';
import { listingPriceInputs, productPriceInputs, variantPriceInputs, syncDiscoveryOffers, syncProductDiscoveryOffers } from './holmDiscoveryOffers';
import { holmIdentityProjection, sameHolmIdentity, syncHolmIdentity } from './holmIdentityMaintenance';
import { syncExpiry } from './webhookExpiryMaintenance';
import { syncRecoveryQueue } from './webhookRecoveryMaintenance';
import { inventoryTargets, syncInventoryTargets } from './cjInventoryTargetMaintenance';
import { mutation as rawMutation, internalMutation as rawInternalMutation } from './_generated/server';
import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';
import { Triggers } from 'convex-helpers/server/triggers';
import type { DataModel } from './_generated/dataModel';
import { syncCatalogProduct } from './catalogMaintenance';
import { catalogProjection, sameCatalogValue } from '../lib/catalogProjection';
import { productHealthProjection } from '../lib/productHealth';
import { syncProductHealth } from './productHealthMaintenance';
import { syncSourcingCount } from './sourcingCountsMaintenance';
import { syncWebhookSummary, webhookSummaryProjection } from './webhookSummaryMaintenance';

// Product/job/webhook writers use these builders. Reader cutover still requires
// a completed, verified backfill. Irrelevant telemetry must not invalidate lists.
const triggers = new Triggers<DataModel>();
triggers.register('cjWebhookLog', async (ctx, change) => {
  if (change.oldDoc?.expiresAt !== change.newDoc?.expiresAt) await syncExpiry(ctx, change.id, change.newDoc);
  if ((change.oldDoc?.status === 'processing' || change.newDoc?.status === 'processing')
    && (change.oldDoc?.status !== change.newDoc?.status || change.oldDoc?.claimedAt !== change.newDoc?.claimedAt)) {
    await syncRecoveryQueue(ctx, change.id, change.newDoc);
  }
  if (change.oldDoc && change.newDoc && sameCatalogValue(webhookSummaryProjection(change.oldDoc), webhookSummaryProjection(change.newDoc))) return;
  await syncWebhookSummary(ctx, change.id, change.newDoc);
});
triggers.register('cjSourcingJobs', async (ctx, change) => {
  if (change.oldDoc && change.newDoc && change.oldDoc.state === change.newDoc.state) return;
  await syncSourcingCount(ctx, change.id, change.newDoc);
});
triggers.register('commerceListings', async (ctx, change) => {
  // Retail Ashcroft changes can alter the matching House price, too.
  if (!sameCatalogValue(listingPriceInputs(change.oldDoc), listingPriceInputs(change.newDoc))) {
    if (change.oldDoc?.channel === 'house' && change.newDoc?.channel !== 'house') await syncDiscoveryOffers(ctx, change.id);
    const affected = new Set([change.oldDoc?.productId, change.newDoc?.productId]);
    for (const productId of affected) if (productId) await syncProductDiscoveryOffers(ctx, productId);
  }
  const oldDiscovery = discoveryProjection(change.oldDoc);
  const newDiscovery = discoveryProjection(change.newDoc);
  if (!sameDiscovery(oldDiscovery, newDiscovery)) await syncDiscovery(ctx, change.id, newDiscovery);
  const oldIdentity = holmIdentityProjection(change.oldDoc);
  const newIdentity = holmIdentityProjection(change.newDoc);
  if (!sameHolmIdentity(oldIdentity, newIdentity)) await syncHolmIdentity(ctx, change.id, newIdentity);
  const before = listingSearchProjection(change.oldDoc);
  const after = listingSearchProjection(change.newDoc);
  if (!sameSearchProjection(before, after)) await syncPublicSearch(ctx, `listing:${change.id}`, after);
});
triggers.register('products', async (ctx, change) => {
  if (!change.oldDoc || !change.newDoc || change.oldDoc.confirmedLandedCost !== change.newDoc.confirmedLandedCost || change.oldDoc.estimatedLandedCost !== change.newDoc.estimatedLandedCost) {
    const linked = await ctx.db.query('commerceProducts').withIndex('by_cj', q => q.eq('cjProductId', change.id)).collect();
    for (const product of linked) await syncProductDiscoveryOffers(ctx, product._id);
  }
  const before = legacySearchProjection(change.oldDoc);
  const after = legacySearchProjection(change.newDoc);
  if (!sameSearchProjection(before, after)) await syncPublicSearch(ctx, `legacy:${change.id}`, after);
  if (!change.oldDoc || !change.newDoc || !sameCatalogValue(inventoryTargets(change.oldDoc), inventoryTargets(change.newDoc))) {
    await syncInventoryTargets(ctx, change.id, change.newDoc);
  }
  const now = Date.now();
  if (!change.oldDoc || !change.newDoc || !sameCatalogValue(productHealthProjection(change.oldDoc, now), productHealthProjection(change.newDoc, now))) {
    await syncProductHealth(ctx, change.id, change.newDoc, now);
  }
  if (change.oldDoc && change.newDoc
    && sameCatalogValue(catalogProjection(change.oldDoc), catalogProjection(change.newDoc))) return;
  await syncCatalogProduct(ctx, change.id, change.newDoc);
});

triggers.register('commerceProducts', async (ctx, change) => {
  if (sameCatalogValue(productPriceInputs(change.oldDoc), productPriceInputs(change.newDoc))) return;
  await syncProductDiscoveryOffers(ctx, change.id);
});
triggers.register('catVariants', async (ctx, change) => {
  if (sameCatalogValue(variantPriceInputs(change.oldDoc), variantPriceInputs(change.newDoc))) return;
  const affected = new Set([change.oldDoc?.productId, change.newDoc?.productId]);
  for (const productId of affected) if (productId) await syncProductDiscoveryOffers(ctx, productId);
});
triggers.register('catPriceRevisions', async (ctx, change) => {
  const affected = new Set([change.oldDoc?.variantId, change.newDoc?.variantId]);
  for (const variantId of affected) {
    const variant = variantId ? await ctx.db.get(variantId) : null;
    if (variant && [variant.retailPriceRevisionId, variant.tradePriceRevisionId].includes(change.id)) await syncProductDiscoveryOffers(ctx, variant.productId);
  }
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
export { query, internalQuery, action, internalAction, httpAction } from './_generated/server';
export type { QueryCtx, MutationCtx, ActionCtx, DatabaseReader, DatabaseWriter } from './_generated/server';
