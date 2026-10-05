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
  if (change.oldDoc && change.newDoc && sameCatalogValue(webhookSummaryProjection(change.oldDoc), webhookSummaryProjection(change.newDoc))) return;
  await syncWebhookSummary(ctx, change.id, change.newDoc);
});
triggers.register('cjSourcingJobs', async (ctx, change) => {
  if (change.oldDoc && change.newDoc && change.oldDoc.state === change.newDoc.state) return;
  await syncSourcingCount(ctx, change.id, change.newDoc);
});
triggers.register('products', async (ctx, change) => {
  const now = Date.now();
  if (!change.oldDoc || !change.newDoc || !sameCatalogValue(productHealthProjection(change.oldDoc, now), productHealthProjection(change.newDoc, now))) {
    await syncProductHealth(ctx, change.id, change.newDoc, now);
  }
  if (change.oldDoc && change.newDoc
    && sameCatalogValue(catalogProjection(change.oldDoc), catalogProjection(change.newDoc))) return;
  await syncCatalogProduct(ctx, change.id, change.newDoc);
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
export { query, internalQuery, action, internalAction, httpAction } from './_generated/server';
export type { QueryCtx, MutationCtx, ActionCtx, DatabaseReader, DatabaseWriter } from './_generated/server';
