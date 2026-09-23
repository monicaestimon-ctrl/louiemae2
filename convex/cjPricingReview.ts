import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { cjPricingReviewValidator } from './cjPricingValidators';
import {
  cjMoney,
  cjPricingBlocks,
  pricingFingerprint,
  pricingSelections,
  quoteComplete,
  quoteRetail,
  quoteLanded,
  type CjPriceQuote,
  type CjPricingReview,
} from '../lib/cjPricingReview';

export const listApproved = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db
      .query('products')
      .withIndex('by_cj_sourcing_status', (q) => q.eq('cjSourcingStatus', 'approved'))
      .paginate(args.paginationOpts);
  },
});

export const save = internalMutation({
  args: {
    productId: v.id('products'),
    fingerprint: v.string(),
    review: cjPricingReviewValidator,
    leaseToken: v.optional(v.string()),
    allowReprice: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (args.leaseToken && product?.cjPricingLeaseToken !== args.leaseToken)
      throw new Error('Pricing check lease expired.');
    if (
      !product ||
      pricingFingerprint(product) !== args.fingerprint ||
      product.cjSourcingStatus !== 'approved'
    )
      throw new Error('Product changed during the price check. Refresh again.');
    // Reading costs must never change a live listing's retail price.
    const selected = pricingSelections(product);
    const complete =
      selected.length > 0 &&
      selected.every((v) =>
        args.review.quotes.some(
          (q) => q.vid === v.cjVariantId && q.sku === v.cjSku && quoteComplete(q)
        )
      );
    const canReprice =
      args.allowReprice === true &&
      complete &&
      !product.adminPriceLocked &&
      ['hidden', 'next_launch'].includes(product.storefrontStatus ?? 'published');
    const priceFor = (vid?: string, sku?: string) =>
      quoteRetail(args.review.quotes.find((q) => q.vid === vid && q.sku === sku)!);
    const price = canReprice
      ? Math.min(...selected.map((v) => priceFor(v.cjVariantId, v.cjSku)))
      : product.price;
    const changes: string[] = [];
    for (const quote of args.review.quotes) {
      const baseline = product.cjPricingBaseline ?? product.cjPricingReview;
      const old =
        baseline?.cjProductId === args.review.cjProductId
          ? baseline.quotes.find((q) => q.vid === quote.vid && q.sku === quote.sku)
          : undefined;
      if (
        old &&
        quoteComplete(old) &&
        quoteComplete(quote) &&
        [old.itemCost, old.shippingCost, old.taxesFee ?? 0, old.clearanceFee ?? 0].some(
          (cost, i) =>
            Math.round((cost ?? 0) * 100) !==
            Math.round(
              ([quote.itemCost, quote.shippingCost, quote.taxesFee ?? 0, quote.clearanceFee ?? 0][
                i
              ] ?? 0) * 100
            )
        )
      ) {
        changes.push(
          `${quote.name}: CJ item $${old.itemCost!.toFixed(2)} → $${quote.itemCost!.toFixed(2)}; landed estimate $${quoteLanded(old).toFixed(2)} → $${quoteLanded(quote).toFixed(2)}.`
        );
      }
    }
    const blocks = cjPricingBlocks({
      ...product,
      cjPricingReview: args.review,
      cjPricingError: undefined,
    });
    const alertMessage = [...changes, ...(!canReprice ? blocks : [])].join(' ').slice(0, 4000);
    await ctx.db.patch(product._id, {
      cjPricingReview: args.review,
      ...(complete ? { cjPricingBaseline: args.review } : {}),
      cjPricingError: undefined,
      cjPricingLeaseToken: undefined,
      cjPricingLeaseUntil: undefined,
      ...(alertMessage && alertMessage !== product.cjPricingAlert?.message
        ? { cjPricingAlert: { at: Date.now(), message: alertMessage } }
        : {}),
      ...(canReprice
        ? {
            price,
            suggestedRetailPrice: price,
            variants: product.variants?.map((v) =>
              v.inStock === false
                ? v
                : {
                    ...v,
                    priceAdjustment:
                      Math.round((priceFor(v.cjVariantId, v.cjSku) - price) * 100) / 100,
                  }
            ),
            productRevision: (product.productRevision ?? 0) + 1,
            productEditedAt: Date.now(),
            productEditedBy: 'CJ confirmed pricing',
          }
        : {}),
    });
    return { complete, repriced: canReprice };
  },
});

