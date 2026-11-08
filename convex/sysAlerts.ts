// Monitoring and alerts (spec S39, v2 §25). Every 5 minutes: duplicate financial events, a
// webhook backlog older than 15 minutes, payout reconciliation exceptions, a missed daily tier
// job and any negative modeled contribution on a published variant open an alert (deduplicated)
// and email the operations inbox. The admin health screen reads the same checks.
import { internalMutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { maybeConfig } from './sysConfig';
import { openReview } from './sysCore';
import { notify } from './sysNotify';
import { flagStates, payoutRoute } from '../lib/flags';
import { deliveryAlerts } from './dlvTelemetry';
import { localParts } from '../lib/tiers';
import type { TierPolicy } from '../lib/config';

type Ctx = QueryCtx | MutationCtx;
export type Alert = { key: string; title: string; detail: string };

async function sumMetric(ctx: Ctx, name: string, hours: number) {
  const now = Date.now();
  let total = 0;
  for (let h = 0; h < hours; h++) {
    const bucket = new Date(now - h * 3_600_000).toISOString().slice(0, 13);
    const row = await ctx.db.query('sysMetrics').withIndex('by_name_bucket', (q) => q.eq('name', name).eq('bucket', bucket)).first();
    total += row?.count ?? 0;
  }
  return total;
}

export async function evaluateAlerts(ctx: Ctx, now = Date.now()): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const oldest = await ctx.db.query('sysPaymentEvents').withIndex('by_status_received', (q) => q.eq('status', 'received')).first();
  if (oldest && now - oldest.receivedAt > 15 * 60_000) alerts.push({ key: 'webhook_backlog', title: 'Payment event backlog over 15 minutes', detail: `Oldest unprocessed event received ${new Date(oldest.receivedAt).toISOString()}` });
  const dup = await sumMetric(ctx, 'ledger.duplicate_event', 1);
  if (dup > 0) alerts.push({ key: `duplicate_financial_${new Date(now).toISOString().slice(0, 13)}`, title: 'Duplicate financial event received', detail: `${dup} duplicate ledger events this hour (absorbed by idempotency; check the source).` });
  for (const kind of ['payout_uncertain', 'payout_failed', 'payout_aborted', 'transfer_reversed', 'bank_payout_failed']) {
    const open = await ctx.db.query('sysReviewItems').withIndex('by_kind_status', (q) => q.eq('kind', kind).eq('status', 'open')).take(50);
    if (open.length) alerts.push({ key: `${kind}_open`, title: `Payout exception: ${kind.replace(/_/g, ' ')}`, detail: `${open.length} open` });
  }
  if (payoutRoute() === 'conflict') alerts.push({ key: 'payout_route_conflict', title: 'Both payout routes are switched on', detail: 'Turn off PARTNER_PAYOUTS_ENABLED or PAYOUT_EXECUTION_ENABLED; neither will run until one is off.' });
  const tierPolicy = await maybeConfig<TierPolicy>(ctx, 'tierPolicy', 'tier-policy');
  if (tierPolicy) {
    const yesterday = localParts(now - 86_400_000, tierPolicy.value.tz).date;
    const ran = await ctx.db.query('prgTierSnapshots').withIndex('by_reason_date', (q) => q.eq('reason', 'daily').eq('localDate', yesterday)).first();
    const anyBeneficiary = await ctx.db.query('prgBeneficiaries').withIndex('by_status', (q) => q.eq('status', 'active')).first();
    if (anyBeneficiary && !ran) alerts.push({ key: `tier_job_missed_${yesterday}`, title: 'Daily tier job did not run', detail: `No daily tier snapshot for ${yesterday}` });
  }
  const published = await ctx.db.query('catProductMeta').withIndex('by_stage', (q) => q.eq('stage', 'published')).take(300);
  for (const m of published) {
    for (const cv of await ctx.db.query('catVariants').withIndex('by_product', (q) => q.eq('productId', m.productId)).collect()) {
      const s = await ctx.db.query('catScenarioResults').withIndex('by_variant_computed', (q) => q.eq('variantId', cv._id)).order('desc').first();
      const direct = s?.scenarios.find((x) => x.name === 'retail_direct');
      if (direct && direct.contributionMinor < 0) alerts.push({ key: `negative_contribution_${cv._id}`, title: 'Negative contribution on a published variant', detail: `${m.louieMaeName} (${cv.supplierSku}) contributes ${direct.contributionMinor} cents at its current price` });
    }
  }
  const openExceptions = await ctx.db.query('ordPaidExceptions').withIndex('by_status', (q) => q.eq('status', 'open')).take(50);
  if (openExceptions.length) alerts.push({ key: 'paid_exceptions_open', title: 'Paid orders need resolution', detail: `${openExceptions.length} paid-order exception(s) open` });
  alerts.push(...await deliveryAlerts(ctx));
  return alerts;
}

export const check = internalMutation({
  args: {},
  handler: async (ctx) => {
    const alerts = await evaluateAlerts(ctx);
    for (const a of alerts) {
      const existing = await ctx.db.query('sysReviewItems').withIndex('by_entity', (q) => q.eq('entityTable', 'alert').eq('entityId', a.key)).first();
      if (existing?.status === 'open') continue;
      await openReview(ctx, 'alert', 'alert', a.key, `${a.title}: ${a.detail}`);
      await notify(ctx, { dedupeKey: `alert:${a.key}:${new Date().toISOString().slice(0, 10)}`, audience: 'admin', template: 'alert', to: 'owner', subject: `Louie Mae alert: ${a.title}`, text: a.detail });
    }
    return alerts.length;
  },
});

/** Health screen: flags, alerts, and the operational metrics of the last 24 hours. */
export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const metrics: Record<string, number> = {};
    for (const name of ['estimate.request.ok', 'estimate.request.quote', 'estimate.request.blocked', 'estimate.request.error', 'estimate.request.tax_error', 'estimate.request.tax_unavailable', 'checkout.price_changed', 'payment.order_created', 'payment.exception', 'commission.accrued', 'credit.award_pending', 'attribution.click', 'attribution.click_ineligible', 'attribution.self_referral_blocked', 'security.client_price_ignored', 'payout.aborted', 'payout.bank_failed', 'ledger.duplicate_event'])
      metrics[name] = await sumMetric(ctx, name, 24);
    const notifications = await ctx.db.query('sysNotifications').withIndex('by_status_next', (q) => q.eq('status', 'failed')).take(100);
    return { flags: flagStates(), payoutRoute: payoutRoute(), alerts: await evaluateAlerts(ctx), metrics, failedNotifications: notifications.length };
  },
});
