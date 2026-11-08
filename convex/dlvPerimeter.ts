import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { viewer } from './holmAccess';
import { digest } from './dlvSecurity';
import { verifyRequest } from '../lib/delivery/requestProof';
import { assertDeliveryBounds } from '../lib/delivery/requestBounds';

export const proofArg = v.object({
  issuedAt: v.number(),
  nonce: v.string(),
  rateKey: v.string(),
  signature: v.string(),
});
async function take(
  ctx: MutationCtx,
  key: string,
  capacity: number,
  perMinute: number,
  now: number
) {
  const row = await ctx.db
    .query('dlvRequestLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
  const available = Math.min(
    capacity,
    (row?.tokens ?? capacity) + (Math.max(0, now - (row?.refilledAt ?? now)) * perMinute) / 60000
  );
  const allowed = available >= 1;
  const value = {
    key,
    tokens: allowed ? available - 1 : available,
    refilledAt: now,
    expiresAt: now + 7 * 86400000,
  };
  if (row) await ctx.db.patch(row._id, value);
  else await ctx.db.insert('dlvRequestLimits', value);
  return allowed;
}
/** Separate transaction: rejected business input cannot roll back consumption. No raw IP stored. */
export const consume = internalMutation({
  args: {
    operation: v.union(v.literal('estimate'), v.literal('quote')),
    input: v.any(),
    proof: v.optional(proofArg),
  },
  handler: async (ctx, a): Promise<'ok' | 'forbidden' | 'limited'> => {
    assertDeliveryBounds(a.input, a.operation === 'quote' ? 100 : 30);
    const now = Date.now();
    if (
      !(await verifyRequest(
        process.env.DELIVERY_REQUEST_SECRET,
        a.operation,
        a.input,
        a.proof,
        now
      ))
    )
      return 'forbidden';
    const proof = a.proof!;
    if (
      await ctx.db
        .query('dlvRequestPermits')
        .withIndex('by_nonce', (q) => q.eq('nonce', proof.nonce))
        .unique()
    )
      return 'forbidden';
    const me = await viewer(ctx);
    let retry = false;
    if (
      a.operation === 'quote' &&
      typeof a.input.requestKey === 'string' &&
      /^[a-f0-9]{64}$/.test(a.input.requestKey)
    ) {
      const requestKeyHash = await digest(a.input.requestKey);
      const existing = await ctx.db
        .query('dlvQuoteRequests')
        .withIndex('by_request_key', (q) => q.eq('requestKeyHash', requestKeyHash))
        .unique();
      retry =
        !!existing &&
        existing.requestHash === (await digest({ ...a.input, userId: me?.userId ?? null }));
    }
    const scope = a.operation === 'quote' ? (retry ? 'quote-retry' : 'quote') : 'estimate';
    const capacity = scope === 'quote' ? 5 : 30;
    const refill = scope === 'quote' ? 5 / 60 : 30;
    // Consume the global budget first; rejected traffic cannot allocate unlimited principal rows.
    const global = await take(
      ctx,
      `${scope}:global`,
      scope === 'quote' ? 100 : 2000,
      scope === 'quote' ? 100 / 60 : 60,
      now
    );
    if (!global) return 'limited';
    const ip = await take(ctx, `${scope}:ip:${proof.rateKey}`, capacity, refill, now);
    const account = me
      ? await take(ctx, `${scope}:account:${me.userId}`, capacity, refill, now)
      : true;
    const email =
      scope === 'quote' && typeof a.input.email === 'string'
        ? await take(
            ctx,
            `${scope}:email:${await digest(a.input.email.trim().toLowerCase())}`,
            5,
            5 / 60,
            now
          )
        : true;
    if (!ip || !account || !email) return 'limited';
    await ctx.db.insert('dlvRequestPermits', { nonce: proof.nonce, expiresAt: now + 120000 });
    return 'ok';
  },
});
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of ['dlvRequestPermits', 'dlvRequestLimits'] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex('by_expiry', (q) => q.lt('expiresAt', Date.now()))
        .take(500);
      for (const row of rows) await ctx.db.delete(row._id);
    }
  },
});
