"use node";
import { createHash, randomUUID } from 'node:crypto';
import { v } from 'convex/values';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { sourceFromImportPayload } from '../lib/productSourceAdapters';
import { buildGenerationSnapshot, sourceEvidenceWarnings, legacySelection, semanticGenerationKey, sourceIdentity, type GenerationSelection, type SourceContext } from '../lib/productGeneration';
import type { SourceProductSnapshot } from '../lib/smartDescription';

export const fetchForImport = action({ args: { url: v.string() }, handler: async (ctx, { url }): Promise<any> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    const result = await ctx.runAction(api.scraper.scrapeProduct, { url });
    const sourceSnapshotId = await ctx.runAction(internal.productSourceActions.rememberImport, { url: result.resolvedUrl || url, result });
    return { ...result, sourceSnapshotId };
} });

async function retrieve(ctx: ActionCtx, url: string, refresh = false, productId?: Id<'products'>): Promise<{ sourceSnapshotId: Id<'productSourceSnapshots'>; warning?: string }> {
    const sourceKey = sourceIdentity(url); const token = randomUUID();
    const lease = await ctx.runMutation(internal.productSources.acquire, { sourceKey, refresh, token });
    if (lease.snapshotId) return { sourceSnapshotId: lease.snapshotId };
    if (lease.busy) throw new Error('Supplier details are already loading. Try again shortly.');
    if (lease.error) throw new Error(lease.error);
    try {
        const legacy = !refresh && productId ? await ctx.runQuery(internal.productSources.legacyEvidence, { productId }) : null;
        const snapshot = legacy?.snapshot || sourceFromImportPayload(legacy?.result ?? await ctx.runAction(api.scraper.scrapeProduct, { url: sourceKey }), sourceKey);
        const contentHash = createHash('sha256').update(semanticGenerationKey(snapshot)).digest('hex');
        const id = await ctx.runMutation(internal.productSources.finish, { sourceKey, token, snapshot: JSON.parse(JSON.stringify(snapshot)), contentHash });
        return { sourceSnapshotId: id! };
    } catch {
        const error = 'Supplier details could not be retrieved. Your saved details have been kept. Check the source URL and retry refresh.';
        const previous = await ctx.runMutation(internal.productSources.finish, { sourceKey, token, error });
        if (previous) return { sourceSnapshotId: previous, warning: error };
        throw new Error(error);
    }
}

/** Store evidence already obtained by import without making a second OTAPI request. */
export const rememberImport = internalAction({ args: { result: v.any(), url: v.string() }, handler: async (ctx, args): Promise<Id<'productSourceSnapshots'> | undefined> => {
    const sourceKey = sourceIdentity(args.url); const token = randomUUID();
    const lease = await ctx.runMutation(internal.productSources.acquire, { sourceKey, refresh: true, token });
    if (lease.snapshotId) return lease.snapshotId;
    if (!lease.acquired) return undefined;
    try {
        const snapshot = sourceFromImportPayload(args.result, sourceKey);
        return (await ctx.runMutation(internal.productSources.finish, { sourceKey, token, snapshot: JSON.parse(JSON.stringify(snapshot)),
            contentHash: createHash('sha256').update(semanticGenerationKey(snapshot)).digest('hex') })) ?? undefined;
    } catch {
        await ctx.runMutation(internal.productSources.finish, { sourceKey, token, error: 'Supplier evidence could not be stored. Refresh supplier details before generating.' });
        return undefined;
    }
} });

export const refresh = action({ args: { url: v.string(), refresh: v.optional(v.boolean()), productId: v.optional(v.id('products')) }, handler: async (ctx, args): Promise<{ sourceSnapshotId: Id<'productSourceSnapshots'>; sourceSnapshot: SourceProductSnapshot; warnings: string[]; fetchedAt: number }> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    const result = await retrieve(ctx, args.url, args.refresh !== false, args.productId);
    const record = await ctx.runQuery(internal.productSources.get, { id: result.sourceSnapshotId });
    return { ...result, sourceSnapshot: record!.snapshot, warnings: [...record!.warnings, ...(result.warning ? [result.warning] : [])], fetchedAt: record!.fetchedAt };
} });

