import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";

// Google sign-in reads AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the deployment environment;
// the trade site only offers it once both are set (see holm.signInOptions).
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, Google],
});
