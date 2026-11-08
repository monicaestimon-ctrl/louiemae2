// Server-owned delivery service (spec S17, S18, v2 §9–§12). One engine serves product, cart,
// checkout and trade estimates. The server reloads prices, membership, stock and source versions;
// client-supplied prices, roles, allowances and rates are never used.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { activeConfig, maybeConfig } from './sysConfig';
import { assertSellable, ensureSupplier } from './catCore';
import { viewer, isVerified } from './holmAccess';
import { CommerceError } from '../lib/errors';
import { estimateCart, flatRateTax, type EngineGroup, type EngineLine, type EngineRates, type TaxEstimator } from '../lib/delivery/engine';
import { classify, type CarrierRule } from '../lib/shipping/classify';
import { quoteOnlyReasons, zipRegion, type AddressIn } from '../lib/delivery/destination';
import { launchPrice, retailDelivery, supplierAvailable } from '../lib/retailLaunch';
import { FULL_SCHEDULE_BPS } from '../lib/economics/pricing';
import { checkPackQuantity, physicalUnits } from '../lib/catUnits';
import type { DeliveryLadder, MarginPolicy, PricingAssumptions } from '../lib/config';
import { stableStringify } from '../lib/zuoImport';

type Ctx = QueryCtx | MutationCtx;
export type LineInput = { productId: string; variantId: string; packs: number };
export type Destination = { zip: string; address?: AddressIn };

/** The carrier/zone pricing record (sysConfig kind carrierRule). Rates come from carrier evidence. */
export type FreightConfig = {
  rule: CarrierRule;
  originZip: string;
  zip3Zones: Record<string, string>;
  groundPerKgMinorByZone: Record<string, number>;
  groundMinimumMinor: number;
  ltlPerKgMinorByZone: Record<string, number>;
  ltlMinimumMinor: number;
  residentialMinor: number;
  liftgateMinor: number;
  uncertaintyBps: number;
  /** Conservative combined sales-tax rate per state (bps) until an authorized tax provider is wired. */
  taxBpsByState?: Record<string, number>;
  defaultTaxBps?: number;
};

export type ResolvedLine = {
  lineKey: string;
  productId: Id<'commerceProducts'>;
  variant: Doc<'catVariants'>;
  provider: 'zuo' | 'ashcroft';
  name: string;
  packs: number;
  pieces: number;
  unitPackMinor: number;
  category: 'furniture' | 'decor' | 'clothing';
  supplierCode: string;
  costRevisionId?: Id<'catCostRevisions'>;
  priceRevisionId?: Id<'catPriceRevisions'>;
  /** Ashcroft's existing per-item delivery (cents) for this line; 0 for ladder-priced lines. */
  fixedDeliveryMinor: number;
  engine?: Omit<EngineLine, 'key'>;
  cartons: Doc<'catCartons'>[];
  originZip: string;
};

/**
 * Ashcroft lines keep their approved per-item rules (v2 §1). They get a mirror catVariant so
 * orders reference one variant id, but no Zuo freshness or pricing assumption touches them.
 */
