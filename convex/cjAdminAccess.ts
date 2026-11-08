import { deliveryStaffRoles } from '../lib/delivery/staffRoles';
import { CommerceError } from '../lib/errors';
import { query, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";

type AdminCtx = Pick<MutationCtx | QueryCtx, "auth" | "db">;

const parseAdminEmails = (rawEmails: string | undefined): Set<string> =>
    new Set((rawEmails || "")
        .split(/[,\s]+/)
        .map(email => email.trim().toLowerCase())
        .filter(Boolean));

const getAdminEmailAllowlist = () =>
    parseAdminEmails(process.env.CJ_ADMIN_EMAILS || process.env.ADMIN_EMAILS);

export const requireCjAdminIdentity = async (ctx: AdminCtx, purpose?: 'delivery'): Promise<{ email: string }> => {
    const userId = await auth.getUserId(ctx).catch(() => null);
    const identity = await ctx.auth.getUserIdentity().catch(() => null);
    if (!userId) {
        throw new Error("You must be logged in to manage CJ fulfillment.");
    }

    // Convex Password sessions do not consistently expose email on the JWT
    // identity. The canonical auth user record does, so use it as the fallback.
    const user = await ctx.db.get(userId as Id<"users">);
    const identityEmail = typeof identity?.email === "string" ? identity.email : "";
    const userEmail = typeof user?.email === "string" ? user.email : "";
    const email = (identityEmail || userEmail).trim().toLowerCase();

    if (!email) {
        throw new Error("Your account is missing an email address required for CJ admin access.");
    }

    const adminEmails = getAdminEmailAllowlist();
    if (adminEmails.size === 0) {
        throw new Error("CJ admin access is not configured. Set CJ_ADMIN_EMAILS in Convex environment variables.");
    }
    if (!adminEmails.has(email)) {
        throw new Error("You do not have permission to manage CJ fulfillment.");
    }

    // Limited delivery staff must not regain owner rights through older admin endpoints.
    const roles = deliveryStaffRoles(process.env.DELIVERY_ADMIN_ROLES, email);
    if (purpose !== 'delivery' && !roles.includes('owner')) throw new CommerceError('FORBIDDEN');
    return { email };
};

/** Lets Node actions reuse the same canonical DB-backed admin allowlist check. */
export const verifyCjAdminIdentity = internalQuery({
    args: {},
    handler: async (ctx): Promise<{ email: string }> => requireCjAdminIdentity(ctx),
});

/** Safe navigation capabilities for the current account, never a client authorization decision. */
export const session = query({ args: {}, handler: async ctx => {
    try {
        const actor = await requireCjAdminIdentity(ctx, 'delivery');
        const roles = deliveryStaffRoles(process.env.DELIVERY_ADMIN_ROLES, actor.email);
        return { owner: roles.includes('owner'), delivery: roles.length > 0 };
    } catch { return { owner: false, delivery: false }; }
} });
