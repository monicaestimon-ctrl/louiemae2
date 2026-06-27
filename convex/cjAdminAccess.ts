import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

type AdminCtx = Pick<ActionCtx | MutationCtx | QueryCtx, "auth">;

const parseAdminEmails = (rawEmails: string | undefined): Set<string> =>
    new Set((rawEmails || "")
        .split(/[,\s]+/)
        .map(email => email.trim().toLowerCase())
        .filter(Boolean));

const getAdminEmailAllowlist = () =>
    parseAdminEmails(process.env.CJ_ADMIN_EMAILS);

export const requireCjAdminIdentity = async (ctx: AdminCtx): Promise<{ email: string }> => {
    const identity = await ctx.auth.getUserIdentity().catch(() => null);
    const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";

    if (!email) {
        throw new Error("You must be logged in with an email address to manage CJ fulfillment.");
    }

    const adminEmails = getAdminEmailAllowlist();
    if (adminEmails.size === 0) {
        throw new Error("CJ admin access is not configured. Set CJ_ADMIN_EMAILS in Convex environment variables.");
    }
    if (!adminEmails.has(email)) {
        throw new Error("You do not have permission to manage CJ fulfillment.");
    }

    return { email };
};
