import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { auth } from './auth';
import { requireCjAdminIdentity } from './cjAdminAccess';

type Ctx = QueryCtx | MutationCtx;

/** The signed-in account and its House profile, or null. */
export async function viewer(ctx: Ctx) {
  const userId = (await auth.getUserId(ctx).catch(() => null)) as Id<'users'> | null;
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  const profile = await ctx.db
    .query('holmProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  return { userId, email: (typeof user?.email === 'string' ? user.email : '').toLowerCase(), profile };
}

export const isVerified = (p: Doc<'holmProfiles'> | null) => p?.tradeStatus === 'approved';
export const isPartner = (p: Doc<'holmProfiles'> | null) => p?.partnerStatus === 'active';

export async function isAdmin(ctx: Ctx) {
  try {
    await requireCjAdminIdentity(ctx);
    return true;
  } catch {
    return false;
  }
}

export async function requireUser(ctx: Ctx) {
  const me = await viewer(ctx);
  if (!me) throw new Error('Sign in to continue.');
  return me;
}

export async function profileOf(ctx: Ctx, userId: Id<'users'>) {
  return ctx.db
    .query('holmProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
}
