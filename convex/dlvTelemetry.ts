import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { bumpMetric } from './sysCore';
import { maybeConfig } from './sysConfig';
import { requireDeliveryRole } from './dlvAccess';
import type { DeliveryMonitoringPolicy } from '../lib/config';
import { summarizeObservations } from '../lib/delivery/monitoring';

/** Written in a separate transaction after the action, including when estimate work failed.
 * No address, guest token, email, customer identifier or supplier price is accepted here. */
export const record = internalMutation({
  args: {
    durationMs: v.number(),
    channel: v.union(v.literal('retail'), v.literal('trade')),
    path: v.union(v.literal('matrix'), v.literal('matrix_tax')),
    outcome: v.union(
      v.literal('ok'),
      v.literal('quote'),
      v.literal('blocked'),
      v.literal('error'),
      v.literal('tax_error'),
      v.literal('tax_unavailable')
    ),
    code: v.optional(v.string()),
    requestId: v.optional(v.string()),
    estimateId: v.optional(v.id('dlvEstimates')),
  },
  handler: async (ctx, a) => {
    const estimate = a.estimateId ? await ctx.db.get(a.estimateId) : null;
    const version = estimate?.internal?.configVersions?.['zuo-freight'];
    const rate =
      version === undefined
        ? null
        : await ctx.db
            .query('sysConfig')
            .withIndex('by_kind_key_version', (q) =>
              q.eq('kind', 'carrierRule').eq('key', 'zuo-freight').eq('version', version)
            )
            .first();
    const zone =
      (rate?.value as { zip3Zones?: Record<string, string> } | undefined)?.zip3Zones?.[
        estimate?.destination.zip.slice(0, 3) ?? ''
      ] ?? 'unmapped';
    const scopes = (estimate?.groups ?? []).map((g) => ({
      supplier: g.supplierCode,
      origin: g.groupKey.split(':')[1] ?? 'unknown',
      zone: g.supplierCode === 'zuo' ? zone : 'supplier_standard',
      mode: g.classification,
      service: estimate!.service,
    }));
    await bumpMetric(ctx, `estimate.request.${a.outcome}`, a.durationMs);
    await ctx.db.insert('dlvObservations', {
      createdAt: Date.now(),
      durationMs: Math.max(0, Math.min(600000, Math.round(a.durationMs))),
      channel: a.channel,
      path: a.path,
      outcome: a.outcome,
      ...(a.code ? { code: a.code.slice(0, 80) } : {}),
      ...(/^[a-f0-9]{24}$/.test(a.requestId ?? '') ? { requestId: a.requestId } : {}),
      scopes,
    });
  },
});

type Ctx = QueryCtx | MutationCtx;
export async function monitoringReport(ctx: Ctx, now = Date.now()) {
  const policy = await maybeConfig<DeliveryMonitoringPolicy>(
    ctx,
    'deliveryMonitoringPolicy',
    'delivery-monitoring'
  );
  const rows = await ctx.db
    .query('dlvObservations')
    .withIndex('by_created', (q) => q.gte('createdAt', now - 15 * 60000))
    .order('desc')
    .take(5001);
  const truncated = rows.length > 5000;
  const sample = rows.slice(0, 5000);
  const breakdown = new Map<string, typeof sample>();
  let breakdownTruncated = false;
  for (const row of sample)
    for (const scope of new Set(row.scopes.map((s) => JSON.stringify(s)))) {
      if (!breakdown.has(scope) && breakdown.size >= 200) {
        breakdownTruncated = true;
        continue;
      }
      breakdown.set(scope, [...(breakdown.get(scope) ?? []), row]);
    }
  const overdue: {
    status: string;
    count: number;
    capped: boolean;
    oldestUpdatedAt: number | null;
  }[] = [];
  if (policy)
    for (const status of ['requested', 'sourcing', 'ready_for_review'] as const) {
      const requests = await ctx.db
        .query('dlvQuoteRequests')
        .withIndex('by_status_updated', (q) =>
          q.eq('status', status).lt('updatedAt', now - policy.value.quoteSlaHours * 3600000)
        )
        .take(101);
      overdue.push({
        status,
        count: Math.min(100, requests.length),
        capped: requests.length > 100,
        oldestUpdatedAt: requests[0]?.updatedAt ?? null,
      });
    }
  return {
    checkedAt: now,
    windowMinutes: 15,
    truncated,
    breakdownTruncated,
    latestSampleAt: sample[0]?.createdAt ?? null,
    summary: summarizeObservations(sample),
    blocks: [...new Set(sample.filter((r) => r.code).map((r) => r.code!))].map((code) => ({
      code,
      count: sample.filter((r) => r.code === code).length,
    })),
    paths: (['matrix', 'matrix_tax'] as const).map((path) => ({
      path,
      ...summarizeObservations(sample.filter((r) => r.path === path)),
    })),
    breakdown: [...breakdown].map(([scope, observations]) => ({
      ...(JSON.parse(scope) as {
        supplier: string;
        origin: string;
        zone: string;
        mode: string;
        service: string;
      }),
      ...summarizeObservations(observations),
    })),
    policy: policy?.value ?? null,
    policyVersion: policy?.version ?? null,
    alertsEnabled: !!policy && process.env.BACKGROUND_MONITORING_ENABLED === 'true',
    overdue,
    note: 'Observed storefront action requests only; one record per request, excluding internal tax iterations. Legacy direct mutation calls and admin simulations are excluded. No live carrier adapter or estimate cache is active. Matrix-tax latency includes tax-provider work. Missing samples do not prove health. Multi-supplier requests appear in each matching breakdown; do not add breakdown counts.',
  };
}
export const report = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'finance');
    return monitoringReport(ctx);
  },
});

