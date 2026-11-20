import { customerFacing } from '../lib/delivery/publicErrors';
import { v } from 'convex/values';
import { query } from './_generated/server';
import { ownsOrder, GUEST_ORDER_ACCESS_MS } from './ordAccess';
import { customerOrder } from './ordFulfillment';
import { SPLIT_MAY } from '../lib/customerCopy';

/** Redirects are only a reference. Only persisted, verified payment processing confirms an order. */
export const receipt = query({
  args: { sessionId: v.string(), guestCapability: v.optional(v.string()) },
  handler: async (ctx, a) =>
    customerFacing(async () => {
      if (!/^cs_[A-Za-z0-9_]{1,240}$/.test(a.sessionId)) return { state: 'unavailable' as const };
      const intent = await ctx.db
        .query('ordCheckoutIntents')
        .withIndex('by_session', (q) => q.eq('stripeSessionId', a.sessionId))
        .unique();
      if (intent) {
        if (!(await ownsOrder(ctx, intent.buyer, intent, a.guestCapability)))
          return { state: 'unavailable' as const };
        if (intent.status === 'exception') return { state: 'review_required' as const };
        if (intent.status === 'refunded') return { state: 'refunded' as const };
        if (intent.status === 'failed' || intent.status === 'expired')
          return { state: 'not_completed' as const };
        const order = await ctx.db
          .query('ordOrders')
          .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
          .unique();
        if (intent.status !== 'paid' || !order) return { state: 'pending' as const };
        const notification = await ctx.db
          .query('sysNotifications')
          .withIndex('by_dedupe', (q) => q.eq('dedupeKey', `order-confirmation:${order._id}`))
          .unique();
        return {
          state: 'confirmed' as const,
          order: await customerOrder(ctx, order),
          emailStatus: notification?.providerId
            ? ('accepted' as const)
            : notification?.status === 'failed'
              ? ('needs_review' as const)
              : notification?.deliveryVersion === 2
                ? ('pending' as const)
                : ('unverified' as const),
        };
      }
      // Legacy checkout has no guest capability. Its high-entropy session reference only reveals
      // payment state, never addresses, contact data, purchased items, totals or tracking.
      const legacy = await ctx.db
        .query('orders')
        .withIndex('by_session', (q) => q.eq('stripeSessionId', a.sessionId))
        .unique();
      if (!legacy) return { state: 'pending' as const };
      const issued = Date.parse(legacy.createdAt);
      if (!Number.isFinite(issued) || Date.now() >= issued + GUEST_ORDER_ACCESS_MS)
        return { state: 'unavailable' as const };
      if (legacy.status === 'pending') return { state: 'pending' as const };
      if (legacy.status === 'cancelled') return { state: 'not_completed' as const };
      return { state: 'legacy_confirmed' as const, disclosure: SPLIT_MAY };
    }),
});
