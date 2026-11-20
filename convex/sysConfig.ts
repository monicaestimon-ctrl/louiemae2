// Versioned configuration registry and the owner's decision register (spec S02, S35).
// Customer paths read only approved records (activeConfig); a value that is still proposed
// raises POLICY_NOT_APPROVED, so a proposed default can never become a public promise.
import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { CONFIG_KINDS, parseConfig, type ConfigKind } from '../lib/config';
import { CONFIG_SEED } from '../lib/config/seed';
import { CommerceError } from '../lib/errors';
import { flagStates } from '../lib/flags';
import { audit } from './sysCore';

type Ctx = QueryCtx | MutationCtx;
const kindValidator = v.string();
function asKind(k: string): ConfigKind {
  if (!(CONFIG_KINDS as readonly string[]).includes(k))
    throw new CommerceError('INVALID_INPUT', `Unknown config kind ${k}`);
  return k as ConfigKind;
}

const inForce = (r: Doc<'sysConfig'>, at: number) =>
  r.effectiveFrom <= at && (r.effectiveTo === undefined || r.effectiveTo > at);

/**
 * The record in force for (kind, key) at `at`: the newest approved version. With
 * `allowProposed: 'simulation'` (admin previews only) the newest proposed version is returned
 * when nothing is approved, marked as such.
 */
export async function activeConfig<T = unknown>(
  ctx: Ctx,
  kind: ConfigKind,
  key: string,
  opts: { at?: number; allowProposed?: 'simulation' } = {}
): Promise<{
  value: T;
  version: number;
  status: Doc<'sysConfig'>['status'];
  id: Doc<'sysConfig'>['_id'];
  effectiveTo?: number;
}> {
  const at = opts.at ?? Date.now();
  const rows = await ctx.db
    .query('sysConfig')
    .withIndex('by_kind_key_version', (q) => q.eq('kind', kind).eq('key', key))
    .order('desc')
    .take(50);
  const approved = rows.find((r) => r.status === 'approved' && inForce(r, at));
  if (approved)
    return {
      value: approved.value as T,
      version: approved.version,
      status: approved.status,
      id: approved._id,
      ...(approved.effectiveTo !== undefined ? { effectiveTo: approved.effectiveTo } : {}),
    };
  const proposed = rows.find((r) => r.status === 'proposed');
  if (proposed && opts.allowProposed === 'simulation')
    return {
      value: proposed.value as T,
      version: proposed.version,
      status: proposed.status,
      id: proposed._id,
    };
  throw new CommerceError(
    'POLICY_NOT_APPROVED',
    `${kind}/${key} has no approved version${proposed ? ` (decision ${proposed.decision ?? 'pending'})` : ''}`
  );
}

/** Like activeConfig, but returns null instead of throwing (for UI and reports). */
export async function maybeConfig<T = unknown>(
  ctx: Ctx,
  kind: ConfigKind,
  key: string,
  at?: number
) {
  try {
    return await activeConfig<T>(ctx, kind, key, { at });
  } catch {
    return null;
  }
}

export const active = internalQuery({
  args: { kind: kindValidator, key: v.string(), at: v.optional(v.number()) },
  handler: (ctx, a) => activeConfig(ctx, asKind(a.kind), a.key, { at: a.at }),
});

/** Every record, newest first, for the admin decision register. */
export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('proposed'),
        v.literal('approved'),
        v.literal('retired'),
        v.literal('rejected')
      )
    ),
  },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    const rows = a.status
      ? await ctx.db
          .query('sysConfig')
          .withIndex('by_status', (q) => q.eq('status', a.status!))
          .order('desc')
          .take(500)
      : await ctx.db.query('sysConfig').order('desc').take(500);
    return { records: rows, flags: flagStates() };
  },
});

async function insertVersion(
  ctx: MutationCtx,
  a: {
    kind: ConfigKind;
    key: string;
    value: unknown;
    note: string;
    decision?: string;
    status: 'proposed' | 'approved';
    actor: string;
    effectiveFrom?: number;
  }
) {
  parseConfig(a.kind, a.value);
  const latest = await ctx.db
    .query('sysConfig')
    .withIndex('by_kind_key_version', (q) => q.eq('kind', a.kind).eq('key', a.key))
    .order('desc')
    .first();
  const now = Date.now();
  const id = await ctx.db.insert('sysConfig', {
    kind: a.kind,
    key: a.key,
    version: (latest?.version ?? 0) + 1,
    status: a.status,
    value: a.value,
    note: a.note,
    ...(a.decision ? { decision: a.decision } : {}),
    ...(a.status === 'approved' ? { approvedBy: a.actor, approvedAt: now } : {}),
    createdAt: now,
    createdBy: a.actor,
    effectiveFrom: a.effectiveFrom ?? now,
    source: 'admin',
  });
  return id;
}

