import { customerFacing } from '../lib/delivery/publicErrors';
import { assertDeliveryBounds } from '../lib/delivery/requestBounds';
// Delivery estimate contract (spec S18, v2 §12). ZIP estimates are non-binding; a full-address
// estimate valid through payment initiation is required for checkout. Any change to cart,
// address, membership, service, quantity, credit, discount or source version invalidates it.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { computeEstimate, cartHash, type LineInput } from './dlvEngine';
import { activeConfig } from './sysConfig';
import { bumpMetric, rateLimit } from './sysCore';
import { viewer, isVerified } from './holmAccess';
import { requireFlag, flag } from '../lib/flags';
import { available as creditAvailable } from './ldgCredits';
import { CommerceError } from '../lib/errors';
import { addressKey } from '../lib/delivery/destination';
import { DELIVERY_TIMING_CAVEAT, QUOTE_CTA, ZIP_ESTIMATE_NOTE } from '../lib/customerCopy';
import type { EstimatePolicy } from '../lib/config';
import { authorizeEstimate, capability, digest } from './dlvSecurity';
import { shipAddress } from './v2Validators';

export const lineArg = v.object({
  productId: v.string(),
  variantId: v.string(),
  packs: v.number(),
});
export const addressArg = shipAddress;
export type PublicDeliveryEstimate = {
  estimateId: Id<'dlvEstimates'>;
  guestCapability?: string;
  status: 'ok' | 'quote_required' | 'unsupported';
  deliveryChargeMinor: number | null;
  merchandiseMinor: number;
  taxMinor: number | null;
  creditMinor: number;
  totalMinor: number | null;
  serviceName: string;
  serviceDetails: string[];
  timingCaveat: string;
  note: string | null;
  expiresAt: number;
  splitKnown: boolean;
  reasons: string[];
  shipmentGroups: { label: string; items: { name: string; packs: number }[] }[];
};

/** Whether automatic delivery estimates are on (the storefront hides the estimator otherwise). */
export const enabled = query({ args: {}, handler: () => flag('DELIVERY_AUTOMATION_ENABLED') });

export const productProfile = query({
  args: {
    productId: v.string(),
    variantId: v.string(),
    channel: v.union(v.literal('retail'), v.literal('trade')),
  },
  handler: async (ctx, a) =>
    customerFacing(async () => {
      if (a.productId.length > 200 || a.variantId.length > 200)
        throw new CommerceError('INVALID_INPUT');
      if (a.channel === 'trade' && !isVerified((await viewer(ctx))?.profile ?? null))
        throw new CommerceError('TRADE_APPROVAL_REQUIRED');
      const pid = ctx.db.normalizeId('commerceProducts', a.productId),
        vid = ctx.db.normalizeId('catVariants', a.variantId);
      if (!pid || !vid) return null;
      const [cv, listing] = await Promise.all([
        ctx.db.get(vid),
        ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) =>
            q.eq('productId', pid).eq('channel', a.channel === 'retail' ? 'retail' : 'house')
          )
          .unique(),
      ]);
      if (
        !cv ||
        cv.productId !== pid ||
        !listing?.published ||
        !listing.snapshot.variants.some((v) => v.id === vid)
      )
        return null;
      return {
        piecesPerPack: cv.piecesPerPack,
        minimumPacks: cv.orderMinimumPacks,
        incrementPacks: cv.orderIncrementPacks,
      };
    }),
});

