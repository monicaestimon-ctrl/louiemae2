import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { requireUser, viewer } from './holmAccess';

// "Request a render from the House": the planner sends its brief, camera and a snapshot, the
// request is kept, and the House team gets an email.

export const snapshotUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const request = mutation({
  args: {
    title: v.string(),
    prompt: v.string(),
    camera: v.optional(v.any()),
    room: v.optional(v.any()),
    snapshotId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (!a.prompt.trim()) throw new Error('The render brief is empty.');
    if (JSON.stringify(a.room ?? null).length > 100_000) throw new Error('This room is too large to send. Remove the wall photo and try again.');
    const recent = await ctx.db.query('holmRenderRequests').withIndex('by_user', (q) => q.eq('userId', me.userId)).order('desc').take(10);
    if (recent.length === 10 && recent[9].createdAt > Date.now() - 86_400_000) throw new Error('You have sent many render requests today. Try again tomorrow.');
    const id = await ctx.db.insert('holmRenderRequests', {
      userId: me.userId,
      title: a.title.trim().slice(0, 120) || 'Untitled room',
      prompt: a.prompt.slice(0, 6000),
      camera: a.camera,
      room: a.room,
      snapshotId: a.snapshotId,
      status: 'new',
      emailStatus: 'queued',
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.holmRenderEmail.notify, { id, attempt: 0 });
    return String(id).slice(-8).toUpperCase();
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return [];
    const rows = await ctx.db.query('holmRenderRequests').withIndex('by_user', (q) => q.eq('userId', me.userId)).order('desc').take(20);
    return rows.map((r) => ({ reference: String(r._id).slice(-8).toUpperCase(), title: r.title, status: r.status, createdAt: r.createdAt }));
  },
});

export const record = internalQuery({
  args: { id: v.id('holmRenderRequests') },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r) return null;
    const user = await ctx.db.get(r.userId);
    return {
      ...r,
      email: typeof user?.email === 'string' ? user.email : '',
      snapshotUrl: r.snapshotId ? await ctx.storage.getUrl(r.snapshotId) : null,
    };
  },
});

export const emailStatus = internalMutation({
  args: { id: v.id('holmRenderRequests'), status: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.id, { emailStatus: a.status });
  },
});
