import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { viewer } from './holmAccess';

// AI renders: the planner sends a snapshot of the current view and its written brief, an image
// model turns it into a photoreal room, and the member sees it in the planner and gets an email.

const MAX_SNAPSHOT = 5 * 1024 * 1024;
const PER_DAY = 5;
const MAX_PIECES = 6;

/**
 * Starts a render. The snapshot is stored here rather than through an upload URL, so a render
 * can only ever be made from an image its own member sent.
 */
export const create = action({
  args: {
    title: v.string(),
    prompt: v.string(),
    snapshot: v.bytes(),
    camera: v.optional(v.any()),
    pieces: v.optional(v.array(v.id('commerceProducts'))),
  },
  handler: async (ctx, a): Promise<Id<'holmRenderRequests'>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Sign in to make a render.');
    if (!a.prompt.trim()) throw new Error('The render brief is empty.');
    if (!a.snapshot.byteLength || a.snapshot.byteLength > MAX_SNAPSHOT) throw new Error('This view could not be captured. Try again.');
    await ctx.runQuery(internal.holmRender.checkQuota, { userId });
    const snapshotId = await ctx.storage.store(new Blob([a.snapshot], { type: 'image/jpeg' }));
    try {
      return await ctx.runMutation(internal.holmRender.insert, {
        userId,
        title: a.title,
        prompt: a.prompt,
        camera: a.camera,
        pieces: (a.pieces ?? []).slice(0, MAX_PIECES),
        snapshotId,
      });
    } catch (e) {
      await ctx.storage.delete(snapshotId);
      throw e;
    }
  },
});

async function quotaError(ctx: { db: any }, userId: Id<'users'>) {
  const recent = await ctx.db
    .query('holmRenderRequests')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .order('desc')
    .take(PER_DAY);
  if (recent.some((r: { status: string }) => r.status === 'rendering')) return 'A render is already on its way. It takes about a minute.';
  if (recent.length === PER_DAY && recent[PER_DAY - 1].createdAt > Date.now() - 86_400_000)
    return `You can make ${PER_DAY} renders a day. Try again tomorrow.`;
  return null;
}

export const checkQuota = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, a) => {
    const err = await quotaError(ctx, a.userId);
    if (err) throw new Error(err);
  },
});

export const insert = internalMutation({
  args: {
    userId: v.id('users'),
    title: v.string(),
    prompt: v.string(),
    camera: v.optional(v.any()),
    pieces: v.array(v.id('commerceProducts')),
    snapshotId: v.id('_storage'),
  },
  handler: async (ctx, a) => {
    // Checked again here, inside the transaction, so two quick clicks can't both start.
    const err = await quotaError(ctx, a.userId);
    if (err) throw new Error(err);
    const now = Date.now();
    const id = await ctx.db.insert('holmRenderRequests', {
      userId: a.userId,
      title: a.title.trim().slice(0, 120) || 'Untitled room',
      prompt: a.prompt.slice(0, 6000),
      camera: a.camera,
      pieces: a.pieces,
      snapshotId: a.snapshotId,
      status: 'rendering',
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.holmRenderAI.generate, { id });
    await ctx.scheduler.runAfter(10 * 60_000, internal.holmRender.expire, { id });
    return id;
  },
});

/** Marks a render as started and gathers what the model needs: the snapshot and each piece's photo. */
export const claim = internalMutation({
  args: { id: v.id('holmRenderRequests') },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.status !== 'rendering' || !r.snapshotId) return null;
    const pieces = [];
    for (const productId of r.pieces ?? []) {
      const product = await ctx.db.get(productId);
      const listing = await ctx.db
        .query('commerceListings')
        .withIndex('by_product_channel', (q) => q.eq('productId', productId).eq('channel', 'house'))
        .first();
      const asset = await ctx.db
        .query('holmAssets')
        .withIndex('by_product', (q) => q.eq('productId', productId))
        .first();
      const cutout = asset?.cutoutStatus === 'approved' && asset.cutoutId ? await ctx.storage.getUrl(asset.cutoutId) : null;
      const image = cutout ?? listing?.snapshot.images[0] ?? null;
      const name = listing?.snapshot.name ?? product?.draft?.name;
      if (image && name) pieces.push({ name: String(name).slice(0, 120), image });
    }
    return { prompt: r.prompt, title: r.title, snapshotId: r.snapshotId, pieces };
  },
});

export const finish = internalMutation({
  args: { id: v.id('holmRenderRequests'), resultId: v.optional(v.id('_storage')), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.status !== 'rendering') {
      if (a.resultId) await ctx.storage.delete(a.resultId);
      return;
    }
    if (a.resultId) {
      await ctx.db.patch(a.id, { status: 'ready', resultId: a.resultId, updatedAt: Date.now(), emailStatus: 'queued' });
      await ctx.scheduler.runAfter(0, internal.holmRenderEmail.notify, { id: a.id, attempt: 0 });
    } else {
      await ctx.db.patch(a.id, { status: 'failed', error: a.error ?? 'The render could not be made.', updatedAt: Date.now() });
    }
  },
});

/** A render the model never answered is closed after ten minutes, so the member can try again. */
export const expire = internalMutation({
  args: { id: v.id('holmRenderRequests') },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (r?.status === 'rendering')
      await ctx.db.patch(a.id, { status: 'failed', error: 'The render took too long. Try again.', updatedAt: Date.now() });
  },
});

/** One of the signed-in member's renders, for the planner to show while it's made. */
export const one = query({
  args: { id: v.id('holmRenderRequests') },
  handler: async (ctx, a) => {
    const me = await viewer(ctx);
    const r = await ctx.db.get(a.id);
    if (!me || !r || r.userId !== me.userId) return null;
    return {
      title: r.title,
      status: r.status,
      error: r.error ?? null,
      url: r.resultId ? await ctx.storage.getUrl(r.resultId) : null,
    };
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return [];
    const rows = await ctx.db.query('holmRenderRequests').withIndex('by_user', (q) => q.eq('userId', me.userId)).order('desc').take(20);
    return Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        title: r.title,
        status: r.status,
        url: r.resultId ? await ctx.storage.getUrl(r.resultId) : null,
        createdAt: r.createdAt,
      }))
    );
  },
});

export const record = internalQuery({
  args: { id: v.id('holmRenderRequests') },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r) return null;
    const user = await ctx.db.get(r.userId);
    return {
      _id: r._id,
      title: r.title,
      emailStatus: r.emailStatus,
      email: typeof user?.email === 'string' ? user.email : '',
      resultUrl: r.resultId ? await ctx.storage.getUrl(r.resultId) : null,
    };
  },
});

export const emailStatus = internalMutation({
  args: { id: v.id('holmRenderRequests'), status: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.id, { emailStatus: a.status });
  },
});
