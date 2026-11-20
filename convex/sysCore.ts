// System primitives for v2 (spec S03): idempotency keys, append-only audit events and leases.
// Convex mutations are serializable transactions, so "look up the key, then insert it" inside the
// caller's mutation is exactly-once: two concurrent claims conflict and one retries, sees the
// key and returns duplicate.
import type { MutationCtx, QueryCtx } from './_generated/server';

export type Claim = { duplicate: false } | { duplicate: true; resultRef?: string };

export async function claimKey(ctx: MutationCtx, key: string, scope: string, resultRef?: string): Promise<Claim> {
  if (!key || key.length > 300) throw new Error('Invalid idempotency key');
  const existing = await ctx.db.query('sysIdempotencyKeys').withIndex('by_key', (q) => q.eq('key', key)).first();
  if (existing) return { duplicate: true, resultRef: existing.resultRef };
  await ctx.db.insert('sysIdempotencyKeys', { key, scope, createdAt: Date.now(), ...(resultRef ? { resultRef } : {}) });
  return { duplicate: false };
}

/** Records what a claimed key produced, so a duplicate call can return the same result. */
export async function setKeyResult(ctx: MutationCtx, key: string, resultRef: string) {
  const row = await ctx.db.query('sysIdempotencyKeys').withIndex('by_key', (q) => q.eq('key', key)).first();
  if (row && row.resultRef !== resultRef) await ctx.db.patch(row._id, { resultRef });
}

export async function keyExists(ctx: QueryCtx, key: string) {
  return !!(await ctx.db.query('sysIdempotencyKeys').withIndex('by_key', (q) => q.eq('key', key)).first());
}

export type AuditInput = {
  actor: string;
  action: string;
  entityTable: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  requestId?: string;
};

/** Appends an audit event. Audit rows are never patched or deleted (scripts/verify-append-only.mjs). */
export async function audit(ctx: MutationCtx, e: AuditInput) {
  return ctx.db.insert('sysAuditEvents', { ...e, at: Date.now() });
}

/**
 * Takes a named lease for `ttlMs` (a lock that survives across the mutations of a scheduled
 * sequence). Returns false while another holder's lease is unexpired. Re-taking your own lease
 * extends it.
 */
export async function acquireLock(ctx: MutationCtx, name: string, holder: string, ttlMs: number, now = Date.now()) {
  const row = await ctx.db.query('sysLocks').withIndex('by_name', (q) => q.eq('name', name)).first();
  if (row && row.holder !== holder && row.expiresAt > now) return false;
  if (row) await ctx.db.patch(row._id, { holder, expiresAt: now + ttlMs });
  else await ctx.db.insert('sysLocks', { name, holder, expiresAt: now + ttlMs });
  return true;
}

export async function releaseLock(ctx: MutationCtx, name: string, holder: string) {
  const row = await ctx.db.query('sysLocks').withIndex('by_name', (q) => q.eq('name', name)).first();
  if (row && row.holder === holder) await ctx.db.patch(row._id, { expiresAt: 0 });
}

/** Opens a review item once per (kind, entity) while one is open. */
export async function openReview(ctx: MutationCtx, kind: string, entityTable: string, entityId: string, detail: string) {
  const open = await ctx.db
    .query('sysReviewItems')
    .withIndex('by_entity', (q) => q.eq('entityTable', entityTable).eq('entityId', entityId))
    .filter((q) => q.and(q.eq(q.field('kind'), kind), q.eq(q.field('status'), 'open')))
    .first();
  if (open) return open._id;
  return ctx.db.insert('sysReviewItems', { kind, entityTable, entityId, detail: detail.slice(0, 1000), status: 'open', createdAt: Date.now() });
}

/** Counts an operational metric in the current UTC hour bucket (spec S39). */
export async function bumpMetric(ctx: MutationCtx, name: string, value?: number, now = Date.now()) {
  const bucket = new Date(now).toISOString().slice(0, 13);
  const row = await ctx.db.query('sysMetrics').withIndex('by_name_bucket', (q) => q.eq('name', name).eq('bucket', bucket)).first();
  if (row) await ctx.db.patch(row._id, { count: row.count + 1, ...(value !== undefined ? { sum: (row.sum ?? 0) + value } : {}), updatedAt: now });
  else await ctx.db.insert('sysMetrics', { name, bucket, count: 1, ...(value !== undefined ? { sum: value } : {}), updatedAt: now });
}

/** Token-bucket rate limit (spec S38). Returns false when the caller is over the limit. */
export async function rateLimit(ctx: MutationCtx, key: string, capacity: number, refillPerMinute: number, now = Date.now()) {
  const row = await ctx.db.query('sysRateLimits').withIndex('by_key', (q) => q.eq('key', key)).first();
  const tokens = row ? Math.min(capacity, row.tokens + ((now - row.refilledAt) / 60_000) * refillPerMinute) : capacity;
  if (tokens < 1) {
    if (row) await ctx.db.patch(row._id, { tokens, refilledAt: now });
    return false;
  }
  if (row) await ctx.db.patch(row._id, { tokens: tokens - 1, refilledAt: now });
  else await ctx.db.insert('sysRateLimits', { key, tokens: tokens - 1, refilledAt: now });
  return true;
}
