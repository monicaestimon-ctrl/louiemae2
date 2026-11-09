// Server-owned delivery service (spec S17, S18, v2 §9–§12). One engine serves product, cart,
// checkout and trade estimates. The server reloads prices, membership, stock and source versions;
// client-supplied prices, roles, allowances and rates are never used.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { activeConfig, maybeConfig } from './sysConfig';
import { availableAfterCommitments } from './ordInventory';
import { assertSellable, ensureSupplier, isCurrentPrice } from './catCore';
import { viewer, isVerified } from './holmAccess';
import { CommerceError } from '../lib/errors';
import {
  estimateCart,
  flatRateTax,
  type EngineGroup,
  type EngineLine,
  type EngineRates,
  type TaxEstimator,
} from '../lib/delivery/engine';
import { classify, type CarrierRule } from '../lib/shipping/classify';
import { quoteOnlyReasons, addressKey, type AddressIn } from '../lib/delivery/destination';
import { launchPrice, retailDelivery, supplierAvailable } from '../lib/retailLaunch';
import { commissionReserve } from './dlvCommission';
import { digest } from './dlvSecurity';
import { parseDecimal, mul, rat, toMinor } from '../lib/decimal';
import { checkPackQuantity, physicalUnits } from '../lib/catUnits';
import { currentObservation } from '../lib/catFreshness';
import { warehouseCurrent } from '../lib/shipping/evidence';
import { stockView } from '../lib/stockEvidence';
import type {
  DeliveryLadder,
  ConfigKind,
  MarginPolicy,
  PricingAssumptions,
  DeliveryControls,
  FreshnessPolicy,
  TaxProviderPolicy,
} from '../lib/config';
import { stableStringify } from '../lib/zuoImport';
import { allocate } from '../lib/money';
import { assertLineMap, assertLineMechanism } from './catPolicies';
import { projectPrices } from './dlvProjectPricing';
import { exemptionFor } from './dlvTaxExemptions';
import { DELIVERY_TERMS_VERSION, serviceTerms, type DeliveryTerms } from '../lib/delivery/service';
import type { DeliveryServicePolicy } from '../lib/config';

type Ctx = QueryCtx | MutationCtx;
export type LineInput = { productId: string; variantId: string; packs: number };
export type Destination = { zip: string; address?: AddressIn };

/** The carrier/zone pricing record (sysConfig kind carrierRule). Rates come from carrier evidence. */
export type FreightConfig = {
  evidenceRef?: string;
  verifiedAt?: number;
  validUntil?: number;
  pallet?: {
    lengthMm: number;
    widthMm: number;
    maxHeightMm: number;
    maxGrossWeightG: number;
    tareWeightG: number;
    maxPallets: number;
    freightClass: string;
    packing: 'one_carton_per_pallet';
  };
  fixedPaymentMinor?: number;
  groundRatingBasis?: 'package' | 'shipment_weight';
  ltlRatingBasis?: 'actual_weight' | 'dimensional_weight' | 'quote_only';
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
  validUntil?: number;
  dependencyHash?: string;
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
  creditMinor?: number;
  engine?: Omit<EngineLine, 'key'>;
  cartons: Doc<'catCartons'>[];
  originZip: string;
  warehouseServices?: ('ground' | 'ltl')[];
  stockReadiness?: 'counted' | 'confirmation_required';
};

/**
 * Ashcroft lines keep their approved per-item rules (v2 §1). They get a mirror catVariant so
 * orders reference one variant id, but no Zuo freshness or pricing assumption touches them.
 */
