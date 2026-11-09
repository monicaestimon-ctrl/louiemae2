// Shared catalog helpers (spec S04, S10, S15): suppliers, holds and the single server-side
// sellability gate every publish, cart, estimate, checkout, link and job path calls.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { CommerceError } from '../lib/errors';
import { availabilityAllows, evaluateVariant, type Observation } from '../lib/catFreshness';
import type { FreshnessPolicy } from '../lib/config';
import { maybeConfig } from './sysConfig';
import type { HoldReason } from './v2Validators';
import { stockView } from '../lib/stockEvidence';
import { digest } from './dlvSecurity';

type Ctx = QueryCtx | MutationCtx;

const SUPPLIERS: Record<string, Omit<Doc<'catSuppliers'>, '_id' | '_creationTime' | 'createdAt'>> = {
  zuo: { code: 'zuo', name: 'Zuo', publicAttributionAllowed: false, fulfillmentRoute: 'manual_dealer_zuo', freshnessKey: 'freshness-default' },
  ashcroft: { code: 'ashcroft', name: 'Ashcroft', publicAttributionAllowed: false, fulfillmentRoute: 'manual_dealer_ashcroft', freshnessKey: 'freshness-default' },
  cj: { code: 'cj', name: 'CJ Dropshipping', publicAttributionAllowed: false, fulfillmentRoute: 'cj_auto', freshnessKey: 'freshness-default' },
  owner_managed: { code: 'owner_managed', name: 'Owner managed', publicAttributionAllowed: false, fulfillmentRoute: 'owner_managed', freshnessKey: 'freshness-default' },
};

export async function supplierByCode(ctx: Ctx, code: string) {
  return ctx.db.query('catSuppliers').withIndex('by_code', (q) => q.eq('code', code)).first();
}

export async function ensureSupplier(ctx: MutationCtx, code: string) {
  const existing = await supplierByCode(ctx, code);
  if (existing) return existing;
  const base = SUPPLIERS[code];
  if (!base) throw new CommerceError('INVALID_INPUT', `Unknown supplier ${code}`);
  const id = await ctx.db.insert('catSuppliers', { ...base, createdAt: Date.now() });
  return (await ctx.db.get(id))!;
}

/** Opens a hold once (an open hold with the same reason is reused) and mirrors it on the variant. */
export async function openHold(ctx: MutationCtx, variantId: Id<'catVariants'>, reason: HoldReason, detail: string, by: string) {
  const open = await ctx.db
    .query('catHolds')
    .withIndex('by_variant_open', (q) => q.eq('variantId', variantId).eq('resolvedAt', undefined))
    .collect();
  if (!open.some((h) => h.reason === reason)) await ctx.db.insert('catHolds', { variantId, reason, detail: detail.slice(0, 500), openedAt: Date.now(), openedBy: by });
  const v = await ctx.db.get(variantId);
  if (v && !v.holds.includes(reason)) await ctx.db.patch(variantId, { holds: [...v.holds, reason], updatedAt: Date.now() });
}

export async function resolveHold(ctx: MutationCtx, variantId: Id<'catVariants'>, reason: HoldReason, by: string, resolution: string) {
  const open = await ctx.db
    .query('catHolds')
    .withIndex('by_variant_open', (q) => q.eq('variantId', variantId).eq('resolvedAt', undefined))
    .collect();
  for (const h of open) if (h.reason === reason) await ctx.db.patch(h._id, { resolvedAt: Date.now(), resolvedBy: by, resolution: resolution.slice(0, 500) });
  const v = await ctx.db.get(variantId);
  if (v && v.holds.includes(reason)) await ctx.db.patch(variantId, { holds: v.holds.filter((r) => r !== reason), updatedAt: Date.now() });
}

/** Holds managed by freshness evaluation (others, like MANUAL or METHOD_CHANGED, are only resolved by people). */
export const FRESHNESS_HOLDS: readonly HoldReason[] = ['COST_MISSING', 'COST_STALE', 'COST_CONFLICT', 'COST_IMPLAUSIBLE', 'MAP_MISSING', 'MAP_ZERO', 'CARTON_MISSING', 'STOCK_UNVERIFIED'];

export async function currentCost(ctx: Ctx, v: Doc<'catVariants'>) {
  return v.currentCostRevisionId ? ctx.db.get(v.currentCostRevisionId) : null;
}

async function freshnessPolicy(ctx: Ctx, key: string, simulate = false): Promise<FreshnessPolicy> {
  const cfg = await maybeConfig<FreshnessPolicy>(ctx, 'freshnessPolicy', key);
  if (cfg) return cfg.value;
  if (simulate) return { stockSyncMaxHours: 24, checkoutSourceMaxHours: 24, costMapMaxDays: 7, recheckOnSupplierNotice: true };
  throw new CommerceError('POLICY_NOT_APPROVED', `freshnessPolicy/${key} is not approved (decision D-16)`);
}

