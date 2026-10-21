import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";
import type { MutationCtx } from "./_generated/server";
import { linkOrCreateUser } from "./authLinking";

// Google sign-in reads AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the deployment environment;
// the trade site only offers it once both are set (see holm.signInOptions).
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password,
    Google({
      // Pass Google's own verification flag through, so linking relies on it rather than on
      // the library's default assumption that every OAuth email is verified.
      profile: (p) => ({
        id: p.sub,
        name: p.name,
        email: typeof p.email === "string" ? p.email.toLowerCase() : undefined,
        image: p.picture,
        emailVerified: p.email_verified === true,
      }),
    }),
  ],
  callbacks: {
    // Joins a verified Google sign-in to the existing account for that email (see authLinking).
    createOrUpdateUser: (ctx, args) =>
      linkOrCreateUser(ctx as unknown as MutationCtx, {
        existingUserId: args.existingUserId as Parameters<typeof linkOrCreateUser>[1]["existingUserId"],
        type: args.type,
        providerId: args.provider.id,
        profile: args.profile,
      }),
  },
});