/** Proposes a new version of a config record. It has no effect until approved. */
export const propose = mutation({
  args: {
    kind: kindValidator,
    key: v.string(),
    value: v.any(),
    note: v.string(),
    decision: v.optional(v.string()),
    effectiveFrom: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'operations');
    if (
      a.effectiveFrom !== undefined &&
      (!Number.isSafeInteger(a.effectiveFrom) || a.effectiveFrom < Date.now())
    )
      throw new CommerceError('INVALID_INPUT', 'Effective date must be now or in the future');
    const id = await insertVersion(ctx, {
      kind: asKind(a.kind),
      key: a.key.trim(),
      value: a.value,
      note: a.note,
      decision: a.decision,
      status: 'proposed',
      actor: admin.email,
      effectiveFrom: a.effectiveFrom,
    });
    await audit(ctx, {
      actor: admin.email,
      action: 'config.propose',
      entityTable: 'sysConfig',
      entityId: id,
      after: { kind: a.kind, key: a.key, value: a.value },
    });
    return id;
  },
});

/** The owner approves a proposed record: it comes into force now and retires the version it replaces. */
export const approve = mutation({
  args: { id: v.id('sysConfig'), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    const row = await ctx.db.get(a.id);
    if (!row || row.status !== 'proposed')
      throw new CommerceError('INVALID_INPUT', 'Only a proposed record can be approved.');
    parseConfig(row.kind as ConfigKind, row.value);
    const now = Date.now();
    const current = await ctx.db
      .query('sysConfig')
      .withIndex('by_kind_key_version', (q) => q.eq('kind', row.kind).eq('key', row.key))
      .collect();
    const starts = Math.max(row.effectiveFrom, now);
    if (current.some((r) => r.status === 'approved' && r._id !== row._id && r.effectiveFrom > now))
      throw new CommerceError(
        'INVALID_INPUT',
        'Review the already scheduled version before scheduling another'
      );
    for (const r of current)
      if (
        r.status === 'approved' &&
        r._id !== row._id &&
        (r.effectiveTo === undefined || r.effectiveTo > starts)
      )
        await ctx.db.patch(r._id, {
          effectiveTo: starts,
          ...(starts <= now ? { status: 'retired' as const } : {}),
        });
    await ctx.db.patch(row._id, {
      status: 'approved',
      approvedBy: admin.email,
      approvedAt: now,
      effectiveFrom: starts,
    });
    await audit(ctx, {
      actor: admin.email,
      action: 'config.approve',
      entityTable: 'sysConfig',
      entityId: row._id,
      reason: a.note,
      after: { kind: row.kind, key: row.key, version: row.version },
    });
  },
});

export const reject = mutation({
  args: { id: v.id('sysConfig'), note: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    const row = await ctx.db.get(a.id);
    if (!row || row.status !== 'proposed')
      throw new CommerceError('INVALID_INPUT', 'Only a proposed record can be rejected.');
    await ctx.db.patch(row._id, { status: 'rejected' });
    await audit(ctx, {
      actor: admin.email,
      action: 'config.reject',
      entityTable: 'sysConfig',
      entityId: row._id,
      reason: a.note,
    });
  },
});

/**
 * Loads the seed records (02 §6). Idempotent by kind + key + version: a record already present is
 * left exactly as it is, including any approval the owner has since given.
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    let added = 0;
    for (const s of CONFIG_SEED) {
      parseConfig(s.kind, s.value);
      const existing = await ctx.db
        .query('sysConfig')
        .withIndex('by_kind_key_version', (q) =>
          q.eq('kind', s.kind).eq('key', s.key).eq('version', s.version)
        )
        .first();
      if (existing) continue;
      const now = Date.now();
      await ctx.db.insert('sysConfig', {
        kind: s.kind,
        key: s.key,
        version: s.version,
        status: s.status,
        value: s.value,
        note: s.note,
        ...(s.decision ? { decision: s.decision } : {}),
        ...(s.status === 'approved' ? { approvedBy: 'v2 specification', approvedAt: now } : {}),
        createdAt: now,
        createdBy: 'seed',
        effectiveFrom: 0,
        source: 'docs/production-v2/02 §6',
      });
      added++;
    }
    return { added, total: CONFIG_SEED.length };
  },
});
