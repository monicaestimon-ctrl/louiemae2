import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { requireUser, viewer } from './holmAccess';

// Projects, boards, collages, inspiration and quiz results follow the account across devices.
const KEYS = ['tray', 'boards', 'collages', 'inspo', 'quiz'] as const;
const MAX_CHARS = 800_000; // stay well inside Convex's 1 MB document limit

export const load = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return null;
    const out: Record<string, unknown> = {};
    for (const key of KEYS) {
      const row = await ctx.db
        .query('holmUserState')
        .withIndex('by_user_key', (q) => q.eq('userId', me.userId).eq('key', key))
        .unique();
      if (row) out[key] = row.value;
    }
    return out;
  },
});

export const save = mutation({
  args: { key: v.union(...KEYS.map((k) => v.literal(k))), value: v.any() },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (JSON.stringify(a.value ?? null).length > MAX_CHARS) throw new Error('This is too large to save to your account.');
    const row = await ctx.db
      .query('holmUserState')
      .withIndex('by_user_key', (q) => q.eq('userId', me.userId).eq('key', a.key))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: a.value, updatedAt: Date.now() });
    else await ctx.db.insert('holmUserState', { userId: me.userId, key: a.key, value: a.value, updatedAt: Date.now() });
  },
});

/** Inspiration uploads live in file storage; the library keeps their public URLs. */
export const inspoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const inspoUrl = mutation({
  args: { fileId: v.id('_storage') },
  handler: async (ctx, a) => {
    await requireUser(ctx);
    const url = await ctx.storage.getUrl(a.fileId);
    if (!url) throw new Error('The image did not upload. Try again.');
    return url;
  },
});

// ---------- shared boards ----------
function boardSlug() {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => abc[b % abc.length]).join('');
}

export const shareBoard = mutation({
  args: {
    title: v.string(),
    mode: v.union(v.literal('shop'), v.literal('presentation')),
    items: v.array(v.object({ productId: v.id('commerceProducts') })),
  },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    const title = a.title.trim().slice(0, 120) || 'Board';
    if (!a.items.length || a.items.length > 60) throw new Error('Share a board with 1 to 60 pieces.');
    const recent = await ctx.db.query('holmSharedBoards').withIndex('by_owner', (q) => q.eq('ownerId', me.userId)).order('desc').take(30);
    if (recent.length === 30 && recent[29].createdAt > Date.now() - 86_400_000) throw new Error('You have shared many boards today. Try again tomorrow.');
    const slug = boardSlug();
    await ctx.db.insert('holmSharedBoards', {
      slug,
      ownerId: me.userId,
      title,
      mode: a.mode,
      by: me.profile?.businessName || me.profile?.displayName || 'A House of Louie Mae member',
      refCode: a.mode === 'shop' && me.profile?.partnerStatus === 'active' ? me.profile.refCode : undefined,
      items: a.items,
      createdAt: Date.now(),
    });
    return slug;
  },
});

/** Public view of a shared board: product ids only; prices come from the viewer's own catalog. */
export const sharedBoard = query({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    if (!/^[a-z0-9]{12}$/.test(a.slug)) return null;
    const b = await ctx.db.query('holmSharedBoards').withIndex('by_slug', (q) => q.eq('slug', a.slug)).unique();
    if (!b) return null;
    return { title: b.title, mode: b.mode, by: b.by, refCode: b.refCode ?? null, productIds: b.items.map((i) => i.productId) };
  },
});
