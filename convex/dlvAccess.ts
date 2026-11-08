import type { QueryCtx, MutationCtx } from './_generated/server';
import { query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { CommerceError } from '../lib/errors';
type Role = 'support' | 'operations' | 'finance' | 'approver' | 'engineering';
async function access(ctx: QueryCtx | MutationCtx) {
  const actor = await requireCjAdminIdentity(ctx);
  // Existing configured site administrators remain owners until an explicit staff map is installed.
  // A configured map is fail-closed: an omitted administrator gets no delivery permissions.
  let roles: string[] = ['owner'];
  if (process.env.DELIVERY_ADMIN_ROLES) {
    try {
      const map = JSON.parse(process.env.DELIVERY_ADMIN_ROLES);
      roles = map[actor.email] ?? [];
      if (
        !Array.isArray(roles) ||
        roles.some(
          (r) =>
            !['owner', 'support', 'operations', 'finance', 'approver', 'engineering'].includes(r)
        )
      )
        throw new Error();
    } catch {
      throw new CommerceError('FORBIDDEN', 'Delivery staff role configuration needs review');
    }
  }
  const owner = roles.includes('owner');
  return {
    ...actor,
    support: owner || roles.length > 0,
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