export const refreshWorker = internalAction({
  args: { productId: v.id('products'), allowReprice: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ complete: boolean; repriced: boolean }> => {
    const leaseToken = globalThis.crypto.randomUUID();
    const product: Doc<'products'> | null = await ctx.runMutation(internal.cjPricingReview.claim, {
      productId: args.productId,
      leaseToken,
    });
    if (!product) return { complete: false, repriced: false };
    const startedAt = Date.now();
    try {
      if (!product.cjProductId) throw new Error('CJ catalog product ID is missing.');
      const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
      if (!token) throw new Error('CJ authentication is unavailable.');
      const base = 'https://developers.cjdropshipping.com/api2.0/v1/';
      const request = async (path: string, body?: unknown) => {
        if (Date.now() - startedAt > 240000)
          throw new Error('Price check exceeded four minutes; refresh again.');
        const reservation = await ctx.runMutation(internal.cjSourcingJobs.reserveApiRequestSlot, {
          operation: 'pricing.review',
        });
        if (!reservation.admitted || reservation.reservedAt === undefined)
          throw new Error('CJ requests are temporarily paused.');
        const wait = Math.max(0, reservation.reservedAt - Date.now());
        if (wait > 30000) throw new Error('CJ request queue is busy. Try again shortly.');
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        const response = await fetch(base + path, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': token },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: globalThis.AbortSignal.timeout(10000),
        });
        const json = await response.json();
        const succeeded = json.result === true || (json.result === undefined && json.success === true);
        if (!response.ok || !succeeded) throw new Error(json.message || 'CJ quote unavailable.');
        return json.data;
      };
      const catalog = await request(`product/query?pid=${encodeURIComponent(product.cjProductId)}`);
      const variants = Array.isArray(catalog?.variants) ? catalog.variants : [];
      const inventory = await request(
        `product/stock/getInventoryByPid?pid=${encodeURIComponent(product.cjProductId)}`
      ).catch(() => null);
      const quotes: CjPriceQuote[] = [];
      const selections = pricingSelections(product);
      const unique = [...new Map(selections.map((v) => [v.cjVariantId, v] as const)).values()];
      if (unique.length > 60)
        throw new Error(
          'Split this product into listings with at most 60 selected variants before checking pricing.'
        );
      for (const selection of unique) {
        const variant = variants.find(
          (v: any) => String(v.vid) === selection.cjVariantId && v.variantSku === selection.cjSku
        );
        const quote: CjPriceQuote = {
          vid: selection.cjVariantId ?? '',
          sku: selection.cjSku ?? '',
          name: selection.name,
          itemCost: cjMoney(variant?.variantSellPrice),
        };
        try {
          if (!variant || !(quote.itemCost! > 0))
            throw new Error('Exact mapped variant or CJ item price is missing.');
          const variantInventory = inventory?.variantInventories?.find(
            (v: any) => String(v.vid) === selection.cjVariantId
          );
          const rows =
            variantInventory?.inventories ??
            variantInventory?.inventory ??
            inventory?.inventories ??
            [];
          const origins = [
            ...new Set<string>(
              rows
                .map((row: any) => row.countryCode)
                .filter((country: any) => typeof country === 'string' && /^[A-Z]{2}$/.test(country))
            ),
          ];
          const origin = origins.includes('CN') ? 'CN' : origins.includes('US') ? 'US' : origins[0];
          if (!origin) throw new Error('CJ shipping origin could not be verified.');
          const freight = await request('logistic/freightCalculate', {
            startCountryCode: origin,
            endCountryCode: 'US',
            products: [{ quantity: 1, vid: selection.cjVariantId }],
          });
          const options = (Array.isArray(freight) ? freight : []).flatMap((row: any) => {
            const shipping = cjMoney(row.logisticPrice);
            const total = cjMoney(row.totalPostageFee);
            const taxes = cjMoney(row.taxesFee) ?? 0;
            const clearance = cjMoney(row.clearanceOperationFee) ?? 0;
            if ((shipping === undefined && total === undefined) || !row.logisticName) return [];
            // totalPostageFee can already include taxes/clearance. Never add them twice.
            const shippingCost = shipping ?? Math.max(0, total! - taxes - clearance);
            const extra = Math.max(0, (total ?? 0) - shippingCost - taxes - clearance);
            return [
              {
                shippingCost: shippingCost + extra,
                taxesFee: taxes,
                clearanceFee: clearance,
                logisticsName: String(row.logisticName),
                origin,
              },
            ];
          });
          const cost = (q: (typeof options)[number]) =>
            q.shippingCost + q.taxesFee + q.clearanceFee;
          options.sort(
            (a: (typeof options)[number], b: (typeof options)[number]) => cost(a) - cost(b)
          );
          const chosen =
            options.find((q: (typeof options)[number]) => /cj\s*packet/i.test(q.logisticsName)) ??
            options[0];
          if (!chosen) throw new Error('No U.S. shipping quote returned for this variant.');
          Object.assign(quote, chosen);
        } catch (error) {
          quote.error = error instanceof Error ? error.message : 'Quote unavailable.';
        }
        quotes.push(quote);
      }
      const review: CjPricingReview = {
        cjProductId: product.cjProductId,
        checkedAt: Date.now(),
        destination: 'US',
        quantity: 1,
        quotes,
      };
      return await ctx.runMutation(internal.cjPricingReview.save, {
        productId: args.productId,
        fingerprint: pricingFingerprint(product),
        review,
        leaseToken,
        allowReprice: args.allowReprice ?? false,
      });
    } catch (error) {
      await ctx.runMutation(internal.cjPricingReview.failed, {
        productId: args.productId,
        leaseToken,
        error: error instanceof Error ? error.message : 'CJ pricing unavailable.',
      });
      return { complete: false, repriced: false };
    }
  },
});

