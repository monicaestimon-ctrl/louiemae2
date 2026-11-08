import type { MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { resolveLines, type EstimateOutcome } from './dlvEngine';
import { checkQuoteLines } from './ordQuotes';
import { activeConfig } from './sysConfig';
import type { PricingAssumptions } from '../lib/config';
import { evaluateGroup, type EngineGroup } from '../lib/delivery/engine';
import { allocate } from '../lib/money';
import { digest } from './dlvSecurity';
import { CommerceError } from '../lib/errors';
import { DELIVERY_TERMS_VERSION } from '../lib/delivery/service';

/** Manual freight bypasses only automatic lane/rate coverage, never product or contribution gates. */
export async function computeManualQuote(
  ctx: MutationCtx,
  q: Doc<'ordQuoteVersions'>
): Promise<EstimateOutcome> {
  if (q.status !== 'accepted' && q.status !== 'sent' && q.status !== 'draft')
    throw new CommerceError('QUOTE_EXPIRED');
  if (q.expiresAt <= Date.now() || !q.address) throw new CommerceError('QUOTE_EXPIRED');
  if (!q.address.recipientName?.trim() || q.address.recipientName.length > 150 || !q.address.access)
    throw new CommerceError(
      'INVALID_INPUT',
      'Confirm recipient and delivery access before sending a payable quote'
    );
  const project = await ctx.db.get(q.projectId);
  if (!project) throw new CommerceError('INVALID_INPUT');
  const checks = await checkQuoteLines(ctx, q.lines, project.channel);
  if (!checks.map || !checks.margin || !checks.policy)
    throw new CommerceError('COST_REVIEW_REQUIRED');
  if (!/^\+?[0-9 ()-]{10,25}$/.test(q.address.phone ?? ''))
    throw new CommerceError('INVALID_INPUT', 'Confirmed delivery contact phone is required');
  if (!q.taxEvidence?.trim())
    throw new CommerceError(
      'COST_REVIEW_REQUIRED',
      'Verified address-specific tax evidence is required, including a confirmed zero'
    );
  if (!q.freight?.length || q.fixedPaymentMinor === undefined)
    throw new CommerceError(
      'COST_REVIEW_REQUIRED',
      'Confirmed freight and payment expense required for quote checkout'
    );
  const channel = project.channel === 'retail' ? 'retail' : 'trade';
  const lines = await resolveLines(ctx, q.lines, channel, Date.now(), false, 100);
  const cfg = await activeConfig<PricingAssumptions>(
    ctx,
    'pricingAssumptions',
    'zuo-pricing-assumptions'
  );
  for (const [i, l] of lines.entries()) {
    if (!l.engine)
      throw new CommerceError(
        'COST_REVIEW_REQUIRED',
        'This supplier needs a complete delivery cost record before quote checkout'
      );
    const quoted = q.lines[i];
    if (quoted.discountMinor % quoted.packs !== 0)
      throw new CommerceError('INVALID_INPUT', 'Pack discount must allocate to exact cents');
    const originalNet = l.engine.netMinor;
    l.unitPackMinor = quoted.unitPackMinor - quoted.discountMinor / quoted.packs;
    l.engine.netMinor = l.unitPackMinor * l.packs;
    l.engine.commissionMinor = Math.ceil(
      (l.engine.commissionMinor * l.engine.netMinor) / originalNet
    );
  }
  const merchandiseMinor = lines.reduce((n, l) => n + l.unitPackMinor * l.packs, 0);
  if (
    !Number.isSafeInteger(merchandiseMinor + q.deliveryMinor + q.taxMinor) ||
    merchandiseMinor + q.deliveryMinor + q.taxMinor > 1000000000
  )
    throw new CommerceError('INVALID_INPUT', 'Quote total exceeds supported payment limits');
  const fixed = allocate(
      q.fixedPaymentMinor,
      lines.map((l) => l.engine!.netMinor)
    ),
    tax = allocate(
      q.taxMinor,
      lines.map((l) => l.engine!.netMinor)
    );
  const grouped = new Map<string, typeof lines>();
  lines.forEach((l, i) => {
    l.engine!.otherMinor += fixed[i];
    const k = `${l.supplierCode}:${l.originZip}`;
    grouped.set(k, [...(grouped.get(k) ?? []), l]);
  });
  if (grouped.size !== q.freight.length)
    throw new CommerceError(
      'COST_REVIEW_REQUIRED',
      'Freight evidence must cover every shipment group once'
    );
  const groups: EstimateOutcome['groups'] = [];
  let requirement = 0;
  for (const [key, ls] of grouped) {
    const f = q.freight.find((x) => `${x.supplierCode}:${x.originZip}` === key);
    if (!f) throw new CommerceError('COST_REVIEW_REQUIRED', 'Missing shipment freight evidence');
    const input: EngineGroup = {
      key,
      supplierOrderFeeMinor: f.supplierFeeMinor,
      freightMinor: f.freightMinor,
      quoteReasons: [],
      lines: ls.map((l) => ({ key: l.lineKey, ...l.engine! })),
    };
    const result = evaluateGroup(
      input,
      { ...cfg.value, deliveryProcessingBps: cfg.value.processingBps },
      ls.map((l) => tax[lines.indexOf(l)])
    );
    if (result.quoteRequired || result.requirementMinor === null)
      throw new CommerceError(
        'COST_REVIEW_REQUIRED',
        'Quote does not support its contribution floor'
      );
    requirement += result.requirementMinor;
    groups.push({
      groupKey: `${key}:${q.service}`,
      supplierCode: f.supplierCode,
      rule: 'manual-confirmed',
      classification: 'manual',
      freightMinor: f.freightMinor,
      subsidyMinor: result.subsidyMinor,
      requirementMinor: result.requirementMinor,
      quoteRequired: false,
      reasons: [],
    });
  }
  if (requirement > q.deliveryMinor)
    throw new CommerceError(
      'COST_REVIEW_REQUIRED',
      'Quoted delivery and merchandise allowance do not cover confirmed freight'
    );
  const surplus = allocate(
    q.deliveryMinor - requirement,
    groups.map((g) => Math.max(1, g.requirementMinor))
  );
  groups.forEach((g, i) => {
    g.chargeMinor = g.requirementMinor + surplus[i];
  });
  return {
    serviceTerms: {
      version: DELIVERY_TERMS_VERSION,
      label: q.service === 'curbside' ? 'Quoted standard delivery' : q.service.replaceAll('_', ' '),
      details: [q.terms],
    },
    status: 'ok',
    lines,
    merchandiseMinor,
    creditMinor: 0,
    deliveryMinor: q.deliveryMinor,
    taxMinor: q.taxMinor,
    groups,
    reasons: [],
    sourceVersionsHash: await digest({
      quoteId: q._id,
      terms: q.terms,
      deliveryTermsVersion: DELIVERY_TERMS_VERSION,
      quote: q.lines,
      address: q.address,
      freight: q.freight,
      tax: q.taxMinor,
      delivery: q.deliveryMinor,
      service: q.service,
      lines,
      config: cfg,
    }),
    configVersions: { 'zuo-pricing-assumptions': cfg.version },
  };
}