export const prepare = internalAction({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<{ sourceSnapshot: SourceProductSnapshot; sourceSnapshotId?: Id<'productSourceSnapshots'>; warnings: string[]; sourceHash: string }> => {
    // Generation engines authenticate before calling this internal action.
    const product = request.productId ? await ctx.runQuery(internal.productSources.product, { id: request.productId }) : null;
    const url = product?.sourceUrl || request.context?.sourceUrl || request.sourceSnapshot?.sourceUrl;
    let id = request.sourceSnapshotId || product?.sourceSnapshotId;
    let record = id ? await ctx.runQuery(internal.productSources.get, { id }) : null;
    if (record && (!url || record.sourceKey !== sourceIdentity(url))) throw new Error('Supplier snapshot does not match this product source. Refresh supplier details.');
    const warnings: string[] = [];
    if (!record && url) {
        try {
            const retrieved = await retrieve(ctx, url, false, request.productId);
            id = retrieved.sourceSnapshotId;
            record = await ctx.runQuery(internal.productSources.get, { id });
            if (retrieved.warning) warnings.push(retrieved.warning);
        } catch { warnings.push('Supplier details could not be retrieved. Only available facts and selected photos are being used.'); }
    }
    const source = record?.snapshot ?? request.sourceSnapshot;
    if (!source) throw new Error('Add a supplier URL or confirmed product facts before generating.');
    let selection: GenerationSelection = request.selection ?? (product ? { images: product.images, variants: product.variants ?? [], subset: Boolean(product.cjVariantScope), evidence: product.sourceEvidenceOverrides } : legacySelection(request.sourceSnapshot ?? source));
    if (product?.cjVariantScope || product?.sourceScopeStatus === 'needs_confirmation' || product?.sourceScopeStatus === 'confirmed_subset') selection = { ...selection, subset: true };
    if (!Array.isArray(selection.images) || !selection.images.every(image => typeof image === 'string' && image.length <= 4096)
        || !Array.isArray(selection.variants) || !selection.variants.every(variant => typeof variant?.name === 'string' && variant.name.length <= 2000)
        || typeof selection.subset !== 'boolean' || (selection.evidence?.facts?.length ?? 0) > 6000
        || (selection.evidence?.attributeKeys && (!Array.isArray(selection.evidence.attributeKeys) || !selection.evidence.attributeKeys.every(key => typeof key === 'string')))) throw new Error('Invalid product selection. Reload the product editor.');
    if (product && selection.variants.some(variant => variant.cjVariantId && !product.cjVariants?.some(v => v.vid === variant.cjVariantId))) throw new Error('Selected variants do not belong to this product.');
    if (selection.images.length > 150 || selection.variants.length > 500) throw new Error('The selected listing is too large to generate safely.');
    if (product) selection = { ...selection, variants: selection.variants.map(variant => ({ ...variant,
        supplierName: product.cjVariants?.find(v => v.vid === variant.cjVariantId)?.name || variant.supplierName })) };
    const context: SourceContext = request.context ?? { ...product, category: request.adminContext?.selectedCategory, collection: request.adminContext?.selectedCollection,
        subcategory: request.adminContext?.selectedSubcategory, subcategoryIds: request.adminContext?.selectedSubcategoryIds, audience: request.adminContext?.audience };
    const sourceSnapshot = buildGenerationSnapshot(source, selection, context);
    if (selection.subset) warnings.push('Only selected variants, photos, and confirmed supplier facts are used for this listing.');
    if (!url) warnings.push('No supplier URL: generation uses only confirmed facts and selected photos.');
    return { sourceSnapshot, sourceSnapshotId: id, warnings: [...warnings, ...sourceEvidenceWarnings(source)], sourceHash: createHash('sha256').update(semanticGenerationKey(sourceSnapshot)).digest('hex') };
} });

/** Explicit, bounded, resumable recovery; never changes product prose or publishes. */
export const recoverSelected = action({ args: { productIds: v.array(v.id('products')) }, handler: async (ctx, args): Promise<{ productId: Id<'products'>; status: string }[]> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    if (args.productIds.length > 10) throw new Error('Recover at most ten products per batch.');
    const results = [];
    for (const productId of [...new Set(args.productIds)]) {
        const product = await ctx.runQuery(internal.productSources.product, { id: productId });
        if (!product?.sourceUrl || product.sourceSnapshotId) { results.push({ productId, status: product?.sourceSnapshotId ? 'already_linked' : 'missing_url' }); continue; }
        try {
            const result = await retrieve(ctx, product.sourceUrl, false, productId);
            const status = await ctx.runMutation(internal.productSources.attachRecovered, { productId, sourceSnapshotId: result.sourceSnapshotId, expectedRevision: product.productRevision ?? 0 });
            results.push({ productId, status });
        } catch { results.push({ productId, status: 'fetch_failed' }); }
    }
    return results;
} });