export const refresh = action({
  args: { productId: v.id('products') },
  handler: async (ctx, args): Promise<{ complete: boolean; repriced: boolean }> => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
    return ctx.runAction(internal.cjPricingReview.refreshWorker, { ...args, allowReprice: true });
  },
});

export const claim = internalMutation({
  args: { productId: v.id('products'), leaseToken: v.string() },
  handler: async (ctx, args): Promise<Doc<'products'> | null> => {
    const product = await ctx.db.get(args.productId);
    if (
      !product ||
      product.cjSourcingStatus !== 'approved' ||
      (product.cjPricingLeaseUntil ?? 0) > Date.now()
    )
      return null;
    await ctx.db.patch(product._id, {
      cjPricingLastAttemptAt: Date.now(),
      cjPricingLeaseToken: args.leaseToken,
      cjPricingLeaseUntil: Date.now() + 600000,
    });
    return product;
  },
});

export const failed = internalMutation({
  args: { productId: v.id('products'), leaseToken: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product || product.cjPricingLeaseToken !== args.leaseToken) return;
    await ctx.db.patch(product._id, {
      cjPricingError: args.error.slice(0, 1000),
      cjPricingLeaseToken: undefined,
      cjPricingLeaseUntil: undefined,
      cjPricingAlert: {
        at: Date.now(),
        message: `CJ price check failed: ${args.error.slice(0, 1000)}`,
      },
    });
  },
});

// Oldest due products first, including never-checked approvals. Failed products rotate
// through the same queue, so a bad listing cannot starve the rest of the catalog.
export const dispatchMonitor = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query('products')
      .withIndex('by_cj_pricing_due', (q) =>
        q.eq('cjSourcingStatus', 'approved').lt('cjPricingLastAttemptAt', Date.now() - 86400000)
      )
      .take(10);
    for (const [index, product] of due.entries()) {
      await ctx.db.patch(product._id, { cjPricingLastAttemptAt: Date.now() });
      await ctx.scheduler.runAfter(index * 30000, internal.cjPricingReview.refreshWorker, {
        productId: product._id,
        allowReprice: false,
      });
    }
    return { scheduled: due.length };
  },
});

export const alerts = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const products = await ctx.db
      .query('products')
      .withIndex('by_cj_pricing_alert', (q) => q.gt('cjPricingAlert.at', 0))
      .order('desc')
      .take(50);
    return products.map((p) => ({
      id: p._id,
      name: p.name,
      alert: p.cjPricingAlert!,
      cjProductId: p.cjProductId,
    }));
  },
});
export const acknowledge = mutation({
  args: { productId: v.id('products'), at: v.number() },
  handler: async (ctx, args) => {
    await requireCjAdminIdentity(ctx);
    const product = await ctx.db.get(args.productId);
    if (product?.cjPricingAlert?.at === args.at)
      await ctx.db.patch(product._id, { cjPricingAlert: undefined });
  },
});

// Read-only operator verification; no secrets or customer information.
export const auditStatus = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('products')
      .withIndex('by_cj_sourcing_status', (q) => q.eq('cjSourcingStatus', 'approved'))
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((p) => ({
        id: p._id,
        name: p.name,
        cjProductId: p.cjProductId,
        lastAttemptAt: p.cjPricingLastAttemptAt,
        lastCheckedAt: p.cjPricingReview?.checkedAt,
        quoteCount: p.cjPricingReview?.quotes.length ?? 0,
        completeQuoteCount: p.cjPricingReview?.quotes.filter(quoteComplete).length ?? 0,
        error: p.cjPricingError,
        alert: p.cjPricingAlert,
        publicationBlocks: cjPricingBlocks(p),
      })),
    };
  },
});
