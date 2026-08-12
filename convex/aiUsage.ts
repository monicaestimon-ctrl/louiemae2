import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const CLAIM_TTL_MS = 60 * 60 * 1000;

export const claimPublicRequest = internalMutation({
  args: {
    clientToken: v.string(),
    requestHash: v.string(),
    operation: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<
    { allowed: true; usageId: string } |
    { allowed: false; reason: "duplicate" | "rate_limited"; response?: string }
  > => {
    const duplicate = await ctx.db.query("aiRequestUsage")
      .withIndex("by_request_hash", q => q.eq("requestHash", args.requestHash))
      .unique();
    if (duplicate) {
      return {
        allowed: false,
        reason: "duplicate",
        response: duplicate.status === "completed" ? duplicate.response : undefined,
      };
    }

    const recent = await ctx.db.query("aiRequestUsage")
      .withIndex("by_client_created", q =>
        q.eq("clientToken", args.clientToken).gte("createdAt", args.now - WINDOW_MS),
      )
      .take(MAX_REQUESTS_PER_WINDOW);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      return { allowed: false, reason: "rate_limited" };
    }

    const usageId = await ctx.db.insert("aiRequestUsage", {
      clientToken: args.clientToken,
      requestHash: args.requestHash,
      operation: args.operation,
      status: "claimed",
      createdAt: args.now,
      expiresAt: args.now + CLAIM_TTL_MS,
    });
    return { allowed: true, usageId };
  },
});

export const completePublicRequest = internalMutation({
  args: {
    usageId: v.id("aiRequestUsage"),
    response: v.optional(v.string()),
    success: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.usageId, {
      status: args.success ? "completed" : "failed",
      response: args.response?.slice(0, 3_000),
      expiresAt: args.now + CLAIM_TTL_MS,
    });
  },
});