async function ashcroftMirror(
  ctx: MutationCtx,
  product: Doc<'commerceProducts'>,
  variantId: string,
  sku: string,
  name: string
) {
  const supplier = await ensureSupplier(ctx, 'ashcroft');
  const existing = await ctx.db
    .query('catVariants')
    .withIndex('by_identity', (q) =>
      q.eq('supplierId', supplier._id).eq('supplierSku', sku).eq('packId', '1')
    )
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

async function categoryOf(
  ctx: Ctx,
  productId: Id<'commerceProducts'>,
  fallback: 'furniture' | 'decor' | 'clothing' = 'furniture'
) {
  const meta = await ctx.db
    .query('catProductMeta')
    .withIndex('by_product', (q) => q.eq('productId', productId))
    .first();
  if (!meta) return fallback;
  if (meta.commissionCategory === 'review_required')
    throw new CommerceError('COST_REVIEW_REQUIRED', 'Category under review');
  return meta.commissionCategory;
}

/** Resolves and validates every cart line from server data. */
export async function resolveLines(
  ctx: MutationCtx,
  lines: readonly LineInput[],
  channel: 'retail' | 'trade',
  now = Date.now(),
  authorizeTrade = true,
  maximumLines = 30
) {
  if (!lines.length || lines.length > maximumLines)
    throw new CommerceError('INVALID_INPUT', `Choose between 1 and ${maximumLines} items.`);
  const seen = new Set<string>();
  const out: ResolvedLine[] = [];
  let assumptions: PricingAssumptions | null = null;
  for (const [i, l] of lines.entries()) {
    if (!Number.isSafeInteger(l.packs) || l.packs < 1 || l.packs > 10000)
      throw new CommerceError(
        'INVALID_INPUT',
        'Large or invalid quantities require a project quote'
      );
    const key = `${l.productId}:${l.variantId}`;
    if (seen.has(key)) throw new CommerceError('INVALID_INPUT', 'Combine duplicate cart items.');
    seen.add(key);
    const pid = ctx.db.normalizeId('commerceProducts', l.productId);
    const product = pid ? await ctx.db.get(pid) : null;
    if (!product)
      throw new CommerceError(
        'STOCK_UNAVAILABLE',
        'Product not found',
        'This item is no longer available.'
      );
    const listing = await ctx.db
      .query('commerceListings')
      .withIndex('by_product_channel', (q) =>
        q.eq('productId', product._id).eq('channel', channel === 'retail' ? 'retail' : 'house')
      )
      .unique();
    if (!listing?.published)
      throw new CommerceError(
        'STOCK_UNAVAILABLE',
        'Not published',
        'This item is no longer available.'
      );
    const option = listing.snapshot.variants.find((x) => x.id === l.variantId);
    if (!option)
      throw new CommerceError(
        'STOCK_UNAVAILABLE',
        'Variant not listed',
        'This item is no longer available.'
      );
    if (product.provider === 'zuo') {
      const vid = ctx.db.normalizeId('catVariants', l.variantId);
      const cv = vid ? await assertSellable(ctx, vid, 'purchase', now) : null;
      if (!cv || cv.productId !== product._id)
        throw new CommerceError('STOCK_UNAVAILABLE', 'Variant mismatch');
      checkPackQuantity(cv, l.packs);
      const priceId = channel === 'retail' ? cv.retailPriceRevisionId : cv.tradePriceRevisionId;
      const price = priceId ? await ctx.db.get(priceId) : null;
      if (!isCurrentPrice(price, cv._id, channel, now))
        throw new CommerceError('COST_REVIEW_REQUIRED', `No current approved ${channel} price`);
      // The listing must still show the approved price (a changed price needs republishing).
      if (option.price !== price.packPriceMinor)
        throw new CommerceError('PRICE_CHANGED', 'Listing price differs from the approved price');
      const cost = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
      if (!cost || cost.wholesaleMinor === null)
        throw new CommerceError('COST_REVIEW_REQUIRED', 'Cost missing');
      assumptions ??= (
        await activeConfig<PricingAssumptions>(ctx, 'pricingAssumptions', 'zuo-pricing-assumptions')
      ).value;
      const margin = cv.marginPolicyKey
        ? await maybeConfig<MarginPolicy>(ctx, 'marginPolicy', cv.marginPolicyKey)
        : null;
      const pieces = physicalUnits(cv, l.packs);
      const extras =
        (cost.dutiesMinor ?? 0) + (cost.inboundFreightMinor ?? 0) + (cost.supplierFeesMinor ?? 0);
      const extrasKnown =
        (cost.dutiesMinor !== null || cost.dutiesConfirmedZero) &&
        (cost.inboundFreightMinor !== null || cost.inboundConfirmedZero) &&
        (cost.supplierFeesMinor !== null || cost.feesConfirmedZero);
      const category = await categoryOf(ctx, product._id);
      const netMinor = price.packPriceMinor * l.packs;
      const supplier = await ctx.db.get(cv.supplierId);
      const warehouse = cv.warehouseId ? await ctx.db.get(cv.warehouseId) : null;
      const originCurrent =
        warehouse?.supplierId === cv.supplierId && warehouseCurrent(warehouse, now);
      const reserve =
        channel === 'retail'
          ? await commissionReserve(ctx, product._id, category, cv.referralEligible, now)
          : { bps: 0, versions: [], validUntil: undefined };
      const observations = await ctx.db
        .query('catSourceObservations')
        .withIndex('by_variant_field_observed', (q) => q.eq('variantId', cv._id))
        .order('desc')
        .take(200);
      const freshness = await activeConfig<FreshnessPolicy>(
        ctx,
        'freshnessPolicy',
        supplier?.freshnessKey ?? 'freshness-default'
      );
      const currentStock = currentObservation(observations, 'stock', now);
      const stockRevision = cv.currentStockRevisionId
        ? await ctx.db.get(cv.currentStockRevisionId)
        : null;
      const inventory = stockView(
        stockRevision,
        cv.warehouseId,
        cv.piecesPerPack,
        now,
        Math.min(freshness.value.stockSyncMaxHours, freshness.value.checkoutSourceMaxHours) *
          3600000,
        cv.orderMinimumPacks,
        await digest(warehouse)
      );
      if (
        inventory.current &&
        inventory.availablePacks !== null &&
        l.packs > inventory.availablePacks
      )
        throw new CommerceError(
          'STOCK_UNAVAILABLE',
          'Requested packs exceed the current warehouse quantity'
        );
      if (inventory.automatic && inventory.availablePacks !== null &&
        l.packs > await availableAfterCommitments(ctx, cv, inventory.availablePacks, now))
        throw new CommerceError('STOCK_UNAVAILABLE', 'Available warehouse quantity is committed to other checkouts or paid orders');
      const stockAt = stockRevision
        ? (inventory.observedAt ?? 0)
        : currentStock && currentStock !== 'conflict'
          ? currentStock.observedAt
          : 0;
      const validUntil = Math.min(
        stockAt +
          Math.min(freshness.value.stockSyncMaxHours, freshness.value.checkoutSourceMaxHours) *
            3600000,
        (cost.verifiedAt ?? 0) + freshness.value.costMapMaxDays * 86400000,
        cost.effectiveTo ?? Infinity,
        price.effectiveTo ?? Infinity,
        freshness.effectiveTo ?? Infinity,
        margin?.effectiveTo ?? Infinity,
        reserve.validUntil ?? Infinity,
        warehouse?.validUntil ?? Infinity,
        stockRevision?.validUntil ?? Infinity
      );
      out.push({
        validUntil,
        dependencyHash: await digest({
          productRevision: product.revision,
          listing,
          cost,
          margin,
          assumptions,
          observations,
          reserve,
          warehouse,
          stockRevision,
          supplier,
        }),
        lineKey: `${i}:${product._id}:${cv._id}`,
        productId: product._id,
        variant: cv,
        provider: 'zuo',
        name:
          cv.louieMaeVariantName === 'Default'
            ? listing.snapshot.name
            : `${listing.snapshot.name} — ${cv.louieMaeVariantName}`,
        packs: l.packs,
        pieces,
        unitPackMinor: price.packPriceMinor,
        category,
        supplierCode: supplier?.code ?? 'zuo',
        costRevisionId: cost._id,
        priceRevisionId: price._id,
        fixedDeliveryMinor: 0,
        cartons: await ctx.db
          .query('catCartons')
          .withIndex('by_variant', (q) => q.eq('variantId', cv._id))
          .collect(),
        originZip: originCurrent ? warehouse!.originZip : '',
        warehouseServices: originCurrent ? warehouse!.services : [],
        stockReadiness: inventory.automatic ? 'counted' : 'confirmation_required',
        engine: {
          netMinor,
          // Landed merchandise cost incl. supplier payment cost; unknown extras block via margin.
          costMinor:
            toMinor(
              mul(
                cost.wholesalePrecise
                  ? parseDecimal(cost.wholesalePrecise)
                  : rat(cost.wholesaleMinor, 100),
                rat(pieces * (10000 + assumptions.supplierPaymentReserveBps), 100)
              ),
              'ceil'
            ) +
            extras * l.packs,
          physicalUnits: pieces,
          allowancePerUnitMinor:
            cv.sizeClass && cv.sizeClass !== 'UNKNOWN'
              ? assumptions.allowanceBySize[cv.sizeClass]
              : null,
          marginBps:
            extrasKnown &&
            margin &&
            !margin.value.blocksAutomaticSale &&
            margin.value.targetBps !== undefined
              ? margin.value.targetBps
              : null,
          // Reserve the maximum published eligible commission so following a link never raises delivery.
          commissionMinor: Math.ceil((netMinor * reserve.bps) / 10_000),
          otherMinor: 0,
        },
      });
    } else if (product.provider === 'ashcroft') {
      if (channel !== 'retail')
        throw new CommerceError(
          'TRADE_APPROVAL_REQUIRED',
          'Ashcroft trade orders use House quotes'
        );
      const supplierRow = listing.fulfillment?.find((x) => x.id === l.variantId);
      const rate = retailDelivery(listing.snapshot.category, listing.snapshot.name);
      if (
        !supplierRow?.sku ||
        !rate ||
        !supplierAvailable(supplierRow.sku, listing.snapshot.description)
      )
        throw new CommerceError(
          'STOCK_UNAVAILABLE',
          'Ashcroft item unavailable',
          'This item is no longer available.'
        );
      if (!Number.isInteger(l.packs) || l.packs < 1 || l.packs > 20)
        throw new CommerceError('INVALID_INPUT', 'Please contact us for orders above 20 units.');
      const name =
        option.name === 'Default Title'
          ? listing.snapshot.name
          : `${listing.snapshot.name} — ${option.name}`;
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
    } else
      throw new CommerceError(
        'STOCK_UNAVAILABLE',
        `${product.provider} items use their existing checkout`,
        'This item is Coming Soon.'
      );
  }
  if (channel === 'trade' && authorizeTrade) {
    const me = await viewer(ctx);
    if (!me || !isVerified(me.profile)) throw new CommerceError('TRADE_APPROVAL_REQUIRED');
  }
  return out;
}

const KG = 1000;

/** Freight for one Zuo shipment group from the approved carrier/zone record, or null (quote). */
export function groupFreight(
  lines: readonly ResolvedLine[],
  dest: Destination,
  f: FreightConfig,
  reasons: string[],
  rated?: { mode?: 'ground' | 'ltl' }
): number | null {
  if (
    !f.evidenceRef?.trim() ||
    !Number.isSafeInteger(f.verifiedAt) ||
    !Number.isSafeInteger(f.validUntil) ||
    f.verifiedAt! > Date.now() ||
    f.validUntil! <= Date.now()
  ) {
    reasons.push('Carrier evidence missing or expired');
    return null;
  }
  const cartons = lines.flatMap((l) => {
    const list = [];
    const count = l.cartons.reduce((n, c) => n + c.cartonsPerPack, 0) * l.packs;
    if (
      !Number.isSafeInteger(count) ||
      count > 500 ||
      l.cartons.some((c) => !Number.isSafeInteger(c.cartonsPerPack) || c.cartonsPerPack < 1)
    ) {
      reasons.push('Large shipment or invalid carton count requires a quote');
      return [];
    }
    for (let p = 0; p < l.packs; p++)
      for (const c of l.cartons) for (let k = 0; k < c.cartonsPerPack; k++) list.push(c);
    return list;
  });
  const c = classify(cartons, f.rule, {
    quoteOnly: quoteOnlyReasons(dest.zip, dest.address).length > 0,
  });
  if (c.mode === 'quote') {
    reasons.push(...c.reasons);
    return null;
  }
  if (rated) rated.mode = c.mode;
  if (
    lines.some(
      (line) =>
        line.warehouseServices !== undefined &&
        !line.warehouseServices.includes(c.mode as 'ground' | 'ltl')
    )
  ) {
    reasons.push('Warehouse dispatch service is not documented for this shipping mode');
    return null;
  }
  if (reasons.length) return null;
  if (
    f.rule.effectiveFrom > Date.now() ||
    (f.rule.effectiveTo !== undefined && f.rule.effectiveTo <= Date.now())
  ) {
    reasons.push('Carrier rate outside its effective dates');
    return null;
  }
  if (c.mode === 'ltl' && f.ltlRatingBasis !== 'actual_weight') {
    reasons.push(
      'LTL requires verified actual-weight rates; dimensional or unverified freight needs a quote'
    );
    return null;
  }
  if (c.mode === 'ltl') {
    if (dest.address && !/^\+?[0-9 ()-]{10,25}$/.test(dest.address.phone ?? '')) {
      reasons.push('Delivery appointment phone number is required');
      return null;
    }
    const p = f.pallet;
    if (
      !p ||
      p.packing !== 'one_carton_per_pallet' ||
      !p.freightClass ||
      cartons.length > p.maxPallets ||
      cartons.some(
        (x) =>
          !(
            (x.lengthMm <= p.lengthMm && x.widthMm <= p.widthMm) ||
            (x.widthMm <= p.lengthMm && x.lengthMm <= p.widthMm)
          ) ||
          x.heightMm > p.maxHeightMm ||
          x.grossWeightG + p.tareWeightG > p.maxGrossWeightG
      )
    ) {
      reasons.push('LTL pallet fit or freight class requires a verified quote');
      return null;
    }
  }
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
  const weight =
    c.mode === 'ltl' && f.ltlRatingBasis === 'actual_weight'
      ? c.cartons.reduce((n, x) => n + x.actualG + (f.pallet?.tareWeightG ?? 0), 0)
      : c.billableG;
  const raw =
    c.mode === 'ground' && f.groundRatingBasis !== 'shipment_weight'
      ? c.cartons.reduce(
          (n, p) => n + Math.max(f.groundMinimumMinor, Math.ceil((p.billableG * perKg) / KG)),
          0
        )
      : Math.max(
          c.mode === 'ground' ? f.groundMinimumMinor : f.ltlMinimumMinor,
          Math.ceil((weight * perKg) / KG)
        );
  const accessorials = c.mode === 'ltl' ? f.residentialMinor + f.liftgateMinor : 0;
  return raw + accessorials + Math.ceil(((raw + accessorials) * f.uncertaintyBps) / 10_000);
}

export type EstimateOutcome = {
  serviceTerms: DeliveryTerms;
  lineTaxes?: { key: string; taxMinor: number }[];
  deliveryTaxMinor?: number;
  taxCalculationRef?: string;
  taxBaseKey?: string;
  validUntil?: number;
  status: 'ok' | 'quote_required' | 'unsupported';
  lines: ResolvedLine[];
  merchandiseMinor: number;
  creditMinor: number;
  deliveryMinor?: number;
  taxMinor?: number;
  groups: {
    groupKey: string;
    supplierCode: string;
    rule: string;
    classification: string;
    freightMinor: number;
    subsidyMinor: number;
    requirementMinor: number;
    chargeMinor?: number;
    quoteRequired: boolean;
    reasons: string[];
  }[];
  reasons: string[];
  sourceVersionsHash: string;
  configVersions: Record<string, number>;
};

/** Computes a full estimate (no writes besides Ashcroft mirror variants). */
export async function computeEstimate(
  ctx: MutationCtx,
  input: {
    lines: LineInput[];
    channel: 'retail' | 'trade';
    destination: Destination;
    service: string;
    creditMinor?: number;
    adminSimulation?: boolean;
    previewProposed?: boolean;
  },
  now = Date.now()
): Promise<EstimateOutcome> {
  if (input.service !== 'curbside')
    throw new CommerceError(
      'DELIVERY_QUOTE_REQUIRED',
      'Only curbside service is offered automatically',
      'This delivery service needs a quote.'
    );
  async function deliveryConfig<T>(kind: ConfigKind, key: string, optional = false) {
    if (input.adminSimulation && input.previewProposed) {
      const rows = await ctx.db
        .query('sysConfig')
        .withIndex('by_kind_key_version', (q) => q.eq('kind', kind).eq('key', key))
        .order('desc')
        .take(50);
      const proposed = rows.find((r) => r.status === 'proposed');
      if (proposed)
        return {
          id: proposed._id,
          value: proposed.value as T,
          version: proposed.version,
          status: proposed.status,
          effectiveTo: proposed.effectiveTo,
        };
    }
    return optional ? maybeConfig<T>(ctx, kind, key) : activeConfig<T>(ctx, kind, key);
  }
  const lines = await resolveLines(ctx, input.lines, input.channel, now, !input.adminSimulation);
  const project =
    input.channel === 'trade'
      ? await projectPrices(
          ctx,
          lines.map((l) => ({ variant: l.variant, packs: l.packs, unitPackMinor: l.unitPackMinor }))
        )
      : null;
  if (project)
    for (const l of lines) {
      const p = project.lines.find((x) => x.variantId === l.variant._id)!;
      l.unitPackMinor = p.price;
      if (l.engine) l.engine.netMinor = p.price * l.packs;
    }
  const merchandiseMinor = lines.reduce((t, l) => t + l.unitPackMinor * l.packs, 0);
  if (
    !Number.isSafeInteger(merchandiseMinor) ||
    merchandiseMinor <= 0 ||
    merchandiseMinor > 1000000000
  )
    throw new CommerceError('INVALID_INPUT', 'This project requires a manual quote');
  // Store credit comes off merchandise only (never delivery or tax), shared across lines by value.
  const creditMinor = Math.min(Math.max(0, input.creditMinor ?? 0), merchandiseMinor);
  const creditShares = allocate(
    creditMinor,
    lines.map((l) => l.unitPackMinor * l.packs)
  );
  lines.forEach((l, i) => {
    l.creditMinor = creditShares[i];
    if (l.engine)
      l.engine = {
        ...l.engine,
        netMinor: l.engine.netMinor - creditShares[i],
        commissionMinor: Math.ceil(
          (l.engine.commissionMinor * (l.unitPackMinor * l.packs - creditShares[i])) /
            Math.max(1, l.unitPackMinor * l.packs)
        ),
      };
  });
  for (const l of lines.filter((x) => x.provider === 'zuo')) {
    await assertLineMap(
      ctx,
      l.variant._id,
      Math.floor((l.unitPackMinor * l.packs - (l.creditMinor ?? 0)) / l.packs)
    );
    if (input.channel === 'trade') await assertLineMechanism(ctx, l.variant._id, 'trade');
    if ((l.creditMinor ?? 0) > 0) await assertLineMechanism(ctx, l.variant._id, 'credit');
  }
  const zuo = lines.filter((l) => l.provider === 'zuo');
  const ash = lines.filter((l) => l.provider === 'ashcroft');
  const configVersions: Record<string, number> = {};
  const configs: unknown[] = project ? [project.policy, project.schedule] : [];
  const servicePolicy = await deliveryConfig<DeliveryServicePolicy>(
    'serviceLevel',
    `delivery-${input.service}`,
    true
  );
  configs.push(servicePolicy);
  if (servicePolicy) configVersions[`delivery-${input.service}`] = servicePolicy.version;
  const versions = () =>
    digest({
      deliveryTermsVersion: DELIVERY_TERMS_VERSION,
      lines,
      configs,
      configVersions,
      channel: input.channel,
      service: input.service,
      destination: input.destination,
    });
  if (zuo.length && ash.length) {
    const mixed = await activeConfig(ctx, 'deliveryRule', 'mixed-zuo-ashcroft');
    configVersions['mixed-zuo-ashcroft'] = mixed.version;
    configs.push(mixed);
  }
  const extraFixedMinor = ash.reduce((t, l) => t + l.fixedDeliveryMinor, 0);
  const groupsOut: EstimateOutcome['groups'] = [];
  const taxPolicy = await maybeConfig<TaxProviderPolicy>(ctx, 'taxProviderPolicy', 'delivery-tax');
  const exemption = input.destination.address
    ? await exemptionFor(ctx, input.channel, input.destination.address.state, now)
    : null;
  const taxBaseKey = input.destination.address
    ? await digest({
        channel: input.channel,
        address: addressKey(input.destination.address),
        lines: lines.map((l) => ({
          variant: l.variant._id,
          packs: l.packs,
          net: l.unitPackMinor * l.packs - (l.creditMinor ?? 0),
          category: l.category,
        })),
        policy: taxPolicy?.version ?? 0,
        exemption: exemption ? { id: exemption._id, until: exemption.validUntil } : null,
      })
    : undefined;
  const taxRows = taxBaseKey
    ? (
        await ctx.db
          .query('dlvTaxCalculations')
          .withIndex('by_base', (q) => q.eq('baseKey', taxBaseKey))
          .order('desc')
          .take(100)
      ).filter(
        (t) =>
          t.expiresAt > now &&
          t.policyVersion === taxPolicy?.version &&
          t.lineTaxes !== undefined &&
          t.deliveryTaxMinor !== undefined
      )
    : [];
  const usedTaxes: Doc<'dlvTaxCalculations'>[] = [];
  const verifiedTax = (delivery: number) => taxRows.find((t) => t.deliveryMinor === delivery);
  configs.push(taxPolicy);
  if (ash.length)
    groupsOut.push({
      groupKey: 'ashcroft',
      supplierCode: 'ashcroft',
      rule: 'ashcroft-launch',
      classification: 'per_item',
      freightMinor: 0,
      subsidyMinor: 0,
      requirementMinor: extraFixedMinor,
      chargeMinor: extraFixedMinor,
      quoteRequired: false,
      reasons: [],
    });
  const destReasons = quoteOnlyReasons(input.destination.zip, input.destination.address);
  if (!servicePolicy || servicePolicy.value.code !== input.service)
    destReasons.push('Delivery service terms need approval');
  if (ash.length && !servicePolicy?.value.modes.per_item)
    destReasons.push('Supplier delivery service needs review');
  if (!zuo.length) {
    if (destReasons.length)
      return {
        serviceTerms: serviceTerms(
          groupsOut.map((g) => g.classification),
          servicePolicy?.value
        ),
        status: 'quote_required',
        lines,
        merchandiseMinor,
        creditMinor,
        groups: groupsOut,
        reasons: destReasons,
        sourceVersionsHash: await versions(),
        configVersions,
      };
    const tax = verifiedTax(extraFixedMinor);
    if (tax) configs.push(tax);
    return {
      serviceTerms: serviceTerms(
        groupsOut.map((g) => g.classification),
        servicePolicy?.value
      ),
      status: 'ok',
      ...(taxBaseKey ? { taxBaseKey } : {}),
      ...(tax
        ? {
            taxMinor: tax.taxMinor,
            validUntil: Math.min(tax.expiresAt, servicePolicy?.effectiveTo ?? Infinity),
            taxCalculationRef: tax.reference,
            lineTaxes: tax.lineTaxes,
            deliveryTaxMinor: tax.deliveryTaxMinor,
          }
        : {}),
      lines,
      merchandiseMinor,
      creditMinor,
      deliveryMinor: extraFixedMinor,
      groups: groupsOut,
      reasons: [],
      sourceVersionsHash: await versions(),
      configVersions,
    };
  }
  const ladderCfg = (await deliveryConfig<DeliveryLadder>('deliveryLadder', 'delivery-ladder'))!;
  const zuoRule = (await deliveryConfig<{
    originZip: string;
    supplierOrderFeeMinor?: number;
    supplierFeeScope?: 'order' | 'shipment';
  }>('deliveryRule', 'zuo-95206-curbside'))!;
  const freightCfg = await deliveryConfig<FreightConfig>('carrierRule', 'zuo-freight', true);
  const controls = await deliveryConfig<DeliveryControls>(
    'deliveryControls',
    'delivery-controls',
    true
  );
  const assumptionsConfig = await activeConfig<PricingAssumptions>(
    ctx,
    'pricingAssumptions',
    'zuo-pricing-assumptions'
  );
  const assumptions = assumptionsConfig.value;
  configs.push(ladderCfg, zuoRule, freightCfg, assumptionsConfig, controls);
  if (controls) configVersions['delivery-controls'] = controls.version;
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
  const groupModes = new Map<string, string>();
  const groupEntries = [...byGroup.entries()];
  const fixedPaymentShares = allocate(
    freightCfg?.value.fixedPaymentMinor ?? 0,
    zuo.map((l) => l.unitPackMinor * l.packs)
  );
  zuo.forEach((l, i) => {
    if (l.engine) l.engine.otherMinor += fixedPaymentShares[i];
  });
  const fee = zuoRule.value.supplierOrderFeeMinor ?? 0;
  const feeShares =
    zuoRule.value.supplierFeeScope === 'shipment'
      ? groupEntries.map(() => fee)
      : allocate(
          fee,
          groupEntries.map(([, ls]) => ls.reduce((n, l) => n + l.pieces, 0))
        );
  for (const [groupKey, gl] of byGroup) {
    const reasons: string[] = [...destReasons];
    const c = controls?.value;
    if (
      !c?.automaticEnabled ||
      !c.suppliers.includes(gl[0].supplierCode) ||
      !c.origins.includes(gl[0].originZip) ||
      !c.services.includes(input.service) ||
      !c.zip3Allowlist.includes(input.destination.zip.slice(0, 3)) ||
      c.blockedZip5.includes(input.destination.zip.slice(0, 5))
    )
      reasons.push('This lane or service is not enabled for automatic delivery');
    if (zuoRule.value.supplierOrderFeeMinor === undefined || !zuoRule.value.supplierFeeScope)
      reasons.push('Supplier order fee and charging basis require confirmation');
    if (freightCfg && freightCfg.value.originZip !== gl[0].originZip)
      reasons.push('Freight rate origin does not match the fulfillment warehouse');
    if (freightCfg?.value.fixedPaymentMinor === undefined)
      reasons.push('Fixed payment expense requires confirmation');
    if (gl[0].originZip !== zuoRule.value.originZip)
      reasons.push(`Origin ${gl[0].originZip} has no approved delivery rule`);
    if (gl.some((l) => l.variant.holds.includes('METHOD_CHANGED')))
      reasons.push('Supplier shipping method changed; needs a quote');
    if (gl.some((l) => l.stockReadiness === 'confirmation_required'))
      reasons.push(
        'Supplier inventory quantity or allocation needs confirmation before automatic checkout'
      );
    const rated: { mode?: 'ground' | 'ltl' } = {};
    let freightMinor =
      freightCfg && !reasons.length
        ? groupFreight(gl, input.destination, freightCfg.value, reasons, rated)
        : null;
    if (rated.mode && !servicePolicy?.value.modes[rated.mode]) {
      reasons.push('This delivery mode needs approved service terms');
      freightMinor = null;
    }
    if (rated.mode) groupModes.set(groupKey, rated.mode);
    if (!freightCfg) reasons.push('Freight rates are awaiting approval');
    engineGroups.push({
      key: groupKey,
      supplierOrderFeeMinor: feeShares[engineGroups.length],
      freightMinor,
      quoteReasons: freightMinor === null ? reasons : [],
      lines: gl.map((l) => ({ key: l.lineKey, ...l.engine! })),
    });
  }
  const rates: EngineRates = {
    processingBps: assumptions.processingBps,
    returnsBps: assumptions.returnsBps,
    overheadBps: assumptions.overheadBps,
    deliveryProcessingBps: ladderCfg.value.deliveryProcessingBps,
    handlingPerPieceMinor: assumptions.handlingPerPieceMinor,
  };
  const state = input.destination.address?.state ?? '';
  const taxBps = freightCfg?.value.taxBpsByState?.[state] ?? freightCfg?.value.defaultTaxBps;
  const tax: TaxEstimator = taxPolicy
    ? ({ deliveryMinor, lineNetMinor }) => {
        const t = verifiedTax(deliveryMinor);
        if (t) usedTaxes.push(t);
        return {
          taxMinor: t?.taxMinor ?? 0,
          lineTaxMinor: allocate(t?.taxMinor ?? 0, lineNetMinor),
        };
      }
    : taxBps === undefined
      ? flatRateTax(0)
      : flatRateTax(taxBps);
  const est = estimateCart(engineGroups, rates, ladderCfg.value, tax, extraFixedMinor);
  for (const g of est.groups)
    groupsOut.push({
      groupKey: g.key,
      supplierCode: g.key.split(':')[0],
      rule: 'zuo-95206-curbside',
      classification: g.quoteRequired ? 'quote' : (groupModes.get(g.key) ?? 'quote'),
      freightMinor: engineGroups.find((e) => e.key === g.key)?.freightMinor ?? 0,
      subsidyMinor: g.subsidyMinor,
      requirementMinor: g.requirementMinor ?? 0,
      quoteRequired: g.quoteRequired,
      reasons: g.reasons,
    });
  if (est.status !== 'ok')
    return {
      serviceTerms: serviceTerms(
        groupsOut.map((g) => g.classification),
        servicePolicy?.value
      ),
      status: 'quote_required',
      lines,
      merchandiseMinor,
      creditMinor,
      groups: groupsOut,
      reasons: est.reasons,
      sourceVersionsHash: await versions(),
      configVersions,
    };
  const automaticGroups = groupsOut.filter((g) => g.rule === 'zuo-95206-curbside');
  const required = automaticGroups.reduce((n, g) => n + g.requirementMinor, 0);
  const surplus = allocate(
    est.deliveryMinor - extraFixedMinor - required,
    automaticGroups.map((g) => Math.max(1, g.requirementMinor))
  );
  automaticGroups.forEach((g, i) => {
    g.chargeMinor = g.requirementMinor + surplus[i];
  });
  // Tax shown only at full-address precision with an approved tax table.
  const verified = verifiedTax(est.deliveryMinor);
  // State-rate matrices remain simulation inputs only; final checkout needs address-bound evidence.
  const showTax = !!input.destination.address && !!verified;
  if (taxPolicy) configs.push(...[...new Map(usedTaxes.map((t) => [t._id, t])).values()]);
  const validUntil = Math.min(
    ...lines.map((l) => l.validUntil ?? Number.MAX_SAFE_INTEGER),
    project?.policy?.effectiveTo ?? Infinity,
    project?.schedule.effectiveTo ?? Infinity,
    assumptionsConfig.effectiveTo ?? Infinity,
    ladderCfg.effectiveTo ?? Infinity,
    zuoRule.effectiveTo ?? Infinity,
    freightCfg?.effectiveTo ?? Infinity,
    freightCfg?.value.rule.effectiveTo ?? Infinity,
    freightCfg?.value.validUntil ?? Infinity,
    controls?.effectiveTo ?? Infinity,
    servicePolicy?.effectiveTo ?? Infinity,
    taxPolicy?.effectiveTo ?? Infinity,
    verified?.expiresAt ?? Infinity
  );
  return {
    serviceTerms: serviceTerms(
      groupsOut.map((g) => g.classification),
      servicePolicy?.value
    ),
    status: 'ok',
    validUntil,
    ...(taxBaseKey ? { taxBaseKey } : {}),
    lines,
    merchandiseMinor,
    creditMinor,
    deliveryMinor: est.deliveryMinor,
    ...(showTax
      ? {
          taxMinor: verified!.taxMinor,
          taxCalculationRef: verified!.reference,
          lineTaxes: verified!.lineTaxes,
          deliveryTaxMinor: verified!.deliveryTaxMinor,
        }
      : {}),
    groups: groupsOut,
    reasons: [],
    sourceVersionsHash: await versions(),
    configVersions,
  };
}

export const cartHash = (lines: readonly LineInput[], channel: string) =>
  stableStringify({
    channel,
    lines: [...lines]
      .map((l) => ({ p: l.productId, v: l.variantId, n: l.packs }))
      .sort((a, b) => (a.p + a.v < b.p + b.v ? -1 : 1)),
  });
