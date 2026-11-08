import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query, mutation } from './_generated/server';
import { requireDeliveryRole } from './dlvAccess';
import { maybeConfig } from './sysConfig';
import { computeEstimate, type FreightConfig } from './dlvEngine';
import { lineArg } from './dlvEstimates';
import { evaluate } from './catCore';
import type { DeliveryControls, DeliveryLadder, PricingAssumptions } from '../lib/config';
import { US_STATES } from '../lib/delivery/destination';
import { CommerceError, commerceErrorData } from '../lib/errors';

export const coverage = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'finance');
    const [controls, freight, ladder, tax] = await Promise.all([
      maybeConfig<DeliveryControls>(ctx, 'deliveryControls', 'delivery-controls'),
      maybeConfig<FreightConfig>(ctx, 'carrierRule', 'zuo-freight'),
      maybeConfig<DeliveryLadder>(ctx, 'deliveryLadder', 'delivery-ladder'),
      maybeConfig(ctx, 'taxProviderPolicy', 'delivery-tax'),
    ]);
    const now = Date.now();
    return {
      checkedAt: now,
      states: [...US_STATES].map((state) => ({
        state,
        status:
          state === 'AK' || state === 'HI'
            ? 'quote_only'
            : 'ZIP-specific coverage only; no statewide guarantee',
      })),
      controls: controls?.value ?? null,
      ladder: ladder?.value ?? null,
      carrierEvidence: freight?.value.evidenceRef ?? null,
      carrierValidUntil: freight?.value.validUntil ?? null,
      carrierCurrent: !!freight?.value.validUntil && freight.value.validUntil > now,
      taxApproved: !!tax,
      lanes: Object.entries(freight?.value.zip3Zones ?? {}).map(([prefix, zone]) => ({
        prefix,
        zone,
        enabled:
          controls?.value.automaticEnabled === true &&
          controls.value.zip3Allowlist.includes(prefix),
        region:
          Number(prefix) >= 995
            ? 'Alaska'
            : Number(prefix) >= 967 && Number(prefix) <= 968
              ? 'Hawaii'
              : 'Other',
      })),
      note: 'A ZIP-prefix lane is not a claim of statewide coverage. Destination exceptions, service, carton, cost and tax gates still apply. Alaska and Hawaii use confirmed quotes.',
    };
  },
});

/** Paged internal record export; never exposed through storefront or partner APIs. */
export const records = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    if (
      !Number.isInteger(a.paginationOpts.numItems) ||
      a.paginationOpts.numItems < 1 ||
      a.paginationOpts.numItems > 50
    )
      throw new CommerceError('INVALID_INPUT', 'Request 1–50 variants per page');
    const page = await ctx.db.query('catVariants').paginate(a.paginationOpts);
    const assumptions = await maybeConfig<PricingAssumptions>(
      ctx,
      'pricingAssumptions',
      'zuo-pricing-assumptions'
    );
    const rows = [];
    for (const cv of page.page) {
      const [supplier, meta, cost, retail, trade, cartons, warehouse, listing] = await Promise.all([
        ctx.db.get(cv.supplierId),
        ctx.db
          .query('catProductMeta')
          .withIndex('by_product', (q) => q.eq('productId', cv.productId))
          .unique(),
        cv.currentCostRevisionId ? ctx.db.get(cv.currentCostRevisionId) : null,
        cv.retailPriceRevisionId ? ctx.db.get(cv.retailPriceRevisionId) : null,
        cv.tradePriceRevisionId ? ctx.db.get(cv.tradePriceRevisionId) : null,
        ctx.db
          .query('catCartons')
          .withIndex('by_variant', (q) => q.eq('variantId', cv._id))
          .collect(),
        cv.warehouseId ? ctx.db.get(cv.warehouseId) : null,
        ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) =>
            q.eq('productId', cv.productId).eq('channel', 'retail')
          )
          .unique(),
      ]);
      let freshness: unknown;
      try {
        freshness = await evaluate(ctx, cv);
      } catch (e) {
        freshness = { review: commerceErrorData(e)?.detail ?? 'Evidence review required' };
      }
      rows.push({
        variantId: cv._id,
        productId: cv.productId,
        supplier: supplier?.code,
        sku: cv.supplierSku,
        supplierName: meta?.supplierName,
        louieMaeName: meta?.louieMaeName,
        variantName: cv.louieMaeVariantName,
        packId: cv.packId,
        piecesPerPack: cv.piecesPerPack,
        minimumPacks: cv.orderMinimumPacks,
        incrementPacks: cv.orderIncrementPacks,
        wholesalePieceMinor: cost?.wholesaleMinor ?? null,
        wholesalePrecise: cost?.wholesalePrecise ?? null,
        currency: cost?.currency ?? null,
        mapMinor: cost?.mapMinor ?? null,
        mapUnitBasis: cost?.mapUnitBasis ?? null,
        mapApplicability: cost?.mapApplicability ?? null,
        mapEvidence: cost?.mapSource ?? null,
        costRevisionId: cost?._id ?? null,
        costVerifiedAt: cost?.verifiedAt ?? null,
        retailPackMinor: retail?.status === 'approved' ? retail.packPriceMinor : null,
        tradePackMinor: trade?.status === 'approved' ? trade.packPriceMinor : null,
        retailRevisionId: retail?._id ?? null,
        tradeRevisionId: trade?._id ?? null,
        marginPolicyKey: cv.marginPolicyKey ?? null,
        commissionCategory: meta?.commissionCategory ?? null,
        referralEligible: cv.referralEligible ?? null,
        sizeClass: cv.sizeClass ?? 'UNKNOWN',
        handlingPerPieceMinor: assumptions?.value.handlingPerPieceMinor ?? null,
        allowancePerPieceMinor:
          cv.sizeClass && cv.sizeClass !== 'UNKNOWN'
            ? (assumptions?.value.allowanceBySize[cv.sizeClass] ?? null)
            : null,
        assumptions: assumptions?.value ?? null,
        assumptionsVersion: assumptions?.version ?? null,
        warehouse: warehouse ?? null,
        cartons,
        holds: cv.holds,
        availability: cv.availability,
        freshness,
        images: listing?.snapshot.images ?? [],
        exportedAt: Date.now(),
        recordKind: 'internal_approved_and_source_records',
        units: {
          money: 'USD cents unless explicitly precise decimal',
          dimensions: 'mm',
          weight: 'g',
        },
      });
    }
    return { ...page, page: rows };
  },
});

