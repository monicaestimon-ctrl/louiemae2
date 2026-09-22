import { v } from 'convex/values';
import { mutation, query, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
export const jobs = query({
  args: { productId: v.id('commerceProducts') },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db
      .query('commerceGenerations')
      .withIndex('by_product', (q) => q.eq('productId', args.productId))
      .order('desc')
      .take(50);
  },
});
export const queue = mutation({
  args: {
    productId: v.id('commerceProducts'),
    revision: v.number(),
    kind: v.union(v.literal('copy'), v.literal('image')),
    instruction: v.string(),
    reference: v.optional(v.string()),
    requestKey: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    if (args.instruction.length > 2000 || !/^[\w-]{20,80}$/.test(args.requestKey))
      throw new Error('Check generation request.');
    const old = await ctx.db
      .query('commerceGenerations')
      .withIndex('by_request', (q) => q.eq('requestKey', args.requestKey))
      .unique();
    if (old) {
      if (
        old.productId !== args.productId ||
        old.revision !== args.revision ||
        old.kind !== args.kind
      )
        throw new Error('Request key already used.');
      return old._id;
    }
    const p = await ctx.db.get(args.productId);
    if (!p || p.revision !== args.revision)
      throw new Error('Save and reload the current draft first.');
    if (
      args.kind === 'image' &&
      (!p.draft.referencePermission ||
        !args.reference ||
        !p.draft.referenceImages.includes(args.reference))
    )
      throw new Error('Select an approved product reference and confirm reference-use permission.');
    const model =
      args.kind === 'image'
        ? process.env.COMMERCE_IMAGE_MODEL
        : process.env.LOUIE_MAE_AI_MODEL || 'gemini-2.5-flash';
    if (!model || !process.env.GEMINI_API_KEY)
      throw new Error(
        'Configure the server Gemini API key and COMMERCE_IMAGE_MODEL before generating.'
      );
    const recent = await ctx.db
      .query('commerceGenerations')
      .withIndex('by_product', (q) => q.eq('productId', p._id))
      .order('desc')
      .take(50);
    if (recent.some((j) => ['queued', 'running', 'uncertain'].includes(j.status)))
      throw new Error('A generation is already in progress for this product.');
    if (recent.filter((j) => j.createdAt > Date.now() - 86400000).length >= 12)
      throw new Error('Daily per-product generation limit reached (12).');
    const id = await ctx.db.insert('commerceGenerations', {
      ...args,
      model,
      actor: actor.email,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.commerceAI.generate, { id });
    await ctx.scheduler.runAfter(15 * 60000, internal.commerceGeneration.expire, { id });
    return id;
  },
});
export const claim = internalMutation({
  args: { id: v.id('commerceGenerations') },
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id);
    if (!job || job.status !== 'queued') return null;
    await ctx.db.patch(id, { status: 'running', updatedAt: Date.now() });
    return { job, product: await ctx.db.get(job.productId) };
  },
});
export const finish = internalMutation({
  args: {
    id: v.id('commerceGenerations'),
    result: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    error: v.optional(v.string()),
    tokens: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...data }) => {
    const job = await ctx.db.get(id);
    if (!job || !['running', 'uncertain'].includes(job.status)) {
      if (data.storageId) await ctx.storage.delete(data.storageId);
      return;
    }
    await ctx.db.patch(id, {
      ...data,
      status: data.error ? 'failed' : 'needs_review',
      updatedAt: Date.now(),
    });
  },
});
export const reject = mutation({
  args: { id: v.id('commerceGenerations') },
  handler: async (ctx, { id }) => {
    const actor = await requireCjAdminIdentity(ctx);
    const job = await ctx.db.get(id);
    if (!job || !['needs_review', 'uncertain', 'failed'].includes(job.status))
      throw new Error('This job is not awaiting a decision.');
    await ctx.db.patch(id, { status: 'rejected', updatedAt: Date.now() });
    await ctx.db.insert('commerceAudit', {
      entityId: job.productId,
      actor: actor.email,
      action: `reject_generation:${id}`,
      revision: job.revision,
      createdAt: Date.now(),
    });
  },
});
export const expire = internalMutation({
  args: { id: v.id('commerceGenerations') },
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id);
    if (job && ['queued', 'running'].includes(job.status))
      await ctx.db.patch(id, {
        status: 'uncertain',
        error: 'Provider outcome is uncertain. Review this job before creating a new request.',
        updatedAt: Date.now(),
      });
  },
});
export const privateJob = internalQuery({
  args: { id: v.id('commerceGenerations') },
  handler: (ctx, { id }) => ctx.db.get(id),
});
export const approve = mutation({
  args: { id: v.id('commerceGenerations'), revision: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireCjAdminIdentity(ctx);
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== 'needs_review')
      throw new Error('This candidate is not awaiting review.');
    const p = await ctx.db.get(job.productId);
    if (!p || p.revision !== args.revision || p.revision !== job.revision)
      throw new Error(
        'The product changed after generation. Review against the latest draft instead of applying an older result.'
      );
    let draft = p.draft;
    if (job.kind === 'image') {
      const url = job.storageId ? await ctx.storage.getUrl(job.storageId) : null;
      if (!url) throw new Error('Generated image missing.');
      if (draft.images.length >= 24) throw new Error('Remove an image before adding another.');
      draft = { ...draft, images: [...draft.images, url], imagesApproved: false };
    } else {
      const parsed = JSON.parse(job.result || '{}');
      if (
        typeof parsed.name !== 'string' ||
        typeof parsed.description !== 'string' ||
        !parsed.name.trim() ||
        parsed.name.length > 200 ||
        parsed.description.length > 8000
      )
        throw new Error('Generated copy is invalid.');
      draft = {
        ...draft,
        name: parsed.name,
        description: parsed.description,
        factsApproved: false,
      };
    }
    await ctx.db.patch(p._id, { draft, revision: p.revision + 1, updatedAt: Date.now() });
    await ctx.db.patch(job._id, { status: 'approved', updatedAt: Date.now() });
    await ctx.db.insert('commerceAudit', {
      entityId: p._id,
      actor: actor.email,
      action: `accept_${job.kind}:${job._id}`,
      revision: p.revision + 1,
      createdAt: Date.now(),
    });
  },
});
