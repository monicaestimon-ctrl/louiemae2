import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { query, mutation, action, internalMutation, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireUser, viewer } from './holmAccess';
import { insertClick } from './holmPartners';

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

const MAX_COVER = 5 * 1024 * 1024;

/**
 * Stores a rendered board cover on the server and records who uploaded it. Covers never go
 * through a bare upload URL, so the owner of every cover is known when a board adopts it.
 */
export const uploadCover = action({
  args: { bytes: v.bytes(), type: v.string() },
  handler: async (ctx, a): Promise<Id<'_storage'>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Sign in to share a board.');
    if (!/^image\/(jpeg|png|webp)$/.test(a.type) || !a.bytes.byteLength || a.bytes.byteLength > MAX_COVER)
      throw new Error('This board image could not be used.');
    const storageId = await ctx.storage.store(new Blob([a.bytes], { type: a.type }));
    await ctx.runMutation(internal.holmSync.claimCover, { userId, storageId });
    return storageId;
  },
});

export const claimCover = internalMutation({
  args: { userId: v.id('users'), storageId: v.id('_storage') },
  handler: async (ctx, a) => {
    await ctx.db.insert('holmCoverUploads', { ...a, createdAt: Date.now() });
  },
});

const MAX_DOC = 200_000;

/** A board only adopts (and later deletes) a cover that its sharer uploaded through uploadCover. */
async function checkCover(ctx: MutationCtx, id: Id<'_storage'>, userId: Id<'users'>) {
  const claim = await ctx.db.query('holmCoverUploads').withIndex('by_storage', (q) => q.eq('storageId', id)).first();
  const file = await ctx.db.system.get(id);
  if (!claim || claim.userId !== userId || !file || !file.contentType?.startsWith('image/') || file.size > MAX_COVER)
    throw new Error('This board image could not be used. Try sharing again.');
}

async function dropCover(ctx: MutationCtx, id: Id<'_storage'>) {
  const claim = await ctx.db.query('holmCoverUploads').withIndex('by_storage', (q) => q.eq('storageId', id)).first();
  if (claim) await ctx.db.delete(claim._id);
  await ctx.storage.delete(id);
}
// Data URLs (local uploads) never travel with a shared layout; they stay on the sharer's device.
const docSize = (doc: unknown) => (doc === undefined ? 0 : JSON.stringify(doc).length);

/**
 * Shares a board, or updates the board already shared from the same collage in the same mode:
 * the slug stays the same, so a Story or PDF made last week keeps opening the current board.
 */
export const shareBoard = mutation({
  args: {
    title: v.string(),
    mode: v.union(v.literal('shop'), v.literal('presentation')),
    items: v.array(
      v.object({ productId: v.id('commerceProducts'), variantId: v.optional(v.string()), qty: v.optional(v.number()) })
    ),
    boardKey: v.optional(v.string()),
    doc: v.optional(v.any()),
    coverId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    const title = a.title.trim().slice(0, 120) || 'Board';
    if (!a.items.length || a.items.length > 60) throw new Error('Share a board with 1 to 60 pieces.');
    if (docSize(a.doc) > MAX_DOC) throw new Error('This board is too large to share. Remove a few uploaded images and try again.');
    if (a.boardKey !== undefined && !/^[\w-]{1,40}$/.test(a.boardKey)) throw new Error('This board could not be shared.');
    const items = a.items.map((i) => ({
      productId: i.productId,
      ...(i.variantId ? { variantId: i.variantId.slice(0, 64) } : {}),
      qty: Math.max(1, Math.min(99, Math.round(i.qty ?? 1))),
    }));
    // Presentation links never carry a partner code.
    const refCode = a.mode === 'shop' && me.profile?.partnerStatus === 'active' ? me.profile.refCode : undefined;
    const now = Date.now();
    const existing = a.boardKey
      ? await ctx.db
          .query('holmSharedBoards')
          .withIndex('by_owner_key', (q) => q.eq('ownerId', me.userId).eq('boardKey', a.boardKey).eq('mode', a.mode))
          .first()
      : null;
    if (a.coverId && a.coverId !== existing?.coverId) await checkCover(ctx, a.coverId, me.userId);
    if (existing) {
      if (a.coverId && existing.coverId && existing.coverId !== a.coverId) await dropCover(ctx, existing.coverId);
      await ctx.db.patch(existing._id, { title, items, refCode, doc: a.doc, ...(a.coverId ? { coverId: a.coverId } : {}), updatedAt: now });
      return { slug: existing.slug, refCode: refCode ?? null };
    }
    const recent = await ctx.db.query('holmSharedBoards').withIndex('by_owner', (q) => q.eq('ownerId', me.userId)).order('desc').take(30);
    if (recent.length === 30 && recent[29].createdAt > now - 86_400_000) throw new Error('You have shared many boards today. Try again tomorrow.');
    const slug = boardSlug();
    await ctx.db.insert('holmSharedBoards', {
      slug,
      ownerId: me.userId,
      title,
      mode: a.mode,
      by: me.profile?.businessName || me.profile?.displayName || 'A House of Louie Mae member',
      refCode,
      items,
      boardKey: a.boardKey,
      doc: a.doc,
      coverId: a.coverId,
      views: 0,
      updatedAt: now,
      createdAt: now,
    });
    return { slug, refCode: refCode ?? null };
  },
});

/** Public view of a shared board: product ids, quantities and layout; prices come from the viewer's own catalog. */
export const sharedBoard = query({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    if (!/^[a-z0-9]{12}$/.test(a.slug)) return null;
    const b = await ctx.db.query('holmSharedBoards').withIndex('by_slug', (q) => q.eq('slug', a.slug)).unique();
    if (!b) return null;
    return {
      title: b.title,
      mode: b.mode,
      by: b.by,
      refCode: b.mode === 'shop' ? (b.refCode ?? null) : null,
      productIds: b.items.map((i) => i.productId),
      items: b.items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, qty: i.qty ?? 1 })),
      doc: b.doc ?? null,
      coverUrl: b.coverId ? await ctx.storage.getUrl(b.coverId) : null,
    };
  },
});

/**
 * Someone opened a board link: count the view and, for a shoppable board from an active
 * partner, record the visit with its channel so the 30-day attribution window starts.
 */
export const boardOpened = mutation({
  args: { slug: v.string(), channel: v.string(), visitorId: v.string() },
  handler: async (ctx, a) => {
    if (!/^[a-z0-9]{12}$/.test(a.slug)) return;
    const b = await ctx.db.query('holmSharedBoards').withIndex('by_slug', (q) => q.eq('slug', a.slug)).unique();
    if (!b) return;
    await ctx.db.patch(b._id, { views: (b.views ?? 0) + 1 });
    if (b.mode === 'shop' && b.refCode)
      await insertClick(ctx, { refCode: b.refCode, channel: a.channel, target: 'b/' + b.slug, visitorId: a.visitorId, board: b.slug });
  },
});
