// Delivery estimate contract (spec S18, v2 §12). ZIP estimates are non-binding; a full-address
// estimate valid through payment initiation is required for checkout. Any change to cart,
// address, membership, service, quantity, credit, discount or source version invalidates it.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { computeEstimate, cartHash, type LineInput } from './dlvEngine';
import { activeConfig } from './sysConfig';
import { bumpMetric, rateLimit } from './sysCore';
import { viewer } from './holmAccess';
import { requireFlag, flag } from '../lib/flags';
import { available as creditAvailable } from './ldgCredits';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { addressKey } from '../lib/delivery/destination';
import { DELIVERY_TIMING_CAVEAT, QUOTE_CTA, ZIP_ESTIMATE_NOTE } from '../lib/customerCopy';
import type { EstimatePolicy } from '../lib/config';

export const lineArg = v.object({ productId: v.string(), variantId: v.string(), packs: v.number() });
export const addressArg = v.object({ line1: v.string(), line2: v.optional(v.string()), city: v.string(), state: v.string(), postalCode: v.string(), country: v.string() });

/** Whether automatic delivery estimates are on (the storefront hides the estimator otherwise). */
export const enabled = query({ args: {}, handler: () => flag('DELIVERY_AUTOMATION_ENABLED') });

/**
 * Estimates delivery for a cart or a single product. Returns customer-safe fields only; the
 * internal breakdown stays on the stored estimate for admins.
 */
export const estimate = mutation({
  args: {
    lines: v.array(lineArg),
    channel: v.union(v.literal('retail'), v.literal('trade')),
    zip: v.string(),
    address: v.optional(addressArg),
    service: v.optional(v.string()),
    visitorKey: v.string(),
    // Anything a client might send about prices or rates is accepted only to be ignored and logged.
    clientPrices: v.optional(v.any()),
    useCredit: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    requireFlag('DELIVERY_AUTOMATION_ENABLED');
    if (!(await rateLimit(ctx, `estimate:${a.visitorKey.slice(0, 64)}`, 30, 30))) throw new CommerceError('INVALID_INPUT', 'Too many estimates; wait a moment.', 'Please wait a moment and try again.');
    if (a.clientPrices !== undefined) await bumpMetric(ctx, 'security.client_price_ignored');
    const started = Date.now();
    const policy = (await activeConfig<EstimatePolicy>(ctx, 'estimatePolicy', 'estimate-policy')).value;
    const service = a.service ?? 'curbside';
    const destination = { zip: a.zip.trim(), ...(a.address ? { address: a.address } : {}) };
    const me0 = await viewer(ctx);
    const creditMinor = a.useCredit && me0 && flag('CREDIT_V2_ENABLED') ? await creditAvailable(ctx, me0.userId) : 0;
    let out;
    try {
      out = await computeEstimate(ctx, { lines: a.lines as LineInput[], channel: a.channel, destination, service, creditMinor });
    } catch (e) {
      const d = commerceErrorData(e);
      await bumpMetric(ctx, `estimate.error.${d?.code ?? 'unknown'}`);
      throw e;
    }
    const now = Date.now();
    const me = await viewer(ctx);
    const status = out.status;
    const id: Id<'dlvEstimates'> = await ctx.db.insert('dlvEstimates', {
      channel: a.channel,
      destination: { zip: destination.zip, precision: a.address ? 'full' : 'zip', ...(a.address ? { addressHash: addressKey(a.address), state: a.address.state } : {}) },
      service,
      lines: out.lines.map((l) => ({ variantId: l.variant._id, packs: l.packs })),
      groups: out.groups,
      status,
      ...(out.deliveryMinor !== undefined ? { deliveryChargeMinor: out.deliveryMinor } : {}),
      merchandiseMinor: out.merchandiseMinor,
      discountMinor: 0,
      creditMinor: out.creditMinor,
      ...(out.taxMinor !== undefined ? { taxMinor: out.taxMinor } : {}),
      ...(out.deliveryMinor !== undefined ? { totalMinor: out.merchandiseMinor - out.creditMinor + out.deliveryMinor + (out.taxMinor ?? 0) } : {}),
      expiresAt: now + policy.validityMinutes * 60_000,
      cartHash: cartHash(a.lines as LineInput[], a.channel),
      sourceVersionsHash: out.sourceVersionsHash,
      internal: { reasons: out.reasons, configVersions: out.configVersions, lines: out.lines.map((l) => ({ key: l.lineKey, unit: l.unitPackMinor, packs: l.packs, provider: l.provider })) },
      ...(me ? { userId: me.userId } : {}),
      createdAt: now,
    });
    await bumpMetric(ctx, status === 'ok' ? 'estimate.ok' : 'estimate.quote_required', Date.now() - started);
    const splitKnown = new Set(out.groups.map((g) => g.groupKey)).size > 1;
    return {
      estimateId: id,
      status,
      deliveryChargeMinor: out.deliveryMinor ?? null,
      merchandiseMinor: out.merchandiseMinor,
      taxMinor: out.taxMinor ?? null,
      creditMinor: out.creditMinor,
      totalMinor: out.deliveryMinor !== undefined && out.taxMinor !== undefined ? out.merchandiseMinor - out.creditMinor + out.deliveryMinor + out.taxMinor : null,
      serviceName: 'Curbside delivery',
      timingCaveat: DELIVERY_TIMING_CAVEAT,
      note: a.address ? null : ZIP_ESTIMATE_NOTE,
      expiresAt: now + policy.validityMinutes * 60_000,
      splitKnown,
      // Customer-safe reasons only: no supplier names, costs or margins.
      reasons: status === 'ok' ? [] : [QUOTE_CTA],
      shipmentGroups: out.groups.map((g, i) => ({ label: `Shipment ${i + 1}`, items: out.lines.filter((l) => (g.groupKey === 'ashcroft' ? l.provider === 'ashcroft' : l.provider === 'zuo' && g.groupKey.startsWith(l.supplierCode))).map((l) => ({ name: l.name, packs: l.packs })) })),
    };
  },
});

/** A stored estimate in customer-safe form (for the checkout review screen). */
export const get = query({
  args: { estimateId: v.id('dlvEstimates') },
  handler: async (ctx, a) => {
    const e = await ctx.db.get(a.estimateId);
    if (!e) return null;
    return { status: e.status, deliveryChargeMinor: e.deliveryChargeMinor ?? null, merchandiseMinor: e.merchandiseMinor, taxMinor: e.taxMinor ?? null, totalMinor: e.totalMinor ?? null, expiresAt: e.expiresAt, expired: e.expiresAt <= Date.now(), precision: e.destination.precision };
  },
});