export const scenarios = mutation({
  args: {
    lines: v.array(lineArg),
    channel: v.union(v.literal('retail'), v.literal('trade')),
    zips: v.array(v.string()),
    service: v.string(),
    previewProposed: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'finance');
    if (a.zips.length < 1 || a.zips.length > 10)
      throw new CommerceError('INVALID_INPUT', 'Compare 1–10 ZIPs at a time');
    const results = [];
    for (const zip of a.zips) {
      try {
        const r = await computeEstimate(ctx, {
          lines: a.lines,
          channel: a.channel,
          destination: { zip },
          service: a.service,
          adminSimulation: true,
          previewProposed: a.previewProposed,
        });
        results.push({
          zip,
          simulation: true,
          configurationMode: a.previewProposed ? 'proposed where available' : 'approved',
          configVersions: r.configVersions,
          status: r.status,
          deliveryMinor: r.deliveryMinor ?? null,
          taxMinor: null,
          payable: false,
          groups: r.groups,
          reasons: r.reasons,
          sourceVersionsHash: r.sourceVersionsHash,
        });
      } catch (e) {
        results.push({
          zip,
          simulation: true,
          status: 'review_required',
          deliveryMinor: null,
          taxMinor: null,
          payable: false,
          reasons: [commerceErrorData(e)?.detail ?? 'Review required'],
        });
      }
    }
    return results;
  },
});

/** Bounded pilot sample report. Never changes rates or claims nationwide accuracy. */
export const calibration = query({
  args: {},
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'finance');
    const recent = await ctx.db.query('ordSupplierOrders').order('desc').take(200);
    const rows = [];
    for (const child of recent) {
      const invoices = await ctx.db
        .query('dlvFreightInvoices')
        .withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', child._id))
        .collect();
      if (!invoices.length) continue;
      const order = await ctx.db.get(child.orderId),
        intent = order?.intentId ? await ctx.db.get(order.intentId) : null,
        estimate = intent ? await ctx.db.get(intent.estimateId) : null;
      const group = estimate?.groups.find(
        (g) => g.groupKey === `${child.supplierCode}:${child.warehouseCode ?? ''}:${child.service}`
      );
      const actual = invoices.reduce(
        (n, i) => n + i.baseMinor + i.fuelMinor + i.accessorialMinor - i.creditMinor,
        0
      );
      rows.push({
        supplier: child.supplierCode,
        origin: child.warehouseCode ?? null,
        zip3: order?.shippingAddress?.postalCode.slice(0, 3) ?? null,
        service: child.service,
        mode: group?.classification ?? null,
        estimateMinor: group?.freightMinor ?? null,
        actualFreightMinor: actual,
        varianceMinor: group ? actual - group.freightMinor : null,
        invoiceCount: invoices.length,
        lastInvoiceAt: Math.max(...invoices.map((i) => i.createdAt)),
      });
    }
    return {
      checkedAt: Date.now(),
      supplierOrdersScanned: recent.length,
      sampleCount: rows.length,
      rows,
      note: 'Latest 200 supplier orders only. Invoice totals can be provisional. Review sample counts, dates and final cost statements before proposing a new rate version; nothing is automatically published.',
    };
  },
});
