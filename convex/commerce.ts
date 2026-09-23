import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query, mutation, internalMutation, internalQuery } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { draft, channel, provider } from './commerceTables';
import { blankCommerceDraft, listingSnapshot, validateDraft } from '../lib/commerce';
import { evaluateProductCjReadiness } from '../lib/cjFulfillmentReadiness';
import { listingReady } from './commerceReadiness';
import { assertCjPricingReady } from '../lib/cjPricingReview';

export const library = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db.query('commerceProducts').order('desc').paginate(args.paginationOpts);
  },
});
export const get = query({
  args: { id: v.id('commerceProducts') },
  handler: async (ctx, { id }) => {
    await requireCjAdminIdentity(ctx);
    return {
      product: await ctx.db.get(id),
      listings: await ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) => q.eq('productId', id))
        .collect(),
    };
  },
});
export const record = internalQuery({
  args: { id: v.id('commerceProducts') },
  handler: (ctx, { id }) => ctx.db.get(id),
});
export const save = mutation({
  args: { id: v.id('commerceProducts'), revision: v.number(), draft },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    const p = await ctx.db.get(args.id);
    if (!p || p.revision !== args.revision)
      throw new Error('This draft changed. Reload before saving.');
    validateDraft(args.draft);
    if (JSON.stringify(args.draft).length > 150000)
      throw new Error('Product details are too large.');
    if (p.draft.sourceUrl !== args.draft.sourceUrl)
      throw new Error('Source identity cannot change. Import the new source separately.');
    if (JSON.stringify(p.draft.referenceImages) !== JSON.stringify(args.draft.referenceImages))
      throw new Error('Source reference evidence cannot be removed from a saved import.');
    const revision = p.revision + 1;
    await ctx.db.patch(p._id, { draft: args.draft, revision, updatedAt: Date.now() });
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: actor.email,
      action: 'save_draft',
      revision,
      createdAt: Date.now(),
    });
    return revision;
  },
});
export const imported = internalMutation({
  args: { sourceKey: v.string(), provider, draft, actor: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('commerceProducts')
      .withIndex('by_source', (q) => q.eq('sourceKey', args.sourceKey))
      .unique();
    if (existing) return { id: existing._id, existing: true };
    if (args.provider === 'cj') throw new Error('Link an existing retail CJ product instead.');
    validateDraft(args.draft);
    const id = await ctx.db.insert('commerceProducts', {
      sourceKey: args.sourceKey,
      provider: args.provider,
      draft: args.draft,
      revision: 1,
      updatedAt: Date.now(),
    });
    await ctx.db.insert('commerceAudit', {
      entityId: id,
      actor: args.actor,
      action: 'import',
      revision: 1,
      createdAt: Date.now(),
    });
    return { id, existing: false };
  },
});
export const cjLibrary = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const page = await ctx.db.query('products').order('desc').paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((p) => ({
        id: p._id,
        name: p.name,
        ready: evaluateProductCjReadiness(p).ready,
      })),
    };
  },
});
export const linkCj = mutation({
  args: { id: v.id('products') },
  handler: async (ctx, { id }) => {
    await requireCjAdminIdentity(ctx);
    const existing = await ctx.db
      .query('commerceProducts')
      .withIndex('by_cj', (q) => q.eq('cjProductId', id))
      .unique();
    if (existing) return existing._id;
    const p = await ctx.db.get(id);
    if (!p) throw new Error('Retail product not found.');
    const options = p.variants?.length
      ? p.variants
      : [
          {
            id: 'standard',
            name: 'Standard',
            priceAdjustment: 0,
            inStock: p.inStock !== false,
            cjVariantId: p.cjVariantId,
            cjSku: p.cjSku,
          },
        ];
    const d = {
      ...blankCommerceDraft(),
      name: p.name,
      description: p.description,
      category: p.category,
      images: p.images,
      referenceImages: p.images,
      sourceUrl: p.sourceUrl || '',
      supplierName: 'CJ',
      variants: options
        .filter((o) => o.inStock)
        .map((o) => ({
          id: o.id,
          name: o.name,
          sku: o.cjSku || '',
          cost: 0,
          minimum: 1,
          increment: 1,
          retail: Math.round((p.price + o.priceAdjustment) * 100),
          commercial: 0,
          ...('image' in o && typeof o.image === 'string' ? { image: o.image } : {}),
          ...(o.cjVariantId ? { cjVariantId: o.cjVariantId } : {}),
          ...(o.cjSku ? { cjSku: o.cjSku } : {}),
        })),
    };
    if (!d.variants.length) throw new Error('There are no offered variants to link.');
    return ctx.db.insert('commerceProducts', {
      sourceKey: `cj:${id}`,
      provider: 'cj',
      cjProductId: id,
      draft: d,
      revision: 1,
      updatedAt: Date.now(),
    });
  },
});
export const publish = mutation({
  args: { id: v.id('commerceProducts'), revision: v.number(), channels: v.array(channel) },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    if (!args.channels.length || new Set(args.channels).size !== args.channels.length)
      throw new Error('Select distinct publishing destinations.');
    if (process.env.COMMERCE_PUBLISHING_ENABLED !== 'true')
      throw new Error(
        'Shared publishing is awaiting deployment acceptance. Enable COMMERCE_PUBLISHING_ENABLED after sandbox validation.'
      );
    const p = await ctx.db.get(args.id);
    if (!p || p.revision !== args.revision)
      throw new Error('This draft changed. Reload before publishing.');
    if (p.provider === 'cj') {
      const linked = p.cjProductId ? await ctx.db.get(p.cjProductId) : null;
      if (!linked || !evaluateProductCjReadiness(linked).ready)
        throw new Error('CJ sourcing and mapping must be fulfillment-ready before publication.');
      // CJ keeps its existing retail checkout. The shared record extends it for House.
      if (args.channels.includes('retail')) {
        assertCjPricingReady(linked);
        if (
          p.draft.name !== linked.name ||
          p.draft.description !== linked.description ||
          JSON.stringify(p.draft.images) !== JSON.stringify(linked.images)
        )
          throw new Error(
            'CJ retail content is managed in the existing retail editor. Refresh the linked draft before publishing retail.'
          );
        for (const option of p.draft.variants) {
          const original = linked.variants?.find((v) => v.id === option.id);
          if (option.retail !== Math.round((linked.price + (original?.priceAdjustment || 0)) * 100))
            throw new Error(
              'Set CJ retail prices in the existing retail editor, then refresh the link. House estimates remain independent.'
            );
        }
        await ctx.db.patch(linked._id, { storefrontStatus: 'published' });
      }
      for (const option of p.draft.variants) {
        const mapped = linked.variants?.length
          ? linked.variants.find((v) => v.id === option.id && v.inStock)
          : linked;
        if (
          !mapped ||
          !option.cjVariantId ||
          !option.cjSku ||
          option.cjVariantId !== mapped.cjVariantId ||
          option.cjSku !== mapped.cjSku
        )
          throw new Error('CJ variant mapping changed. Review the source product.');
      }
    }
    const ready = args.channels.map((c) => ({
      channel: c,
      snapshot: listingSnapshot(p.draft, p.provider, c),
    }));
    for (const item of ready) {
      const old = await ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) =>
          q.eq('productId', p._id).eq('channel', item.channel)
        )
        .unique();
      const data = {
        productId: p._id,
        ...item,
        fulfillment: p.draft.variants,
        published: true,
        revision: p.revision,
        updatedAt: Date.now(),
      };
      if (old) await ctx.db.patch(old._id, data);
      else await ctx.db.insert('commerceListings', data);
    }
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: actor.email,
      action: `publish:${args.channels.join(',')}`,
      revision: p.revision,
      createdAt: Date.now(),
    });
  },
});
export const unpublish = mutation({
  args: { id: v.id('commerceProducts'), channel },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const product = await ctx.db.get(args.id);
    if (args.channel === 'retail' && product?.provider === 'cj' && product.cjProductId)
      await ctx.db.patch(product.cjProductId, { storefrontStatus: 'hidden' });
    const old = await ctx.db
      .query('commerceListings')
      .withIndex('by_product_channel', (q) =>
        q.eq('productId', args.id).eq('channel', args.channel)
      )
      .unique();
    if (old) await ctx.db.patch(old._id, { published: false, updatedAt: Date.now() });
  },
});
export const catalog = query({
  args: { channel, paginationOpts: paginationOptsValidator, customerView: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('commerceListings')
      .withIndex('by_channel_published', (q) => q.eq('channel', args.channel).eq('published', true))
      .paginate(args.paginationOpts);
    const visible = await Promise.all(
      result.page.map(async (p) => {
        const product = await ctx.db.get(p.productId);
        if (args.customerView && args.channel === 'retail' && product?.provider === 'cj')
          return null;
        return product && (await listingReady(ctx, product, p)) ? p : null;
      })
    );
    return {
      ...result,
      page: visible
        .filter((p) => p !== null)
        .map((p) => ({ id: p.productId, revision: p.revision, ...p.snapshot })),
    };
  },
});
export const refreshCj = mutation({
  args: { id: v.id('commerceProducts'), revision: v.number() },
  handler: async (ctx, a) => {
    const actor = await requireCjAdminIdentity(ctx);
    const p = await ctx.db.get(a.id);
    if (!p || p.provider !== 'cj' || !p.cjProductId || p.revision !== a.revision)
      throw new Error('Reload this CJ draft first.');
    const source = await ctx.db.get(p.cjProductId);
    if (!source) throw new Error('Source product missing.');
    const variants = source.variants?.length
      ? source.variants.filter((v) => v.inStock !== false)
      : [
          {
            id: 'standard',
            name: 'Standard',
            priceAdjustment: 0,
            cjVariantId: source.cjVariantId,
            cjSku: source.cjSku,
          },
        ];
    if (!variants.length) throw new Error('No active source variants.');
    const draft = {
      ...p.draft,
      name: source.name,
      description: source.description,
      images: source.images,
      referenceImages: source.images,
      factsApproved: false,
      imagesApproved: false,
      variants: variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.cjSku || '',
        cost: p.draft.variants.find((old) => old.id === v.id)?.cost || 0,
        minimum: 1,
        increment: 1,
        commercial: p.draft.variants.find((old) => old.id === v.id)?.commercial || 0,
        retail: Math.round((source.price + v.priceAdjustment) * 100),
        ...('image' in v && typeof v.image === 'string' ? { image: v.image } : {}),
        ...(v.cjVariantId ? { cjVariantId: v.cjVariantId } : {}),
        ...(v.cjSku ? { cjSku: v.cjSku } : {}),
      })),
    };
    validateDraft(draft);
    await ctx.db.patch(p._id, { draft, revision: p.revision + 1, updatedAt: Date.now() });
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: actor.email,
      action: 'refresh_cj_link',
      revision: p.revision + 1,
      createdAt: Date.now(),
    });
  },
});
