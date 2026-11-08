import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { viewer, isVerified } from './holmAccess';
import { membership } from './prgCore';
import { requireDeliveryRole } from './dlvAccess';
import { CommerceError } from '../lib/errors';
import { audit } from './sysCore';
import { US_STATES } from '../lib/delivery/destination';

export async function exemptionFor(
  ctx: MutationCtx | QueryCtx,
  channel: 'retail' | 'trade',
  state: string,
  at = Date.now()
) {
  if (channel !== 'trade') return null;
  const me = await viewer(ctx);
  if (!me || !isVerified(me.profile)) return null;
  const member = await membership(ctx, me.userId, 'trade');
  if (member?.state !== 'approved' || !member.organizationId) return null;
  const org = await ctx.db.get(member.organizationId);
  if (org?.verification !== 'verified') return null;
  const seats = await ctx.db
    .query('prgOrganizationMembers')
    .withIndex('by_org', (q) => q.eq('organizationId', org._id).eq('status', 'active'))
    .collect();
  if (!seats.some((s) => s.userId === me.userId)) return null;
  const records = await ctx.db
    .query('dlvTaxExemptions')
    .withIndex('by_org', (q) => q.eq('organizationId', org._id))
    .order('desc')
    .take(100);
  return (
    records.find(
      (r) =>
        r.status === 'verified' &&
        r.validFrom <= at &&
        r.validUntil > at &&
        r.states.includes(state)
    ) ?? null
  );
}
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'finance');
    return ctx.db.query('dlvTaxExemptions').order('desc').take(100);
  },
});
export const verify = mutation({
  args: {
    organizationId: v.id('prgOrganizations'),
    states: v.array(v.string()),
    evidence: v.string(),
    validFrom: v.number(),
    validUntil: v.number(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    const org = await ctx.db.get(a.organizationId);
    if (
      org?.verification !== 'verified' ||
      !a.evidence.trim() ||
      a.evidence.length > 2000 ||
      !a.states.length ||
      a.states.length > 51 ||
      a.states.some((s) => !US_STATES.has(s)) ||
      !Number.isSafeInteger(a.validFrom) ||
      !Number.isSafeInteger(a.validUntil) ||
      a.validUntil <= Math.max(a.validFrom, Date.now())
    )
      throw new CommerceError('INVALID_INPUT');
    const id = await ctx.db.insert('dlvTaxExemptions', {
      ...a,
      status: 'verified',
      verifiedBy: actor.email,
      createdAt: Date.now(),
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'delivery.tax_exemption.verify',
      entityTable: 'dlvTaxExemptions',
      entityId: id,
      reason: a.evidence,
    });
    return id;
  },
});
export const revoke = mutation({
  args: { id: v.id('dlvTaxExemptions'), reason: v.string() },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    if (!a.reason.trim()) throw new CommerceError('INVALID_INPUT');
    await ctx.db.patch(a.id, { status: 'revoked' });
    await audit(ctx, {
      actor: actor.email,
      action: 'delivery.tax_exemption.revoke',
      entityTable: 'dlvTaxExemptions',
      entityId: a.id,
      reason: a.reason,
    });
  },
});
