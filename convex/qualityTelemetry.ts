import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireDeliveryRole } from './dlvAccess';
import { qualityRoute, qualityDevice } from './qualityTables';
import {
  FIELD_RETENTION_DAYS,
  FIELD_MAX_BATCH_BYTES,
  parseFieldBatch,
  replaceFieldSample,
  summarizeFieldMetric,
} from '../lib/quality/fieldPolicy';
const DAY = 86_400_000;
export const QUALITY_DAILY_REQUESTS = 5000;
export const QUALITY_DAILY_VISITS = 1000;
/** Disabled until opt-in collection, HTTP abuse bounds and staff reporting are deployed together. */
export const record = internalMutation({
  args: { payload: v.string() },
  handler: async (ctx, { payload }) => {
    if (process.env.FIELD_QUALITY_ENABLED !== 'true') return { status: 'disabled' };
    if (new globalThis.TextEncoder().encode(payload).byteLength > FIELD_MAX_BATCH_BYTES)
      return { status: 'invalid' };
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      return { status: 'invalid' };
    }
    const batch = parseFieldBatch(value);
    if (!batch) return { status: 'invalid' };
    const now = Date.now(),
      day = Math.floor(now / DAY);
    const budget = await ctx.db
      .query('qualityBudgets')
      .withIndex('by_day', (q) => q.eq('day', day))
      .unique();
    if ((budget?.requests ?? 0) >= QUALITY_DAILY_REQUESTS) return { status: 'limited' };
    const old = await ctx.db
      .query('qualityVisits')
      .withIndex('by_token', (q) => q.eq('documentToken', batch.documentToken))
      .unique();
    if (!old && (budget?.visits ?? 0) >= QUALITY_DAILY_VISITS) return { status: 'limited' };
    const nextBudget = {
      requests: (budget?.requests ?? 0) + 1,
      visits: (budget?.visits ?? 0) + (old ? 0 : 1),
    };
    if (budget) await ctx.db.patch(budget._id, nextBudget);
    else await ctx.db.insert('qualityBudgets', { day, ...nextBudget });
    if (old) {
      if (
        old.createdAt <= now - FIELD_RETENTION_DAYS * DAY ||
        old.release !== batch.release ||
        old.route !== batch.route ||
        old.device !== batch.device
      )
        return { status: 'conflict' };
      const samples = [...old.samples];
      let changed = false;
      for (const incoming of batch.samples) {
        const index = samples.findIndex((s) => s.name === incoming.name);
        const previous = index < 0 ? undefined : samples[index];
        const next = replaceFieldSample(previous, incoming);
        if (next !== previous) {
          changed = true;
          if (index < 0) samples.push(next);
          else samples[index] = next;
        }
      }
      if (changed) await ctx.db.patch(old._id, { samples, updatedAt: now });
      return { status: changed ? 'recorded' : 'duplicate' };
    }
    await ctx.db.insert('qualityVisits', {
      documentToken: batch.documentToken,
      release: batch.release,
      route: batch.route,
      device: batch.device,
      createdAt: now,
      updatedAt: now,
      samples: batch.samples,
    });
    return { status: 'recorded' };
  },
});
export const summary = query({
  args: { route: qualityRoute, device: qualityDevice, release: v.string() },
  handler: async (ctx, args) => {
    await requireDeliveryRole(ctx, 'engineering');
    if (!/^[a-f0-9]{40}$/.test(args.release)) throw Error('Invalid release');
    const now = Date.now(),
      since = now - FIELD_RETENTION_DAYS * DAY;
    const rows = await ctx.db
      .query('qualityVisits')
      .withIndex('by_segment_created', (q) =>
        q
          .eq('route', args.route)
          .eq('device', args.device)
          .eq('release', args.release)
          .gt('createdAt', since)
      )
      .order('desc')
      .take(5001);
    const truncated = rows.length > 5000;
    const observations = rows.slice(0, 5000);
    const budget = await ctx.db
      .query('qualityBudgets')
      .withIndex('by_day', (q) => q.eq('day', Math.floor(now / DAY)))
      .unique();
    const budgetHistory = await ctx.db
      .query('qualityBudgets')
      .withIndex('by_day', (q) => q.gte('day', Math.floor(since / DAY)))
      .order('desc')
      .take(FIELD_RETENTION_DAYS + 2);
    const limitedDays = budgetHistory.filter(
      (row) => row.requests >= QUALITY_DAILY_REQUESTS || row.visits >= QUALITY_DAILY_VISITS
    ).length;
    return {
      enabled: process.env.FIELD_QUALITY_ENABLED === 'true',
      since,
      through: now,
      route: args.route,
      device: args.device,
      release: args.release,
      truncated,
      collectionLimited: limitedDays > 0,
      limitedDays,
      visits: observations.length,
      dailyBudget: {
        requests: budget?.requests ?? 0,
        visits: budget?.visits ?? 0,
        maxRequests: QUALITY_DAILY_REQUESTS,
        maxVisits: QUALITY_DAILY_VISITS,
      },
      metrics: (['LCP', 'CLS', 'INP'] as const).map((name) => {
        const metric = summarizeFieldMetric(
          name,
          observations.flatMap((row) =>
            row.samples.filter((s) => s.name === name).map((s) => s.value)
          ),
          truncated
        );
        return {
          ...metric,
          status:
            limitedDays > 0 && metric.status === 'within-target'
              ? 'collection-limited'
              : metric.status,
        };
      }),
    };
  },
});
/** Keep deletion bounded and active after collection is switched off. No customer records touched. */
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - FIELD_RETENTION_DAYS * DAY;
    const visits = await ctx.db
      .query('qualityVisits')
      .withIndex('by_created', (q) => q.lte('createdAt', cutoff))
      .take(500);
    for (const row of visits) await ctx.db.delete(row._id);
    const budgets = await ctx.db
      .query('qualityBudgets')
      .withIndex('by_day', (q) => q.lt('day', Math.floor(cutoff / DAY)))
      .take(50);
    for (const row of budgets) await ctx.db.delete(row._id);
    return { visits: visits.length, budgets: budgets.length, morePossible: visits.length === 500 };
  },
});
