import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { viewer } from './holmAccess';
import { digest } from './dlvSecurity';

export const GUEST_ORDER_ACCESS_MS = 90 * 24 * 60 * 60 * 1000;

/** An email string is never a credential. Email recovery requires a verified account. */
export async function ownsOrder(
  ctx: QueryCtx,
  owner: { userId?: Id<'users'>; email?: string },
  intent: Doc<'ordCheckoutIntents'> | null,
  token?: string
) {
  const me = await viewer(ctx);
  if (owner.userId) return me?.userId === owner.userId;
  if (me && owner.email && me.email === owner.email.trim().toLowerCase()) {
    const user = await ctx.db.get(me.userId);
    if (typeof user?.emailVerificationTime === 'number') return true;
  }
  if (
    !intent ||
    Date.now() >= intent.createdAt + GUEST_ORDER_ACCESS_MS ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    return false;
  // New intents freeze the authorization digest; historical intents retain their estimate scope.
  const hash =
    intent.guestCapabilityHash ?? (await ctx.db.get(intent.estimateId))?.guestCapabilityHash;
  return !!hash && (await digest(token)) === hash;
}