/** Re-evaluates a variant's freshness holds and availability from its evidence. */
export async function evaluate(ctx: Ctx, v: Doc<'catVariants'>, now = Date.now(), opts: { simulate?: boolean } = {}) {
  const supplier = await ctx.db.get(v.supplierId);
  const policy = await freshnessPolicy(ctx, supplier?.freshnessKey ?? 'freshness-default', opts.simulate);
  const cost = await currentCost(ctx, v);
  const cartons = await ctx.db.query('catCartons').withIndex('by_variant', (q) => q.eq('variantId', v._id)).collect();
  const observations = (await ctx.db
    .query('catSourceObservations')
    .withIndex('by_variant_field_observed', (q) => q.eq('variantId', v._id))
    .order('desc')
    .take(200)) as unknown as Observation[];
  const result = evaluateVariant({
    cost: cost ? { ...cost, effectiveTo: cost.effectiveTo } : null,
    piecesPerPack: v.piecesPerPack,
    cartons: cartons.length,
    observations,
    policy,
    now,
  });
  // A wholesale number does not make the variant cost-complete. Never publish or
  // generate new referrals by treating an unknown expense as a confirmed zero.
  if (cost && (
    (cost.dutiesMinor === null && !cost.dutiesConfirmedZero) ||
    (cost.inboundFreightMinor === null && !cost.inboundConfirmedZero) ||
    (cost.supplierFeesMinor === null && !cost.feesConfirmedZero)
  ) && !result.holds.includes('COST_MISSING')) result.holds.push('COST_MISSING');
  if (v.currentStockRevisionId) {
    const stock = stockView(await ctx.db.get(v.currentStockRevisionId), v.warehouseId, v.piecesPerPack, now, policy.stockSyncMaxHours * 3600000, v.orderMinimumPacks, await digest(v.warehouseId ? await ctx.db.get(v.warehouseId) : null));
    result.availability = stock.availability;
    result.stockObservedAt = stock.observedAt;
    result.holds = result.holds.filter(h => h !== 'STOCK_UNVERIFIED');
    if (!stock.current || stock.availability === 'unknown') result.holds.push('STOCK_UNVERIFIED');
  }
  return result;
}

/** Persists the evaluation: opens or resolves freshness holds and updates availability. */
export async function refreshVariant(ctx: MutationCtx, variantId: Id<'catVariants'>, by: string, now = Date.now()) {
  const v = await ctx.db.get(variantId);
  if (!v) return null;
  const r = await evaluate(ctx, v, now);
  for (const h of FRESHNESS_HOLDS) {
    if ((r.holds as string[]).includes(h)) await openHold(ctx, v._id, h, 'Freshness evaluation', by);
    else if (v.holds.includes(h)) await resolveHold(ctx, v._id, h, by, 'Evidence current');
  }
  // A discontinued variant never becomes available again without new evidence and review.
  const availability = v.availability === 'discontinued' && r.availability !== 'discontinued' ? 'discontinued' : r.availability;
  if (availability !== v.availability || r.stockObservedAt !== v.availabilityObservedAt)
    await ctx.db.patch(v._id, { availability, ...(r.stockObservedAt ? { availabilityObservedAt: r.stockObservedAt } : {}), updatedAt: now });
  return { ...r, availability };
}

export type SellPurpose = 'publish' | 'purchase' | 'link' | 'estimate';

/**
 * The single sellability gate (v2 §6). Throws a typed error unless the variant has no open
 * holds, current evidence, an allowed availability and (for purchase and links) an approved
 * retail price. Called from every server path; the UI only mirrors it.
 */
export async function assertSellable(ctx: Ctx, variantId: Id<'catVariants'>, purpose: SellPurpose, now = Date.now()) {
  const v = await ctx.db.get(variantId);
  if (!v) throw new CommerceError('STOCK_UNAVAILABLE', 'Variant not found');
  if (v.availability === 'discontinued') throw new CommerceError('STOCK_UNAVAILABLE', 'Discontinued', 'This item has been discontinued.');
  const r = await evaluate(ctx, v, now);
  const holds = new Set<string>([...v.holds, ...r.holds]);
  if (purpose === 'link') {
    if (v.referralEligible !== true) holds.add('COMMISSION_UNQUALIFIED');
  }
  const mapHolds = ['MAP_MISSING', 'MAP_ZERO', 'MAP_POLICY_DERIVED', 'MAP_FLOOR_UNAPPROVED'];
  if ([...holds].some((h) => mapHolds.includes(h))) throw new CommerceError('MAP_POLICY_REVIEW', [...holds].join(','));
  if (holds.has('STOCK_UNVERIFIED') || !availabilityAllows(r.availability, purpose)) throw new CommerceError('STOCK_UNAVAILABLE', `availability ${r.availability}`);
  if (holds.has('COMMISSION_UNQUALIFIED') && purpose === 'link') throw new CommerceError('REFERRAL_INELIGIBLE', 'Not prequalified for the full commission schedule');
  if (holds.has('DELIVERY_UNSUPPORTED') && purpose !== 'link') throw new CommerceError('DELIVERY_QUOTE_REQUIRED', 'Delivery unsupported');
  if (holds.size) throw new CommerceError('COST_REVIEW_REQUIRED', [...holds].join(','));
  if (purpose !== 'publish') {
    const price = v.retailPriceRevisionId ? await ctx.db.get(v.retailPriceRevisionId) : null;
    if (!price || price.status !== 'approved') throw new CommerceError('COST_REVIEW_REQUIRED', 'No approved retail price');
  }
  return v;
}
