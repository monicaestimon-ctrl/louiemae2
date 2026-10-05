import { mutation as rawMutation, internalMutation as rawInternalMutation } from './_generated/server';
import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';
import { Triggers } from 'convex-helpers/server/triggers';
import type { DataModel } from './_generated/dataModel';
import { syncCatalogProduct } from './catalogMaintenance';
import { catalogProjection, sameCatalogValue } from '../lib/catalogProjection';

// Product-writing entry points use these builders. Reader cutover still requires
// a completed, verified backfill. Irrelevant telemetry must not invalidate lists.
const triggers = new Triggers<DataModel>();
triggers.register('products', async (ctx, change) => {
  if (change.oldDoc && change.newDoc
    && sameCatalogValue(catalogProjection(change.oldDoc), catalogProjection(change.newDoc))) return;
  await syncCatalogProduct(ctx, change.id, change.newDoc);
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
export { query, internalQuery, action, internalAction, httpAction } from './_generated/server';
export type { QueryCtx, MutationCtx, ActionCtx, DatabaseReader, DatabaseWriter } from './_generated/server';
