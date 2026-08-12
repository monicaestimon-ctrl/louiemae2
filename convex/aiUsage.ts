import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const MAX_GLOBAL_REQUESTS_PER_WINDOW = 120;
const CLAIM_TTL_MS = 60 * 60 * 1000;
const CLAIM_LEASE_MS = 60 * 1000;

export const claimPublicRequest = internalMutation({
  args: {
    clientToken: v.string(),
    requestHash: v.string(),
    operation: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<
    { allowed: true; usageId: Id<"aiRequestUsage"> } |
    { allowed: false; reason: "duplicate" | "rate_limited"; response?: string }
  > => {
    const duplicate = await ctx.db.query("aiRequestUsage")
      .withIndex("by_request_hash", q => q.eq("requestHash", args.requestHash))
      .order("desc")
      .first();
    if (duplicate?.status === "completed") {
      return {
        allowed: false,
        reason: "duplicate",
        response: duplicate.response,
      };
    }
    if (duplicate?.status === "claimed" && duplicate.createdAt > args.now - CLAIM_LEASE_MS) {
      return { allowed: false, reason: "rate_limited" };
    }

    const recent = await ctx.db.query("aiRequestUsage")
      .withIndex("by_client_created", q =>
        q.eq("clientToken", args.clientToken).gte("createdAt", args.now - WINDOW_MS),
      )
      .take(MAX_REQUESTS_PER_WINDOW);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      return { allowed: false, reason: "rate_limited" };
    }

    const recentGlobal = await ctx.db.query("aiRequestUsage")
      .withIndex("by_operation_created", q =>
        q.eq("operation", args.operation).gte("createdAt", args.now - WINDOW_MS),
      )
      .take(MAX_GLOBAL_REQUESTS_PER_WINDOW);
    if (recentGlobal.length >= MAX_GLOBAL_REQUESTS_PER_WINDOW) {
      return { allowed: false, reason: "rate_limited" };
    }

    if (duplicate) {
      await ctx.db.patch(duplicate._id, {
        clientToken: args.clientToken,
        operation: args.operation,
        status: "claimed",
        response: undefined,
        createdAt: args.now,
        expiresAt: args.now + CLAIM_TTL_MS,
      });
      return { allowed: true, usageId: duplicate._id };
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