async function ashcroftMirror(ctx: MutationCtx, product: Doc<'commerceProducts'>, variantId: string, sku: string, name: string) {
  const supplier = await ensureSupplier(ctx, 'ashcroft');
  const existing = await ctx.db
    .query('catVariants')
    .withIndex('by_identity', (q) => q.eq('supplierId', supplier._id).eq('supplierSku', sku).eq('packId', '1'))
    .first();
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert('catVariants', {
    productId: product._id,
    supplierId: supplier._id,
    supplierSku: sku,
    packId: '1',
    optionKey: variantId,
    supplierVariantName: name,
    louieMaeVariantName: name,
    piecesPerPack: 1,
    orderMinimumPacks: 1,
    orderIncrementPacks: 1,
    availability: 'in_stock',
    fulfillmentRoute: 'manual_dealer_ashcroft',
    holds: [],
    legacyVariantId: variantId,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

async function categoryOf(ctx: Ctx, productId: Id<'commerceProducts'>, fallback: 'furniture' | 'decor' | 'clothing' = 'furniture') {
  const meta = await ctx.db.query('catProductMeta').withIndex('by_product', (q) => q.eq('productId', productId)).first();
  if (!meta) return fallback;
  if (meta.commissionCategory === 'review_required') throw new CommerceError('COST_REVIEW_REQUIRED', 'Category under review');
  return meta.commissionCategory;
}

/** Resolves and validates every cart line from server data. */
export async function resolveLines(ctx: MutationCtx, lines: readonly LineInput[], channel: 'retail' | 'trade', now = Date.now()) {
  if (!lines.length || lines.length > 30) throw new CommerceError('INVALID_INPUT', 'Choose between 1 and 30 items.');
  const seen = new Set<string>();
  const out: ResolvedLine[] = [];
  let assumptions: PricingAssumptions | null = null;
  for (const [i, l] of lines.entries()) {
    const key = `${l.productId}:${l.variantId}`;
    if (seen.has(key)) throw new CommerceError('INVALID_INPUT', 'Combine duplicate cart items.');
    seen.add(key);
    const pid = ctx.db.normalizeId('commerceProducts', l.productId);
    const product = pid ? await ctx.db.get(pid) : null;
    if (!product) throw new CommerceError('STOCK_UNAVAILABLE', 'Product not found', 'This item is no longer available.');
    const listing = await ctx.db
      .query('commerceListings')
      .withIndex('by_product_channel', (q) => q.eq('productId', product._id).eq('channel', channel === 'retail' ? 'retail' : 'house'))
      .unique();
    if (!listing?.published) throw new CommerceError('STOCK_UNAVAILABLE', 'Not published', 'This item is no longer available.');
    const option = listing.snapshot.variants.find((x) => x.id === l.variantId);
    if (!option) throw new CommerceError('STOCK_UNAVAILABLE', 'Variant not listed', 'This item is no longer available.');
    if (product.provider === 'zuo') {
      const vid = ctx.db.normalizeId('catVariants', l.variantId);
      const cv = vid ? await assertSellable(ctx, vid, 'purchase', now) : null;
      if (!cv || cv.productId !== product._id) throw new CommerceError('STOCK_UNAVAILABLE', 'Variant mismatch');
      checkPackQuantity(cv, l.packs);
      const priceId = channel === 'retail' ? cv.retailPriceRevisionId : cv.tradePriceRevisionId;
      const price = priceId ? await ctx.db.get(priceId) : null;
      if (price?.status !== 'approved') throw new CommerceError('COST_REVIEW_REQUIRED', `No approved ${channel} price`);
      // The listing must still show the approved price (a changed price needs republishing).
      if (option.price !== price.packPriceMinor) throw new CommerceError('PRICE_CHANGED', 'Listing price differs from the approved price');
      const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
      if (!cost || cost.wholesaleMinor === null) throw new CommerceError('COST_REVIEW_REQUIRED', 'Cost missing');
      assumptions ??= (await activeConfig<PricingAssumptions>(ctx, 'pricingAssumptions', 'zuo-pricing-assumptions')).value;
      const margin = cv.marginPolicyKey ? await maybeConfig<MarginPolicy>(ctx, 'marginPolicy', cv.marginPolicyKey) : null;
      const pieces = physicalUnits(cv, l.packs);
      const extras = (cost.dutiesMinor ?? 0) + (cost.inboundFreightMinor ?? 0) + (cost.supplierFeesMinor ?? 0);
      const extrasKnown = (cost.dutiesMinor !== null || cost.dutiesConfirmedZero) && (cost.inboundFreightMinor !== null || cost.inboundConfirmedZero) && (cost.supplierFeesMinor !== null || cost.feesConfirmedZero);
      const category = await categoryOf(ctx, product._id);
      const netMinor = price.packPriceMinor * l.packs;
      const supplier = await ctx.db.get(cv.supplierId);
      const warehouse = cv.warehouseId ? await ctx.db.get(cv.warehouseId) : null;
      out.push({
        lineKey: `${i}:${product._id}:${cv._id}`,
        productId: product._id,
        variant: cv,
        provider: 'zuo',
        name: cv.louieMaeVariantName === 'Default' ? listing.snapshot.name : `${listing.snapshot.name} — ${cv.louieMaeVariantName}`,
        packs: l.packs,
        pieces,
        unitPackMinor: price.packPriceMinor,
        category,
        supplierCode: supplier?.code ?? 'zuo',
        costRevisionId: cost._id,
        priceRevisionId: price._id,
        fixedDeliveryMinor: 0,
        cartons: await ctx.db.query('catCartons').withIndex('by_variant', (q) => q.eq('variantId', cv._id)).collect(),
        originZip: warehouse?.originZip ?? '95206',
        engine: {
          netMinor,
          // Landed merchandise cost incl. supplier payment cost; unknown extras block via margin.
          costMinor: Math.ceil((cost.wholesaleMinor * pieces * (10_000 + assumptions.supplierPaymentReserveBps)) / 10_000) + extras * l.packs,
          physicalUnits: pieces,
          allowancePerUnitMinor: cv.sizeClass && cv.sizeClass !== 'UNKNOWN' ? assumptions.allowanceBySize[cv.sizeClass] : null,
          marginBps: extrasKnown && margin && !margin.value.blocksAutomaticSale && margin.value.targetBps !== undefined ? margin.value.targetBps : null,
          // Reserve the maximum published eligible commission so following a link never raises delivery.
          commissionMinor: channel === 'retail' ? Math.ceil((netMinor * FULL_SCHEDULE_BPS[category]) / 10_000) : 0,
          otherMinor: 0,
        },
      });
    } else if (product.provider === 'ashcroft') {
      if (channel !== 'retail') throw new CommerceError('TRADE_APPROVAL_REQUIRED', 'Ashcroft trade orders use House quotes');
      const supplierRow = listing.fulfillment?.find((x) => x.id === l.variantId);
      const rate = retailDelivery(listing.snapshot.category, listing.snapshot.name);
      if (!supplierRow?.sku || !rate || !supplierAvailable(supplierRow.sku, listing.snapshot.description)) throw new CommerceError('STOCK_UNAVAILABLE', 'Ashcroft item unavailable', 'This item is no longer available.');
      if (!Number.isInteger(l.packs) || l.packs < 1 || l.packs > 20) throw new CommerceError('INVALID_INPUT', 'Please contact us for orders above 20 units.');
      const name = option.name === 'Default Title' ? listing.snapshot.name : `${listing.snapshot.name} — ${option.name}`;
      const cv = await ashcroftMirror(ctx, product, l.variantId, supplierRow.sku, name);
      out.push({
        lineKey: `${i}:${product._id}:${cv._id}`,
        productId: product._id,
        variant: cv,
        provider: 'ashcroft',
        name,
        packs: l.packs,
        pieces: l.packs,
        unitPackMinor: launchPrice(option.price, rate.freight, rate.delivery),
        category: await categoryOf(ctx, product._id),
        supplierCode: 'ashcroft',
        fixedDeliveryMinor: rate.delivery * l.packs,
        cartons: [],
        originZip: '',
      });
    } else throw new CommerceError('STOCK_UNAVAILABLE', `${product.provider} items use their existing checkout`, 'This item is Coming Soon.');
  }
  if (channel === 'trade') {
    const me = await viewer(ctx);
    if (!me || !isVerified(me.profile)) throw new CommerceError('TRADE_APPROVAL_REQUIRED');
  }
  return out;
}

const KG = 1000;

/** Freight for one Zuo shipment group from the approved carrier/zone record, or null (quote). */
export function groupFreight(lines: readonly ResolvedLine[], dest: Destination, f: FreightConfig, reasons: string[]): number | null {
  const cartons = lines.flatMap((l) => {
    const list = [];
    for (let p = 0; p < l.packs; p++) for (const c of l.cartons) for (let k = 0; k < c.cartonsPerPack; k++) list.push(c);
    return list;
  });
  const c = classify(cartons, f.rule, { quoteOnly: quoteOnlyReasons(dest.zip, dest.address).length > 0 });
  reasons.push(...c.reasons);
  if (c.mode === 'quote') return null;
  const zone = f.zip3Zones[dest.zip.slice(0, 3)];
  if (!zone) {
    reasons.push('No approved freight zone for this ZIP yet');
    return null;
  }
  const perKg = c.mode === 'ground' ? f.groundPerKgMinorByZone[zone] : f.ltlPerKgMinorByZone[zone];
  if (perKg === undefined) {
    reasons.push(`No ${c.mode} rate for zone ${zone}`);
    return null;
  }
  const raw = Math.max(c.mode === 'ground' ? f.groundMinimumMinor : f.ltlMinimumMinor, Math.ceil((c.billableG * perKg) / KG));
  const accessorials = c.mode === 'ltl' ? f.residentialMinor + f.liftgateMinor : 0;
  return raw + accessorials + Math.ceil(((raw + accessorials) * f.uncertaintyBps) / 10_000);
}

export type EstimateOutcome = {
  status: 'ok' | 'quote_required' | 'unsupported';
  lines: ResolvedLine[];
  merchandiseMinor: number;
  deliveryMinor?: number;
  taxMinor?: number;
  groups: { groupKey: string; supplierCode: string; rule: string; classification: string; freightMinor: number; subsidyMinor: number; requirementMinor: number; chargeMinor?: number; quoteRequired: boolean; reasons: string[] }[];
  reasons: string[];
  sourceVersionsHash: string;
  configVersions: Record<string, number>;
};

/** Computes a full estimate (no writes besides Ashcroft mirror variants). */
export async function computeEstimate(ctx: MutationCtx, input: { lines: LineInput[]; channel: 'retail' | 'trade'; destination: Destination; service: string }, now = Date.now()): Promise<EstimateOutcome> {
  if (input.service !== 'curbside') throw new CommerceError('DELIVERY_QUOTE_REQUIRED', 'Only curbside service is offered automatically', 'This delivery service needs a quote.');
  const lines = await resolveLines(ctx, input.lines, input.channel, now);
  const merchandiseMinor = lines.reduce((t, l) => t + l.unitPackMinor * l.packs, 0);
  const zuo = lines.filter((l) => l.provider === 'zuo');
  const ash = lines.filter((l) => l.provider === 'ashcroft');
  const configVersions: Record<string, number> = {};
  const versions = (await Promise.all([...lines.map((l) => `${l.variant._id}:${l.costRevisionId ?? ''}:${l.priceRevisionId ?? ''}:${l.unitPackMinor}`)])).join(',');
  if (zuo.length && ash.length) {
    const mixed = await activeConfig(ctx, 'deliveryRule', 'mixed-zuo-ashcroft');
    configVersions['mixed-zuo-ashcroft'] = mixed.version;
  }
  const extraFixedMinor = ash.reduce((t, l) => t + l.fixedDeliveryMinor, 0);
  const groupsOut: EstimateOutcome['groups'] = [];
  if (ash.length) groupsOut.push({ groupKey: 'ashcroft', supplierCode: 'ashcroft', rule: 'ashcroft-launch', classification: 'per_item', freightMinor: 0, subsidyMinor: 0, requirementMinor: extraFixedMinor, chargeMinor: extraFixedMinor, quoteRequired: false, reasons: [] });
  const destReasons = quoteOnlyReasons(input.destination.zip, input.destination.address);
  if (!zuo.length) {
    if (destReasons.length && zipRegion(input.destination.zip) !== 'CONUS') return { status: 'quote_required', lines, merchandiseMinor, groups: groupsOut, reasons: destReasons, sourceVersionsHash: versions, configVersions };
    return { status: 'ok', lines, merchandiseMinor, deliveryMinor: extraFixedMinor, taxMinor: 0, groups: groupsOut, reasons: [], sourceVersionsHash: versions, configVersions };
  }
  const ladderCfg = await activeConfig<DeliveryLadder>(ctx, 'deliveryLadder', 'delivery-ladder');
  const zuoRule = await activeConfig<{ originZip: string; supplierOrderFeeMinor?: number }>(ctx, 'deliveryRule', 'zuo-95206-curbside');
  const freightCfg = await maybeConfig<FreightConfig>(ctx, 'carrierRule', 'zuo-freight');
  const assumptions = (await activeConfig<PricingAssumptions>(ctx, 'pricingAssumptions', 'zuo-pricing-assumptions')).value;
  configVersions['delivery-ladder'] = ladderCfg.version;
  configVersions['zuo-95206-curbside'] = zuoRule.version;
  if (freightCfg) configVersions['zuo-freight'] = freightCfg.version;
  // Group by supplier, origin and service; never consolidate unrelated warehouses.
  const byGroup = new Map<string, ResolvedLine[]>();
  for (const l of zuo) {
    const k = `${l.supplierCode}:${l.originZip}:${input.service}`;
    byGroup.set(k, [...(byGroup.get(k) ?? []), l]);
  }
  const engineGroups: EngineGroup[] = [];
  for (const [groupKey, gl] of byGroup) {
    const reasons: string[] = [...destReasons];
    if (gl[0].originZip !== zuoRule.value.originZip) reasons.push(`Origin ${gl[0].originZip} has no approved delivery rule`);
    if (gl.some((l) => l.variant.holds.includes('METHOD_CHANGED'))) reasons.push('Supplier shipping method changed; needs a quote');
    const freightMinor = freightCfg && !reasons.length ? groupFreight(gl, input.destination, freightCfg.value, reasons) : null;
    if (!freightCfg) reasons.push('Freight rates are awaiting approval');
    engineGroups.push({ key: groupKey, supplierOrderFeeMinor: zuoRule.value.supplierOrderFeeMinor ?? 1000, freightMinor, quoteReasons: freightMinor === null ? reasons : [], lines: gl.map((l) => ({ key: l.lineKey, ...l.engine! })) });
  }
  const rates: EngineRates = { processingBps: assumptions.processingBps, returnsBps: assumptions.returnsBps, overheadBps: assumptions.overheadBps, deliveryProcessingBps: ladderCfg.value.deliveryProcessingBps };
  const state = input.destination.address?.state ?? '';
  const taxBps = freightCfg?.value.taxBpsByState?.[state] ?? freightCfg?.value.defaultTaxBps;
  const tax: TaxEstimator = taxBps === undefined ? flatRateTax(0) : flatRateTax(taxBps);
  const est = estimateCart(engineGroups, rates, ladderCfg.value, tax, extraFixedMinor);
  for (const g of est.groups)
    groupsOut.push({
      groupKey: g.key,
      supplierCode: g.key.split(':')[0],
      rule: 'zuo-95206-curbside',
      classification: g.quoteRequired ? 'quote' : 'auto',
      freightMinor: engineGroups.find((e) => e.key === g.key)?.freightMinor ?? 0,
      subsidyMinor: g.subsidyMinor,
      requirementMinor: g.requirementMinor ?? 0,
      quoteRequired: g.quoteRequired,
      reasons: g.reasons,
    });
  if (est.status !== 'ok') return { status: 'quote_required', lines, merchandiseMinor, groups: groupsOut, reasons: est.reasons, sourceVersionsHash: versions, configVersions };
  // Tax shown only at full-address precision with an approved tax table.
  const showTax = !!input.destination.address && taxBps !== undefined;
  return { status: 'ok', lines, merchandiseMinor, deliveryMinor: est.deliveryMinor, ...(showTax ? { taxMinor: est.taxMinor } : {}), groups: groupsOut, reasons: [], sourceVersionsHash: versions, configVersions };
}

export const cartHash = (lines: readonly LineInput[], channel: string) => stableStringify({ channel, lines: [...lines].map((l) => ({ p: l.productId, v: l.variantId, n: l.packs })).sort((a, b) => (a.p + a.v < b.p + b.v ? -1 : 1)) });