/**
 * Compatibility mutation for existing clients; new storefronts use the observed dlvTaxActions action.
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
  handler: async (ctx, a): Promise<PublicDeliveryEstimate> =>
    customerFacing(async () => {
      assertDeliveryBounds(a, 30);
      requireFlag('DELIVERY_AUTOMATION_ENABLED');
      const estimateViewer = await viewer(ctx);
      // A freely chosen visitor string is never the sole limit or an ownership credential.
      const principal =
        estimateViewer?.userId ??
        `guest:${await digest({ lines: a.lines, zip: a.zip.slice(0, 5) })}`;
      if (
        !(await rateLimit(ctx, `estimate:${principal}`, 30, 30)) ||
        !(await rateLimit(ctx, 'estimate:global-budget', 2000, 60))
      )
        throw new CommerceError(
          'INVALID_INPUT',
          'Too many estimates; wait a moment.',
          'Please wait a moment and try again.'
        );
      if (a.clientPrices !== undefined) await bumpMetric(ctx, 'security.client_price_ignored');
      const policy = (await activeConfig<EstimatePolicy>(ctx, 'estimatePolicy', 'estimate-policy'))
        .value;
      const service = a.service ?? 'curbside';
      const destination = { zip: a.zip.trim(), ...(a.address ? { address: a.address } : {}) };
      const me0 = await viewer(ctx);
      const creditMinor =
        a.useCredit && me0 && flag('CREDIT_V2_ENABLED')
          ? await creditAvailable(ctx, me0.userId)
          : 0;
      const out = await computeEstimate(ctx, {
        lines: a.lines as LineInput[],
        channel: a.channel,
        destination,
        service,
        creditMinor,
      });
      const now = Date.now();
      const expiresAt = Math.min(
        now + policy.validityMinutes * 60000,
        out.validUntil ?? Number.MAX_SAFE_INTEGER
      );
      const me = await viewer(ctx);
      const guestCapability = me ? undefined : capability();
      const status = out.status;
      const id: Id<'dlvEstimates'> = await ctx.db.insert('dlvEstimates', {
        serviceTerms: out.serviceTerms,
        channel: a.channel,
        destination: {
          zip: destination.zip,
          precision: a.address ? 'full' : 'zip',
          ...(a.address
            ? { addressHash: await digest(addressKey(a.address)), state: a.address.state }
            : {}),
        },
        service,
        lines: out.lines.map((l) => ({ variantId: l.variant._id, packs: l.packs })),
        groups: out.groups,
        status,
        ...(out.deliveryMinor !== undefined ? { deliveryChargeMinor: out.deliveryMinor } : {}),
        merchandiseMinor: out.merchandiseMinor,
        discountMinor: 0,
        creditMinor: out.creditMinor,
        ...(out.taxMinor !== undefined ? { taxMinor: out.taxMinor } : {}),
        ...(out.deliveryMinor !== undefined && out.taxMinor !== undefined
          ? {
              totalMinor: out.merchandiseMinor - out.creditMinor + out.deliveryMinor + out.taxMinor,
            }
          : {}),
        expiresAt,
        cartHash: cartHash(a.lines as LineInput[], a.channel),
        sourceVersionsHash: out.sourceVersionsHash,
        internal: {
          reasons: out.reasons,
          configVersions: out.configVersions,
          ...(out.taxBaseKey ? { taxBaseKey: out.taxBaseKey } : {}),
          lines: out.lines.map((l) => ({
            key: l.lineKey,
            unit: l.unitPackMinor,
            packs: l.packs,
            provider: l.provider,
            pieces: l.pieces,
            originZip: l.originZip,
            ...(l.engine ? { economics: l.engine } : {}),
            ...(l.costRevisionId ? { costRevisionId: l.costRevisionId } : {}),
            ...(l.priceRevisionId ? { priceRevisionId: l.priceRevisionId } : {}),
            category: l.category,
            netMinor: l.unitPackMinor * l.packs - (l.creditMinor ?? 0),
          })),
        },
        ...(me ? { userId: me.userId } : {}),
        ...(guestCapability ? { guestCapabilityHash: await digest(guestCapability) } : {}),
        createdAt: now,
      });
      const splitKnown = new Set(out.groups.map((g) => g.groupKey)).size > 1;
      return {
        estimateId: id,
        ...(guestCapability ? { guestCapability } : {}),
        status,
        deliveryChargeMinor: out.deliveryMinor ?? null,
        merchandiseMinor: out.merchandiseMinor,
        taxMinor: out.taxMinor ?? null,
        creditMinor: out.creditMinor,
        totalMinor:
          out.deliveryMinor !== undefined && out.taxMinor !== undefined
            ? out.merchandiseMinor - out.creditMinor + out.deliveryMinor + out.taxMinor
            : null,
        serviceName: out.serviceTerms.label,
        serviceDetails: out.serviceTerms.details,
        timingCaveat: DELIVERY_TIMING_CAVEAT,
        note: a.address ? null : ZIP_ESTIMATE_NOTE,
        expiresAt,
        splitKnown,
        // Customer-safe reasons only: no supplier names, costs or margins.
        reasons: status === 'ok' ? [] : [QUOTE_CTA],
        shipmentGroups: out.groups.map((g, i) => ({
          label: `Shipment ${i + 1}`,
          items: out.lines
            .filter((l) =>
              g.groupKey === 'ashcroft'
                ? l.provider === 'ashcroft'
                : g.groupKey === `${l.supplierCode}:${l.originZip}:${service}`
            )
            .map((l) => ({ name: l.name, packs: l.packs })),
        })),
      };
    }),
});

/** A stored estimate in customer-safe form (for the checkout review screen). */
export const get = query({
  args: { estimateId: v.id('dlvEstimates'), guestCapability: v.optional(v.string()) },
  handler: async (ctx, a) =>
    customerFacing(async () => {
      const e = await ctx.db.get(a.estimateId);
      if (!e) return null;
      await authorizeEstimate(ctx, e, a.guestCapability);
      return {
        status: e.status,
        serviceTerms: e.serviceTerms ?? null,
        deliveryChargeMinor: e.deliveryChargeMinor ?? null,
        merchandiseMinor: e.merchandiseMinor,
        taxMinor: e.taxMinor ?? null,
        totalMinor: e.totalMinor ?? null,
        expiresAt: e.expiresAt,
        expired: e.expiresAt <= Date.now(),
        precision: e.destination.precision,
      };
    }),
});
