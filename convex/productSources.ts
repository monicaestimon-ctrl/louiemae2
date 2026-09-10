import { internalQuery, internalMutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireCjAdminIdentity } from './cjAdminAccess';

export const evidenceValidator = v.object({ facts: v.optional(v.string()), attributeKeys: v.optional(v.array(v.string())), useDescription: v.optional(v.boolean()) });
export const get = internalQuery({ args: { id: v.id('productSourceSnapshots') }, handler: (ctx, { id }) => ctx.db.get(id) });
export const product = internalQuery({ args: { id: v.id('products') }, handler: (ctx, { id }) => ctx.db.get(id) });
export const preview = query({ args: { id: v.id('productSourceSnapshots') }, handler: async (ctx, { id }) => { await requireCjAdminIdentity(ctx); return ctx.db.get(id); } });
export const acquire = internalMutation({ args: { sourceKey: v.string(), refresh: v.boolean(), token: v.string() }, handler: async (ctx, args) => {
    const entry = await ctx.db.query('productSourceCache').withIndex('by_source', q => q.eq('sourceKey', args.sourceKey)).unique();
    if (!args.refresh && entry?.snapshotId) return { snapshotId: entry.snapshotId };
    if (entry?.leaseUntil && entry.leaseUntil > Date.now()) return { busy: true };
    if (!args.refresh && entry?.lastError && Date.now() - entry.attemptedAt < 60_000) return { error: entry.lastError };
    const fields = { sourceKey: args.sourceKey, leaseToken: args.token, leaseUntil: Date.now() + 90_000, attemptedAt: Date.now() };
    if (entry) await ctx.db.patch(entry._id, fields); else await ctx.db.insert('productSourceCache', fields);
    return { acquired: true };
} });
export const finish = internalMutation({ args: { sourceKey: v.string(), token: v.string(), snapshot: v.optional(v.any()), contentHash: v.optional(v.string()), error: v.optional(v.string()) }, handler: async (ctx, args) => {
    const entry = await ctx.db.query('productSourceCache').withIndex('by_source', q => q.eq('sourceKey', args.sourceKey)).unique();
    if (!entry || entry.leaseToken !== args.token) throw new Error('Supplier retrieval was superseded. Retry with the current source.');
    if (!args.snapshot) { await ctx.db.patch(entry._id, { leaseUntil: undefined, leaseToken: undefined, lastError: args.error }); return entry.snapshotId; }
    if (JSON.stringify(args.snapshot).length > 240_000) throw new Error('Supplier evidence exceeds the safe storage limit.');
    const existing = await ctx.db.query('productSourceSnapshots').withIndex('by_hash', q => q.eq('contentHash', args.contentHash!)).first();
    const warnings = [];
    if (!args.snapshot.rawDescription && !args.snapshot.rawHtmlDescription) warnings.push('The supplier description could not be loaded. Refresh supplier details or continue with available facts.');
    if (!args.snapshot.attributes?.length) warnings.push('No structured supplier properties were provided.');
    const snapshotId = existing?._id ?? await ctx.db.insert('productSourceSnapshots', { sourceKey: args.sourceKey, schemaVersion: 1, adapterVersion: 1,
        fetchedAt: Date.now(), contentHash: args.contentHash!, snapshot: args.snapshot, status: warnings.length ? 'partial' : 'complete', warnings });
    await ctx.db.patch(entry._id, { snapshotId, leaseUntil: undefined, leaseToken: undefined, lastError: undefined });
    return snapshotId;
} });

/** Bounded read-only migration report; never rewrites product copy or guesses lineage. */
export const recoveryReport = query({ args: { cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const page = await ctx.db.query('products').paginate({ cursor: args.cursor ?? null, numItems: 50 });
    return { cursor: page.continueCursor, done: page.isDone, products: page.page.map(p => ({ productId: p._id, name: p.name,
        status: p.sourceSnapshotId ? 'ready' : p.sourceUrl ? 'fetch_required' : 'missing_url',
        scope: p.sourceScopeStatus ?? (p.cjVariantScope ? 'needs_confirmation' : 'whole_listing') })) };
} });

export const legacyEvidence = internalQuery({ args: { productId: v.id('products') }, handler: async (ctx, { productId }) => {
    const product = await ctx.db.get(productId);
    if (!product?.sourceUrl) return null;
    if (product.batchImportItemId) {
        const item = await ctx.db.get(product.batchImportItemId);
        if (item?.result) return { result: item.result, url: product.sourceUrl };
    }
    // Old audits are usable only when they preserve supplier properties, not just merchandising text.
    const audits = await ctx.db.query('descriptionAudits').withIndex('by_product', q => q.eq('productId', productId)).order('desc').take(10);
    const audit = audits.find(a => a.sourceUrl === product.sourceUrl && !a.sourceSnapshot?.sourceMetadata?.scoped
        && a.sourceSnapshot?.attributes?.some((attribute: { source: string }) => attribute.source === 'otapi_property'));
    return audit ? { snapshot: audit.sourceSnapshot, url: product.sourceUrl } : null;
} });

export const attachRecovered = internalMutation({ args: { productId: v.id('products'), sourceSnapshotId: v.id('productSourceSnapshots'), expectedRevision: v.number() }, handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product || (product.productRevision ?? 0) !== args.expectedRevision) return 'changed';
    if (product.sourceSnapshotId) return 'already_linked';
    await ctx.db.patch(product._id, { sourceSnapshotId: args.sourceSnapshotId, sourceScopeStatus: product.sourceScopeStatus ?? (product.cjVariantScope ? 'needs_confirmation' : 'whole_listing'), productRevision: args.expectedRevision + 1 });
    return 'recovered';
} });
