import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export type SignInUser = {
  existingUserId: Id<"users"> | null;
  type: string;
  providerId: string;
  profile: { email?: unknown; name?: unknown; image?: unknown; emailVerified?: unknown };
};

/**
 * Password sign-ups never verify their email, so the default rules would give a returning
 * customer a second, empty account the first time they use Google. When Google confirms the
 * email, sign-in joins the existing account for that address instead, and that account's
 * unverified password and other sessions are removed: whoever registered the address without
 * proving it loses access, and the verified owner keeps the account.
 */
export async function linkOrCreateUser(ctx: MutationCtx, args: SignInUser): Promise<Id<"users">> {
  if (args.existingUserId) return args.existingUserId;
  const email = typeof args.profile.email === "string" ? args.profile.email.toLowerCase() : undefined;
  const name = typeof args.profile.name === "string" ? args.profile.name : undefined;
  const image = typeof args.profile.image === "string" ? args.profile.image : undefined;
  const verified = args.type === "oauth" && args.providerId === "google" && args.profile.emailVerified === true;
  if (verified && email) {
    const matches = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(2);
    if (matches.length === 1) {
      const user = matches[0];
      if (user.emailVerificationTime === undefined) {
        const passwords = await ctx.db
          .query("authAccounts")
          .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id).eq("provider", "password"))
          .collect();
        for (const account of passwords) await ctx.db.delete(account._id);
        const sessions = await ctx.db
          .query("authSessions")
          .withIndex("userId", (q) => q.eq("userId", user._id))
          .collect();
        for (const session of sessions) {
          const tokens = await ctx.db
            .query("authRefreshTokens")
            .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
            .collect();
          for (const token of tokens) await ctx.db.delete(token._id);
          await ctx.db.delete(session._id);
        }
      }
      await ctx.db.patch(user._id, {
        emailVerificationTime: Date.now(),
        ...(!user.name && name ? { name } : {}),
        ...(!user.image && image ? { image } : {}),
      });
      return user._id;
    }
  }
  return ctx.db.insert("users", {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(image ? { image } : {}),
    ...(verified ? { emailVerificationTime: Date.now() } : {}),
  });
}
