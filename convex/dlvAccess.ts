import { flagStates } from '../lib/flags';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { deliveryStaffRoles } from '../lib/delivery/staffRoles';
import type { QueryCtx, MutationCtx } from './_generated/server';
import { query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { CommerceError } from '../lib/errors';
type Role = 'support' | 'operations' | 'finance' | 'approver' | 'engineering';
async function access(ctx: QueryCtx | MutationCtx) {
  const actor = await requireCjAdminIdentity(ctx, 'delivery');
  const roles = deliveryStaffRoles(process.env.DELIVERY_ADMIN_ROLES, actor.email);
  const owner = roles.includes('owner');
  return {
    ...actor,
    owner,
    support:
      owner || roles.some((r) => ['support', 'operations', 'finance', 'approver'].includes(r)),
    operations: owner || roles.some((r) => ['operations', 'finance', 'approver'].includes(r)),
    finance: owner || roles.some((r) => ['finance', 'approver'].includes(r)),
    approver: owner || roles.includes('approver'),
    engineering: owner || roles.includes('engineering'),
  };
}
export async function requireDeliveryRole(ctx: QueryCtx | MutationCtx, role: Role) {
  const a = await access(ctx);
  if (!a[role])
    throw new CommerceError('FORBIDDEN', 'This delivery action requires an authorized staff role');
  return a;
}
export const permissions = query({ args: {}, handler: access });
export const supportQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'support');
    const rows = await ctx.db.query('dlvQuoteRequests').order('desc').take(50);
    return rows.map((r) => ({
      id: r._id,
      name: r.name,
      postalCode: r.postalCode,
      status: r.status,
      customerMessage: r.customerMessage ?? null,
      updatedAt: r.updatedAt,
    }));
  },
});

export const supportRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'support');
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 50)
      throw new CommerceError('INVALID_INPUT');
    const page = await ctx.db.query('dlvQuoteRequests').order('desc').paginate(a.paginationOpts);
    return {
      ...page,
      page: page.page.map((r) => ({
        id: r._id,
        name: r.name,
        postalCode: r.postalCode,
        status: r.status,
        customerMessage: r.customerMessage ?? null,
        updatedAt: r.updatedAt,
      })),
    };
  },
});
/** Explicit projection: support can explain the customer total, never supplier economics or tokens. */
export const supportEstimate = query({
  args: { id: v.id('dlvEstimates') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'support');
    const row = await ctx.db.get(a.id);
    if (!row) return null;
    return {
      id: row._id,
      channel: row.channel,
      status: row.status,
      postalCode: row.destination.zip,
      serviceTerms: row.serviceTerms ?? null,
      merchandiseMinor: row.merchandiseMinor,
      deliveryMinor: row.deliveryChargeMinor ?? null,
      taxMinor: row.taxMinor ?? null,
      totalMinor: row.totalMinor ?? null,
      creditMinor: row.creditMinor,
      expiresAt: row.expiresAt,
      expired: row.expiresAt <= Date.now(),
      shipmentCount: row.groups.length,
    };
  },
});

/** Integration readiness contains booleans only: no credentials, contacts or financial amounts. */
export const integrations = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'engineering');
    return {
      flags: flagStates(),
      gatewayConfigured: !!process.env.DELIVERY_REQUEST_SECRET,
      taxProviderConfigured: !!process.env.STRIPE_SECRET_KEY,
      notificationProviderConfigured: !!process.env.RESEND_API_KEY,
    };
  },
});