export async function deliveryAlerts(ctx: Ctx) {
  if (process.env.BACKGROUND_MONITORING_ENABLED !== 'true') return [];
  const report = await monitoringReport(ctx);
  const alerts: { key: string; title: string; detail: string }[] = [];
  if (!report.alertsEnabled || !report.policy) return alerts;
  const p = report.policy;
  const denied = report.blocks
    .filter((b) => b.code === 'FORBIDDEN' || b.code === 'TRADE_APPROVAL_REQUIRED')
    .reduce((n, b) => n + b.count, 0);
  if (denied >= p.authorizationFailures)
    alerts.push({
      key: 'delivery_authorization_spike',
      title: 'Delivery authorization failures above target',
      detail: `${denied} denied estimate requests in 15 minutes. Review access configuration and abuse controls; no customer identity is stored in observations.`,
    });
  if (report.truncated)
    alerts.push({
      key: 'delivery_monitor_sample_cap',
      title: 'Delivery monitoring window exceeded sample cap',
      detail:
        'More than 5,000 observations in 15 minutes. Dashboard is a bounded sample; review volume and monitoring capacity.',
    });
  for (const path of report.paths) {
    if (path.attempts < p.minimumAttempts) continue;
    if ((path.errorRateBps ?? 0) > p.errorRateBps)
      alerts.push({
        key: `delivery_errors_${path.path}`,
        title: 'Delivery estimate operational errors above target',
        detail: `${path.path}: ${path.errors}/${path.attempts} failed in the rolling 15-minute sample. Expected quote-only requests are not errors.`,
      });
    const target = path.path === 'matrix' ? p.matrixP95Ms : p.taxP95Ms;
    if ((path.p95Ms ?? 0) > target)
      alerts.push({
        key: `delivery_latency_${path.path}`,
        title: 'Delivery estimate latency above target',
        detail: `${path.path}: p95 ${path.p95Ms} ms, target ${target} ms; ${path.attempts} requests over 15 minutes.`,
      });
  }
  for (const row of report.overdue)
    if (row.count)
      alerts.push({
        key: `delivery_quote_sla_${row.status}`,
        title: 'Delivery requests need staff follow-up',
        detail: `${row.count}${row.capped ? '+' : ''} ${row.status} requests exceed ${p.quoteSlaHours} elapsed hours since last update. Requests awaiting customer information are excluded.`,
      });
  for (const kind of ['negative_actual_contribution', 'actual_contribution_below_floor']) {
    const rows = await ctx.db
      .query('sysReviewItems')
      .withIndex('by_kind_status', (q) => q.eq('kind', kind).eq('status', 'open'))
      .take(101);
    if (rows.length)
      alerts.push({
        key: `delivery_${kind}`,
        title: 'Actual delivery economics need review',
        detail: `${Math.min(100, rows.length)}${rows.length > 100 ? '+' : ''} open cost reviews. Do not recharge the customer; review rates and future pricing.`,
      });
  }
  return alerts;
}

/** Only operational observations are deleted. Orders, invoices and audit history are untouched. */
export const purge = internalMutation({
  args: { remainingBatches: v.optional(v.number()) },
  handler: async (ctx, a): Promise<number> => {
    const remaining = a.remainingBatches ?? 99;
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > 99) return 0;
    const policy = await maybeConfig<DeliveryMonitoringPolicy>(
      ctx,
      'deliveryMonitoringPolicy',
      'delivery-monitoring'
    );
    const days = policy?.value.retentionDays ?? 7;
    const rows = await ctx.db
      .query('dlvObservations')
      .withIndex('by_created', (q) => q.lt('createdAt', Date.now() - days * 86400000))
      .take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 500 && remaining > 0)
      await ctx.scheduler.runAfter(1000, internal.dlvTelemetry.purge, {
        remainingBatches: remaining - 1,
      });
    return rows.length;
  },
});
