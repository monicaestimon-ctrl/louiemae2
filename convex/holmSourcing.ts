import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { isAdmin, isPartner, isVerified, requireUser, viewer } from './holmAccess';
import { sourcingStatus } from './holmTables';

const LABEL: Record<string, string> = {
  received: 'Received',
  sourcing: "We're sourcing it",
  options_ready: 'Options are ready',
  ordered: 'Ordered',
  closed: 'Closed',
};

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const submit = mutation({
  args: {
    type: v.union(v.literal('specific'), v.literal('similar'), v.literal('custom')),
    title: v.string(),
    link: v.string(),
    category: v.string(),
    material: v.string(),
    dims: v.string(),
    quantity: v.number(),
    targetCents: v.optional(v.number()),
    neededBy: v.string(),
    project: v.string(),
    notes: v.string(),
    imageIds: v.array(v.id('_storage')),
  },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (!isVerified(me.profile) && !isPartner(me.profile) && !(await isAdmin(ctx)))
      throw new Error('Sourcing is open to verified trade accounts and partners.');
    const title = a.title.trim();
    if (title.length < 3 || title.length > 200) throw new Error('Describe the piece you need.');
    if (!Number.isInteger(a.quantity) || a.quantity < 1 || a.quantity > 9999) throw new Error('Check the quantity.');
    if (a.targetCents !== undefined && (!Number.isSafeInteger(a.targetCents) || a.targetCents < 0 || a.targetCents > 100_000_000))
      throw new Error('Check the target price.');
    if (a.imageIds.length > 8) throw new Error('Add up to 8 images.');
    if ([a.link, a.category, a.material, a.dims, a.neededBy, a.project].some((x) => x.length > 500) || a.notes.length > 3000)
      throw new Error('Please shorten the request details.');
    const recent = await ctx.db.query('holmSourcing').withIndex('by_user', (q) => q.eq('userId', me.userId)).order('desc').take(10);
    if (recent.length === 10 && recent[9].createdAt > Date.now() - 86_400_000)
      throw new Error('You have sent several requests today. Our team will be in touch before you send more.');
    const total = await ctx.db.query('holmSourcing').order('desc').first();
    const number = `SR-${total ? Number(total.number.slice(3)) + 1 : 1051}`;
    const now = Date.now();
    const id = await ctx.db.insert('holmSourcing', {
      number,
      userId: me.userId,
      email: me.email,
      type: a.type,
      title,
      link: a.link.trim(),
      category: a.category,
      material: a.material.trim(),
      dims: a.dims.trim(),
      quantity: a.quantity,
      targetCents: a.targetCents,
      neededBy: a.neededBy,
      project: a.project.trim(),
      notes: a.notes.trim(),
      imageIds: a.imageIds,
      status: 'received',
      options: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
      key: `sourcing:${id}`,
      to: 'owner',
      subject: `House of Louie Mae — sourcing request ${number}`,
      text: `${me.profile?.businessName || me.email} asked us to source: ${title}\nQuantity: ${a.quantity}${a.targetCents ? `\nTarget: $${(a.targetCents / 100).toFixed(2)} per unit` : ''}${a.link ? `\nLink: ${a.link}` : ''}${a.notes ? `\n\n${a.notes}` : ''}\n\nRespond at https://louiemae.com/trade#admin`,
      replyTo: me.email,
    });
    return number;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return [];
    const rows = await ctx.db.query('holmSourcing').withIndex('by_user', (q) => q.eq('userId', me.userId)).order('desc').take(50);
    return Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        number: r.number,
        title: r.title,
        quantity: r.quantity,
        targetCents: r.targetCents ?? null,
        project: r.project,
        status: r.status,
        options: r.options,
        chosenOption: r.chosenOption ?? null,
        createdAt: r.createdAt,
        image: r.imageIds[0] ? await ctx.storage.getUrl(r.imageIds[0]) : null,
      }))
    );
  },
});

export const choose = mutation({
  args: { id: v.id('holmSourcing'), option: v.number() },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    const r = await ctx.db.get(a.id);
    if (!r || r.userId !== me.userId) throw new Error('Request not found.');
    if (r.status !== 'options_ready' || !r.options[a.option]) throw new Error('That option is no longer available.');
    await ctx.db.patch(a.id, { chosenOption: a.option, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
      key: `sourcing-choice:${a.id}:${a.option}`,
      to: 'owner',
      subject: `${r.number}: option chosen`,
      text: `${me.email} chose "${r.options[a.option].title}" for ${r.title}.`,
      replyTo: me.email,
    });
  },
});

export const adminList = query({
  args: { status: sourcingStatus },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const rows = await ctx.db.query('holmSourcing').withIndex('by_status', (q) => q.eq('status', a.status)).order('desc').take(100);
    return Promise.all(
      rows.map(async (r) => ({ ...r, imageUrls: await Promise.all(r.imageIds.map((i) => ctx.storage.getUrl(i))) }))
    );
  },
});

export const adminUpdate = mutation({
  args: {
    id: v.id('holmSourcing'),
    status: sourcingStatus,
    options: v.array(v.object({ title: v.string(), unitCents: v.number(), leadTime: v.string(), note: v.string() })),
    adminNote: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const r = await ctx.db.get(a.id);
    if (!r) throw new Error('Request not found.');
    if (a.options.length > 6 || a.options.some((o) => !o.title.trim() || o.title.length > 200 || !Number.isSafeInteger(o.unitCents) || o.unitCents < 0))
      throw new Error('Check the options: each needs a title and a price.');
    await ctx.db.patch(a.id, { status: a.status, options: a.options, adminNote: a.adminNote?.slice(0, 2000), updatedAt: Date.now() });
    if (a.status !== r.status)
      await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
        key: `sourcing-status:${a.id}:${a.status}`,
        to: r.email,
        subject: `${r.number}: ${LABEL[a.status]}`,
        text: `Your sourcing request "${r.title}" is now: ${LABEL[a.status]}.${a.status === 'options_ready' ? '\n\nSee the options in your account at https://louiemae.com/trade#sourcing' : ''}${a.adminNote ? `\n\n${a.adminNote}` : ''}`,
      });
  },
});
