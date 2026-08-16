"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
    addCart,
    addCartConfirm,
    createSourcing,
    createOrderV2,
    formatCjApiError,
    getInventoryByPid,
    getInventoryBySku,
    getInventoryByVid,
    getOrderDetail,
    getTrackingInfo as getCjTrackingInfo,
    payBalanceV2,
    saveGenerateParentOrder,
    type CjApiErrorDetails,
    type CjInventoryRow,
    type CjTrackingInfoRow,
} from "./cjApiClient";
import { getCjAutomationConfig } from "../lib/cjAutomation";
import { parseCjTokenResponse } from "../lib/cjAuth";
import { buildCjSourcingPayload } from "../lib/cjSourcing";
import {
    createCjInventoryErrorSnapshot,
    mergeCjInventoryStatuses,
    summarizeCjInventoryRows,
    type CjInventorySnapshot,
} from "../lib/cjInventory";
import { calculateOrderPricingReconciliation } from "../lib/pricing";
import { getTrackNumberFromOrderDetail, reconcileCjTracking } from "../lib/cjTracking";
import {
    hasReachedCjStep,
    type CjFulfillmentStep,
} from "../lib/cjFulfillmentWorkflow";

// ═══════════════════════════════════════════════════════════════════════════
// CJ DROPSHIPPING API INTEGRATION
// Handles authentication, order creation, and tracking sync with CJ
// Note: Queries/mutations are in cjHelpers.ts (can't be in "use node" files)
// ═══════════════════════════════════════════════════════════════════════════

const CJ_API_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

// Rejected-product recheck limits (Comment #1)
// Cap how many rejected products are re-checked per cron run to bound API usage & action time.
const MAX_RECHECK_BATCH = 20;
// Keep a cron pass comfortably below Convex's action timeout. Pending products
// are selected oldest-checked-first so subsequent runs advance through the queue.
const MAX_PENDING_BATCH = 30;
// Only re-check products rejected within this many days (older ones are truly dead).
const RECHECK_WINDOW_DAYS = 14;

// Timeout for CJ API verification requests (Comments #5, #6)
const CJ_FETCH_TIMEOUT_MS = 10_000;
const CJ_API_REQUEST_SPACING_MS = 1_250;
const CJ_DIAGNOSTIC_REQUEST_SPACING_MS = CJ_API_REQUEST_SPACING_MS;
const CJ_PRICING_REFRESH_MAX_ATTEMPTS = 3;
const CJ_PRICING_REFRESH_RETRY_DELAY_MS = 60_000;

// Stale pending detection. Stale tickets require reconciliation; clearing their
// provider ID and blindly resubmitting can create duplicate CJ sourcing tickets.
const STALE_PENDING_HOURS = 48;

// Refresh shortly before expiration. A one-day access-token buffer caused
// unnecessary refresh traffic and amplified concurrent token stampedes.
const ACCESS_TOKEN_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_LEASE_MS = 30_000;
const CJ_AUTH_TIMEOUT_MS = 15_000;

type CjFreightQuote = {
    shippingCost?: number;
    taxesFee?: number;
    clearanceFee?: number;
    logisticsName?: string;
    rawResponse?: any;
};

const toFiniteNumber = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const extractCjVariantPrice = (variant: any): number | undefined => {
    return toFiniteNumber(variant?.variantSellPrice ?? variant?.sellPrice ?? variant?.price);
};

const chooseFreightRow = (rows: any[]): any | undefined => {
    const pricedRows = rows
        .map(row => ({
            row,
            cost: toFiniteNumber(row?.totalPostageFee ?? row?.logisticPrice ?? row?.postageAmount),
        }))
        .filter((item): item is { row: any; cost: number } => item.cost !== undefined && item.cost >= 0);
    if (pricedRows.length === 0) return undefined;

    const cjPacket = pricedRows.find(item =>
        String(item.row?.logisticName ?? item.row?.logisticsName ?? '')
            .toLowerCase()
            .includes('cj packet')
    );
    return (cjPacket ?? pricedRows.sort((a, b) => a.cost - b.cost)[0]).row;
};

const quoteCjFreightForVariant = async (
    accessToken: string,
    vid: string | undefined,
): Promise<CjFreightQuote | undefined> => {
    if (!vid) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CJ_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(`${CJ_API_BASE}/logistic/freightCalculate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "CJ-Access-Token": accessToken,
            },
            body: JSON.stringify({
                startCountryCode: "CN",
                endCountryCode: "US",
                products: [{ quantity: 1, vid }],
            }),
            signal: controller.signal,
        });
        const data = await response.json();
        const rows = Array.isArray(data?.data) ? data.data : [];
        const row = chooseFreightRow(rows);
        if (!data?.result || !row) {
            return { rawResponse: data };
        }
        return {
            shippingCost: toFiniteNumber(row.totalPostageFee ?? row.logisticPrice ?? row.postageAmount),
            taxesFee: toFiniteNumber(row.taxesFee),
            clearanceFee: toFiniteNumber(row.clearanceOperationFee),
            logisticsName: row.logisticName ?? row.logisticsName,
            rawResponse: data,
        };
    } catch (error: any) {
        console.warn(`CJ freight quote failed for vid=${vid}:`, error?.message ?? error);
        return undefined;
    } finally {
        clearTimeout(timeout);
    }
};

const quoteCjFreightForProducts = async (
    accessToken: string,
    products: Array<{ vid?: string; quantity: number }>,
    endCountryCode: string,
): Promise<CjFreightQuote | undefined> => {
    const quoteProducts = products
        .filter(product => product.vid)
        .map(product => ({ vid: product.vid, quantity: product.quantity }));
    if (quoteProducts.length === 0) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CJ_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(`${CJ_API_BASE}/logistic/freightCalculate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "CJ-Access-Token": accessToken,
            },
            body: JSON.stringify({
                startCountryCode: "CN",
                endCountryCode,
                products: quoteProducts,
            }),
            signal: controller.signal,
        });
        const data = await response.json();
        const rows = Array.isArray(data?.data) ? data.data : [];
        const row = chooseFreightRow(rows);
        if (!data?.result || !row) {
            return { rawResponse: data };
        }
        return {
            shippingCost: toFiniteNumber(row.totalPostageFee ?? row.logisticPrice ?? row.postageAmount),
            taxesFee: toFiniteNumber(row.taxesFee),
            clearanceFee: toFiniteNumber(row.clearanceOperationFee),
            logisticsName: row.logisticName ?? row.logisticsName,
            rawResponse: data,
        };
    } catch (error: any) {
        console.warn("CJ order freight quote failed:", error?.message ?? error);
        return undefined;
    } finally {
        clearTimeout(timeout);
    }
};
const REFRESH_TOKEN_BUFFER_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION
// Now uses database-stored tokens to avoid rate limiting on token requests
// Flow: 1) Check DB for valid token → 2) Refresh if expired → 3) New token as last resort
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get CJ API access token with proper refresh token handling
 * - First checks database for existing valid token
 * - Uses refresh token if access token expired
 * - Only requests new token with API key when refresh token also expired
 */
export const getAccessToken = internalAction({
    args: {},
    handler: async (ctx): Promise<string | null> => {
        const apiKey = process.env.CJ_API_KEY;

        const leaseToken = globalThis.crypto.randomUUID();
        try {
            let storedTokens = await ctx.runQuery(internal.cjHelpers.getCjTokens, {});
            const now = Date.now();
            const accessExpiry = storedTokens ? Date.parse(storedTokens.accessTokenExpiryDate) : Number.NaN;
            if (storedTokens && Number.isFinite(accessExpiry) && accessExpiry - ACCESS_TOKEN_BUFFER_MS > now) {
                return storedTokens.accessToken;
            }

            const lease = await ctx.runMutation(internal.cjSourcingJobs.acquireTokenRefreshLease, {
                leaseToken,
                ttlMs: TOKEN_REFRESH_LEASE_MS,
            });
            if (!lease.acquired) {
                // The old token remains safe to use until its real expiry while
                // another worker performs the proactive refresh.
                if (storedTokens && Number.isFinite(accessExpiry) && accessExpiry - 60_000 > now) {
                    return storedTokens.accessToken;
                }
                for (let attempt = 0; attempt < 10; attempt++) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    const refreshed = await ctx.runQuery(internal.cjHelpers.getCjTokens, {});
                    const refreshedExpiry = refreshed ? Date.parse(refreshed.accessTokenExpiryDate) : Number.NaN;
                    if (refreshed && Number.isFinite(refreshedExpiry) && refreshedExpiry - 60_000 > Date.now()) {
                        return refreshed.accessToken;
                    }
                }
                console.error("CJ authentication refresh is already in progress and no usable token became available.");
                return null;
            }

            try {
                // Re-read after acquiring the lease in case the previous owner
                // completed between our initial read and the atomic claim.
                storedTokens = await ctx.runQuery(internal.cjHelpers.getCjTokens, {});
                const currentTime = Date.now();
                const currentAccessExpiry = storedTokens ? Date.parse(storedTokens.accessTokenExpiryDate) : Number.NaN;
                if (storedTokens && Number.isFinite(currentAccessExpiry) && currentAccessExpiry - ACCESS_TOKEN_BUFFER_MS > currentTime) {
                    return storedTokens.accessToken;
                }
                const refreshExpiry = storedTokens ? Date.parse(storedTokens.refreshTokenExpiryDate) : Number.NaN;
                if (storedTokens && Number.isFinite(refreshExpiry) && refreshExpiry - REFRESH_TOKEN_BUFFER_MS > currentTime) {
                    const refreshedToken = await refreshAccessToken(ctx, storedTokens);
                    if (refreshedToken) return refreshedToken;
                    if (Number.isFinite(currentAccessExpiry) && currentAccessExpiry - 60_000 > currentTime) {
                        return storedTokens.accessToken;
                    }
                    return null;
                }
                if (!apiKey) {
                    console.error("CJ API Key not configured and no usable stored token is available.");
                    return null;
                }
                return await requestNewTokens(ctx, apiKey);
            } finally {
                try {
                    await ctx.runMutation(internal.cjSourcingJobs.releaseTokenRefreshLease, { leaseToken });
                } catch (releaseError: unknown) {
                    // Releasing a short lease must never mask a successfully
                    // refreshed token. The lease expires automatically.
                    console.error(
                        "Failed to release CJ token refresh lease:",
                        releaseError instanceof Error ? releaseError.message : releaseError,
                    );
                }
            }
        } catch (error: any) {
            console.error("CJ Auth error:", error.message);
            return null;
        }
    },
});

/**
 * Refresh access token using refresh token (avoids rate limit)
 * CJ returns a new token object. Persist the provider's authoritative tokens
 * and expiry dates; never extend the old token locally.
 */
const fetchCjAuth = async (path: string, body: Record<string, string>) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CJ_AUTH_TIMEOUT_MS);
    try {
        return await fetch(`${CJ_API_BASE}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
};

async function refreshAccessToken(ctx: any, storedTokens: {
    openId?: string;
    refreshToken: string;
    refreshTokenExpiryDate: string;
}): Promise<string | null> {
    try {
        const response = await fetchCjAuth("/authentication/refreshAccessToken", {
            refreshToken: storedTokens.refreshToken,
        });

        const data = await response.json();
        const parsed = parseCjTokenResponse(data, storedTokens);

        if (response.ok && parsed.ok) {
            const tokenData = parsed.tokens;
            await ctx.runMutation(internal.cjHelpers.saveCjTokens, {
                openId: tokenData.openId,
                accessToken: tokenData.accessToken,
                accessTokenExpiryDate: tokenData.accessTokenExpiryDate,
                refreshToken: tokenData.refreshToken,
                refreshTokenExpiryDate: tokenData.refreshTokenExpiryDate,
                createDate: tokenData.createDate,
            });

            console.log("CJ: Refreshed access token; expires:", tokenData.accessTokenExpiryDate);
            return tokenData.accessToken;
        }

        const parseMessage = "message" in parsed ? parsed.message : undefined;
        console.error("CJ Refresh token failed:", data?.message || parseMessage || `HTTP ${response.status}`);
        return null;
    } catch (error: any) {
        console.error("CJ Refresh token error:", error.message);
        return null;
    }
}

/**
 * Request new tokens using API key (rate limited to 1 per 300 seconds)
 */
async function requestNewTokens(ctx: any, apiKey: string): Promise<string | null> {
    try {
        const response = await fetchCjAuth("/authentication/getAccessToken", { apiKey });

        const data = await response.json();
        const parsed = parseCjTokenResponse(data);
        if (!response.ok || !parsed.ok) {
            const parseMessage = "message" in parsed ? parsed.message : undefined;
            console.error("CJ Auth failed:", data?.message || parseMessage || `HTTP ${response.status}`);
            return null;
        }

        const tokenData = parsed.tokens;
        await ctx.runMutation(internal.cjHelpers.saveCjTokens, {
            openId: tokenData.openId,
            accessToken: tokenData.accessToken,
            accessTokenExpiryDate: tokenData.accessTokenExpiryDate,
            refreshToken: tokenData.refreshToken,
            refreshTokenExpiryDate: tokenData.refreshTokenExpiryDate,
            createDate: tokenData.createDate,
        });

        console.log("CJ: New tokens saved. Access expires:", tokenData.accessTokenExpiryDate, "Refresh expires:", tokenData.refreshTokenExpiryDate);
        return tokenData.accessToken;
    } catch (error: any) {
        console.error("CJ New token request error:", error.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDER CREATION
// ═══════════════════════════════════════════════════════════════════════════

interface CjOrderProduct {
    vid?: string; // CJ variant ID
    sku?: string; // CJ SKU
    quantity: number;
    productCost?: number;
    estimatedShippingCost?: number;
    retailPrice?: number;
}

const validateCjInventoryForOrder = async (
    ctx: any,
    accessToken: string,
    products: CjOrderProduct[],
): Promise<string[]> => {
    const errors: string[] = [];
    const checkedAt = new Date().toISOString();
    const lowStockThreshold = getInventoryLowStockThreshold();

    for (const product of products) {
        const label = product.vid ? `vid=${product.vid}` : `sku=${product.sku}`;
        await waitForCjInventoryRequestSlot(ctx);
        const inventoryResult = product.vid
            ? await getInventoryByVid(accessToken, product.vid)
            : product.sku
                ? await getInventoryBySku(accessToken, product.sku)
                : null;

        if (!inventoryResult) {
            errors.push(`Missing CJ variant or SKU for order item.`);
            continue;
        }

        if (inventoryResult.ok === false) {
            errors.push(`Unable to verify CJ inventory for ${label}: ${formatCjApiError(inventoryResult.error)}`);
            continue;
        }

        const snapshot = summarizeCjInventoryRows(normalizeInventoryRows(inventoryResult.data), {
            vid: product.vid,
            sku: product.sku,
            lastCheckedAt: checkedAt,
            lowStockThreshold,
        });

        if (snapshot.totalInventoryNum === undefined) {
            errors.push(`CJ inventory is unknown for ${label}.`);
        } else if (snapshot.totalInventoryNum < product.quantity) {
            errors.push(`Insufficient CJ inventory for ${label}: ${snapshot.totalInventoryNum} available, ${product.quantity} requested.`);
        }
    }

    return errors;
};

interface CjOrderRequest {
    orderNumber: string; // Your unique order ID
    shippingCustomerName: string;
    shippingPhone?: string;
    shippingAddress: string;
    shippingAddress2?: string;
    shippingCity: string;
    shippingProvince: string;
    shippingCountry: string;
    shippingCountryCode: string;
    shippingZip?: string;
    email?: string;
    logisticName: string; // Shipping method
    fromCountryCode: string;
    products: CjOrderProduct[];
    payType?: 1 | 2 | 3; // 1 = payment URL, 2 = balance payment, 3 = create only
    remark?: string;
}

const hasCjApiError = (result: unknown): result is { error: CjApiErrorDetails } =>
    typeof result === "object" && result !== null && "error" in result;

const cjResultErrorMessage = (result: unknown, fallback: string): string =>
    hasCjApiError(result) ? formatCjApiError(result.error) : fallback;

const firstString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
};

type CjInventoryTarget = {
    vid?: string;
    sku?: string;
};

type CjInventoryTargetOptions = {
    allowSingleIdentifier?: boolean;
};

const getInventoryLowStockThreshold = (): number => {
    const raw = process.env.CJ_LOW_STOCK_THRESHOLD?.trim();
    if (!raw) return 3;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitForCjInventoryRequestSlot = async (ctx: any) => {
    const slot = await ctx.runMutation(internal.cjHelpers.reserveCjDiagnosticRequestSlot, {
        spacingMs: CJ_API_REQUEST_SPACING_MS,
    });
    if (slot.waitMs > 0) {
        await sleep(slot.waitMs);
    }
};

const setInventoryTarget = (targets: Map<string, CjInventoryTarget>, target: CjInventoryTarget) => {
    if (target.vid) targets.set(`vid:${target.vid}`, target);
    if (target.sku) targets.set(`sku:${target.sku}`, target);
};

const addInventoryTarget = (
    targets: Map<string, CjInventoryTarget>,
    target: CjInventoryTarget,
    options: CjInventoryTargetOptions = {},
) => {
    const vid = firstString(target.vid);
    const sku = firstString(target.sku);
    if (!vid && !sku) return;
    if (!options.allowSingleIdentifier && (!vid || !sku)) {
        const existingByVid = vid ? targets.get(`vid:${vid}`) : undefined;
        const existingBySku = sku ? targets.get(`sku:${sku}`) : undefined;
        if (!existingByVid && !existingBySku) return;
    }

    const vidKey = vid ? `vid:${vid}` : undefined;
    const skuKey = sku ? `sku:${sku}` : undefined;
    const existing = (vidKey ? targets.get(vidKey) : undefined) ?? (skuKey ? targets.get(skuKey) : undefined);
    const merged = {
        vid: vid || existing?.vid,
        sku: sku || existing?.sku,
    };

    if (vidKey) targets.delete(vidKey);
    if (skuKey) targets.delete(skuKey);
    setInventoryTarget(targets, merged);
};

const getProductInventoryTargets = (
    product: any,
    filter: { variantId?: string; vid?: string; sku?: string } = {},
): CjInventoryTarget[] => {
    const targets = new Map<string, CjInventoryTarget>();

    if (filter.vid || filter.sku) {
        addInventoryTarget(targets, { vid: filter.vid, sku: filter.sku }, { allowSingleIdentifier: true });
        return [...new Set(targets.values())];
    }

    if (filter.variantId) {
        const selectedVariant = (product.variants ?? []).find((variant: any) => variant?.id === filter.variantId);
        addInventoryTarget(targets, {
            vid: selectedVariant?.cjVariantId,
            sku: selectedVariant?.cjSku,
        }, { allowSingleIdentifier: true });
        return [...new Set(targets.values())];
    }

    for (const cjVariant of product.cjVariants ?? []) {
        addInventoryTarget(targets, { vid: cjVariant?.vid, sku: cjVariant?.sku }, { allowSingleIdentifier: true });
    }

    for (const variant of product.variants ?? []) {
        addInventoryTarget(targets, { vid: variant?.cjVariantId, sku: variant?.cjSku }, {
            allowSingleIdentifier: targets.size === 0,
        });
    }

    addInventoryTarget(targets, { vid: product.cjVariantId, sku: product.cjSku }, {
        allowSingleIdentifier: targets.size === 0,
    });

    return [...new Set(targets.values())];
};

const sumSnapshotInventory = (snapshots: CjInventorySnapshot[]): number | undefined => {
    const totals = snapshots
        .map((snapshot) => snapshot.totalInventoryNum)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return totals.length > 0 ? totals.reduce((total, value) => total + value, 0) : undefined;
};

const normalizeInventoryRows = (value: unknown): CjInventoryRow[] =>
    Array.isArray(value) ? value.filter((row): row is CjInventoryRow => typeof row === "object" && row !== null) : [];

const getInventorySnapshotKey = (snapshot: CjInventorySnapshot): string =>
    snapshot.vid ? `vid:${snapshot.vid}` : snapshot.sku ? `sku:${snapshot.sku}` : "product";

const mergeInventorySnapshots = (
    existing: unknown,
    fresh: CjInventorySnapshot[],
): CjInventorySnapshot[] => {
    const existingSnapshots = Array.isArray(existing)
        ? existing.filter((snapshot): snapshot is CjInventorySnapshot => typeof snapshot === "object" && snapshot !== null)
        : [];
    const freshKeys = new Set(fresh.map(getInventorySnapshotKey));
    return [
        ...existingSnapshots.filter((snapshot) => !freshKeys.has(getInventorySnapshotKey(snapshot))),
        ...fresh,
    ];
};

export const refreshProductInventory = internalAction({
    args: {
        productId: v.optional(v.id("products")),
        variantId: v.optional(v.string()),
        vid: v.optional(v.string()),
        sku: v.optional(v.string()),
        limit: v.optional(v.number()),
        source: v.optional(v.union(
            v.literal("manual"),
            v.literal("checkout"),
            v.literal("cron"),
            v.literal("webhook")
        )),
    },
    handler: async (ctx, args): Promise<{
        eligible: number;
        deferredFresh: number;
        checked: number;
        updated: number;
        errors: number;
        products: Array<{
            productId: string;
            name: string;
            status: string;
            totalInventoryNum?: number;
            error?: string;
        }>;
    }> => {
        const startedAt = Date.now();
        const source = args.source ?? "manual";
        const plan = await ctx.runQuery(internal.cjHelpers.getProductsForInventoryRefresh, {
            productId: args.productId,
            variantId: args.variantId,
            limit: args.limit,
            source,
        });
        const products = plan.products;
        const recordRun = async (counts: {
            checked: number;
            updated: number;
            errors: number;
            providerTokenRequested: boolean;
        }) => ctx.runMutation(internal.cjHelpers.recordInventoryPollRun, {
            source,
            eligible: plan.eligible,
            deferredFresh: plan.deferredFresh,
            ...counts,
            durationMs: Date.now() - startedAt,
        });
        if (products.length === 0) {
            await recordRun({
                checked: 0,
                updated: 0,
                errors: 0,
                providerTokenRequested: false,
            });
            console.log("[CJ Inventory Poll]", JSON.stringify({ source, ...plan, products: undefined, checked: 0, empty: true }));
            return { eligible: plan.eligible, deferredFresh: plan.deferredFresh, checked: 0, updated: 0, errors: 0, products: [] };
        }

        const accessToken = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!accessToken) {
            await recordRun({
                checked: 0,
                updated: 0,
                errors: 1,
                providerTokenRequested: true,
            });
            return { eligible: plan.eligible, deferredFresh: plan.deferredFresh, checked: 0, updated: 0, errors: 1, products: [] };
        }
        const lowStockThreshold = getInventoryLowStockThreshold();
        const results: Array<{
            productId: string;
            name: string;
            status: string;
            totalInventoryNum?: number;
            error?: string;
        }> = [];
        let updated = 0;
        let errors = 0;

        try {
          for (const product of products) {
            const checkedAt = new Date().toISOString();
            const snapshots: CjInventorySnapshot[] = [];
            const targets = getProductInventoryTargets(product, {
                variantId: args.variantId,
                vid: args.vid,
                sku: args.sku,
            });

            for (const target of targets) {
                try {
                    await waitForCjInventoryRequestSlot(ctx);
                    const inventoryResult = target.vid
                        ? await getInventoryByVid(accessToken, target.vid)
                        : target.sku
                            ? await getInventoryBySku(accessToken, target.sku)
                            : null;

                    if (!inventoryResult) continue;
                    if (inventoryResult.ok === false) {
                        snapshots.push(createCjInventoryErrorSnapshot({
                            vid: target.vid,
                            sku: target.sku,
                            lastCheckedAt: checkedAt,
                            lowStockThreshold,
                            error: formatCjApiError(inventoryResult.error),
                        }));
                        continue;
                    }

                    snapshots.push(summarizeCjInventoryRows(normalizeInventoryRows(inventoryResult.data), {
                        vid: target.vid,
                        sku: target.sku,
                        lastCheckedAt: checkedAt,
                        lowStockThreshold,
                    }));
                } catch (error: unknown) {
                    snapshots.push(createCjInventoryErrorSnapshot({
                        vid: target.vid,
                        sku: target.sku,
                        lastCheckedAt: checkedAt,
                        lowStockThreshold,
                        error: error instanceof Error ? error.message : String(error),
                    }));
                }
            }

            if (snapshots.length === 0 && product.cjProductId) {
                await waitForCjInventoryRequestSlot(ctx);
                const inventoryResult = await getInventoryByPid(accessToken, product.cjProductId);
                if (inventoryResult.ok === false) {
                    snapshots.push(createCjInventoryErrorSnapshot({
                        lastCheckedAt: checkedAt,
                        lowStockThreshold,
                        error: formatCjApiError(inventoryResult.error),
                    }));
                } else {
                    const variantInventories = Array.isArray(inventoryResult.data?.variantInventories)
                        ? inventoryResult.data.variantInventories
                        : [];
                    for (const variantInventory of variantInventories) {
                        const rows = normalizeInventoryRows(variantInventory?.inventory ?? variantInventory?.inventories);
                        snapshots.push(summarizeCjInventoryRows(rows, {
                            vid: firstString(variantInventory?.vid, rows[0]?.vid),
                            sku: firstString(variantInventory?.sku, rows[0]?.sku),
                            lastCheckedAt: checkedAt,
                            lowStockThreshold,
                        }));
                    }

                    if (snapshots.length === 0) {
                        snapshots.push(summarizeCjInventoryRows(normalizeInventoryRows(inventoryResult.data?.inventories), {
                            lastCheckedAt: checkedAt,
                            lowStockThreshold,
                        }));
                    }
                }
            }

            const isTargetedRefresh = Boolean(args.variantId || args.vid || args.sku);
            const storedSnapshots = isTargetedRefresh
                ? mergeInventorySnapshots(product.cjInventoryByVariant, snapshots)
                : snapshots;
            const status = mergeCjInventoryStatuses(storedSnapshots);
            const totalInventoryNum = sumSnapshotInventory(storedSnapshots);
            const firstError = storedSnapshots.find((snapshot) => snapshot.status === "error")?.error;
            if (status === "error") {
                errors++;
            } else {
                updated++;
            }

            await ctx.runMutation(internal.cjHelpers.updateProductInventorySnapshot, {
                productId: product._id,
                status,
                totalInventoryNum,
                checkedAt,
                error: firstError,
                snapshots: storedSnapshots,
                source: args.source ?? "manual",
            });

            results.push({
                productId: product._id,
                name: product.name,
                status,
                totalInventoryNum,
                error: firstError,
            });
          }

          await recordRun({
            checked: products.length,
            updated,
            errors,
            providerTokenRequested: true,
          });
          console.log("[CJ Inventory Poll]", JSON.stringify({
              source,
              eligible: plan.eligible,
              deferredFresh: plan.deferredFresh,
              checked: products.length,
              updated,
              errors,
              durationMs: Date.now() - startedAt,
          }));
          return { eligible: plan.eligible, deferredFresh: plan.deferredFresh, checked: products.length, updated, errors, products: results };
        } catch (error) {
          try {
            await recordRun({
              checked: results.length,
              updated,
              errors: errors + 1,
              providerTokenRequested: true,
            });
          } catch (metricsError) {
            console.error("[CJ Inventory Poll] Failed to record error metrics", metricsError);
          }
          throw error;
        }
    },
});

const isPaidLikeCjOrderDetail = (detail: any): boolean => {
    const statusText = [
        detail?.orderStatus,
        detail?.status,
        detail?.paymentStatus,
        detail?.payStatus,
    ]
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value).toLowerCase())
        .join(" ");

    return ["paid", "processing", "shipped", "delivered"].some((status) => statusText.includes(status));
};

const markCjFulfillmentFailed = async (
    ctx: any,
    orderId: any,
    automationMode: "create_only" | "manual_payment" | "balance_payment",
    errorMsg: string,
    cjOrderId?: string,
    resumeStep?: CjFulfillmentStep,
) => {
    await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
        orderId,
        cjStatus: "failed",
        cjOrderId,
        cjError: errorMsg,
        cjAutomationMode: automationMode,
        cjFulfillmentStep: resumeStep,
        cjPaymentStatus: "failed",
    });
};

/**
 * Create an order in CJ Dropshipping
 */
export const createCjOrder = internalAction({
    args: {
        orderId: v.id("orders"),
        orderNumber: v.string(),
        customerName: v.string(),
        customerPhone: v.optional(v.string()),
        customerEmail: v.string(),
        shippingAddress: v.object({
            line1: v.string(),
            line2: v.optional(v.string()),
            city: v.string(),
            state: v.optional(v.string()),
            postalCode: v.string(),
            country: v.string(),
        }),
        products: v.array(v.object({
            vid: v.optional(v.string()),
            sku: v.optional(v.string()),
            quantity: v.number(),
            productCost: v.optional(v.number()),
            estimatedShippingCost: v.optional(v.number()),
            retailPrice: v.optional(v.number()),
        })),
        customerShippingCollected: v.optional(v.number()),
        orderSubtotal: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{ success: boolean; cjOrderId?: string; error?: string }> => {
        const automationConfig = getCjAutomationConfig(process.env);
        const idempotencyKey = `${args.orderId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const reservation = await ctx.runMutation(internal.cjHelpers.reserveCjFulfillmentAttempt, {
            orderId: args.orderId,
            automationMode: automationConfig.mode,
            idempotencyKey,
        });

        if (!reservation.reserved) {
            if (reservation.reason === "not_found") {
                return { success: false, error: "Order not found for CJ fulfillment" };
            }
            if (reservation.reason === "in_progress") {
                return {
                    success: false,
                    cjOrderId: reservation.order?.cjOrderId,
                    error: "CJ fulfillment already in progress",
                };
            }
            return { success: true, cjOrderId: reservation.order?.cjOrderId };
        }
        const existingOrder = reservation.order;

        // Get access token
        const accessToken = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!accessToken) {
            await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                orderId: args.orderId,
                cjStatus: "failed",
                cjError: "Failed to authenticate with CJ API",
                cjAutomationMode: automationConfig.mode,
                cjFulfillmentStep: "failed",
                cjPaymentStatus: "failed",
            });
            return { success: false, error: "Failed to authenticate with CJ API" };
        }

        // Map country name to code (basic mapping)
        const countryCode = getCountryCode(args.shippingAddress.country);
        const cjOrderProducts = args.products
            .filter(p => p.vid || p.sku)
            .map(p => ({
                vid: p.vid,
                sku: p.sku,
                quantity: p.quantity,
            }));

        // Validate we have products to ship
        if (cjOrderProducts.length === 0) {
            await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                orderId: args.orderId,
                cjStatus: "failed",
                cjError: "No CJ products found in order (missing vid/sku)",
                cjAutomationMode: automationConfig.mode,
                cjFulfillmentStep: "failed",
                cjPaymentStatus: "failed",
            });
            return { success: false, error: "No CJ products found in order" };
        }

        const inventoryErrors = await validateCjInventoryForOrder(ctx, accessToken, cjOrderProducts);
        if (inventoryErrors.length > 0) {
            const errorMsg = inventoryErrors.join(" ");
            await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                orderId: args.orderId,
                cjStatus: "failed",
                cjError: errorMsg,
                cjAutomationMode: automationConfig.mode,
                cjFulfillmentStep: "failed",
                cjPaymentStatus: "failed",
            });
            return { success: false, error: errorMsg };
        }

        const freightQuote = await quoteCjFreightForProducts(accessToken, args.products, countryCode);
        const reconciliation = calculateOrderPricingReconciliation({
            items: args.products,
            quotedShippingCost: freightQuote?.shippingCost,
            quotedTaxesFee: freightQuote?.taxesFee,
            quotedClearanceFee: freightQuote?.clearanceFee,
            customerShippingCollected: args.customerShippingCollected,
            orderSubtotal: args.orderSubtotal,
            freightQuoteAvailable: freightQuote?.shippingCost !== undefined,
        });

        // Build CJ order request
        const cjOrder: CjOrderRequest = {
            orderNumber: args.orderNumber,
            shippingCustomerName: args.customerName,
            shippingPhone: args.customerPhone || "",
            shippingAddress: args.shippingAddress.line1,
            shippingAddress2: args.shippingAddress.line2 || "",
            shippingCity: args.shippingAddress.city,
            shippingProvince: args.shippingAddress.state || args.shippingAddress.city,
            shippingCountry: args.shippingAddress.country,
            shippingCountryCode: countryCode,
            shippingZip: args.shippingAddress.postalCode,
            email: args.customerEmail,
            logisticName: freightQuote?.logisticsName || "CJ Packet Ordinary",
            fromCountryCode: "CN", // Ship from China
            products: cjOrderProducts,
            payType: 3, // Create CJ order only; payment/fulfillment must be completed separately.
        };

        let cjOrderId = existingOrder?.cjOrderId;
        let shipmentOrderId = existingOrder?.cjShipmentOrderId;
        let payId = existingOrder?.cjPayId;
        let paymentAmount = existingOrder?.cjPaymentAmount;
        const existingStep = existingOrder?.cjFulfillmentStep;
        let resumeStep: CjFulfillmentStep | undefined =
            hasReachedCjStep(existingStep, "not_started") ? existingStep as CjFulfillmentStep : undefined;

        try {
            if (!cjOrderId) {
                // Mark order as sending
                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "sending",
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "creating_order",
                    cjPaymentStatus: "not_started",
                    cjQuotedProductCost: reconciliation.productCostTotal,
                    cjQuotedShippingCost: freightQuote?.shippingCost,
                    cjQuotedTaxesFee: reconciliation.taxesFee,
                    cjQuotedClearanceFee: reconciliation.clearanceFee,
                    cjQuotedLandedCost: reconciliation.landedCost,
                    cjQuotedLogisticsName: freightQuote?.logisticsName || cjOrder.logisticName,
                    cjCustomerShippingCollected: reconciliation.customerShippingCollected,
                    cjEstimatedProfit: reconciliation.estimatedProfit,
                    cjPricingWarnings: reconciliation.warnings,
                    cjRawPricingResponse: freightQuote?.rawResponse,
                });

                const createOrderResult = await createOrderV2(accessToken, cjOrder);
                if (!createOrderResult.ok || !createOrderResult.data?.orderId) {
                    const errorMsg = cjResultErrorMessage(createOrderResult, "CJ order creation succeeded but did not return an orderId");
                    await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg);
                    console.error("CJ Order creation failed:", errorMsg);
                    return { success: false, error: errorMsg };
                }

                cjOrderId = createOrderResult.data.orderId;
                shipmentOrderId = createOrderResult.data.shipmentOrderId;
                paymentAmount = toFiniteNumber(createOrderResult.data.actualPayment ?? createOrderResult.data.orderAmount);

                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "order_created",
                    cjPaymentStatus: automationConfig.autoFulfillmentEnabled ? "not_started" : "manual_payment_required",
                    cjShipmentOrderId: shipmentOrderId,
                    cjPaymentUrl: createOrderResult.data.cjPayUrl,
                    cjPaymentAmount: paymentAmount,
                });
                resumeStep = "order_created";

                console.log(`CJ Order created: ${cjOrderId}`);
            }

            if (!automationConfig.autoFulfillmentEnabled) {
                return { success: true, cjOrderId };
            }

            if (!hasReachedCjStep(existingStep, "cart_added")) {
                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "adding_to_cart",
                    cjPaymentStatus: "not_started",
                });

                const addCartResult = await addCart(accessToken, [cjOrderId]);
                if (!addCartResult.ok) {
                    const errorMsg = cjResultErrorMessage(addCartResult, "CJ add cart failed");
                    await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg, cjOrderId, "order_created");
                    return { success: false, cjOrderId, error: errorMsg };
                }

                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "cart_added",
                    cjPaymentStatus: "not_started",
                });
                resumeStep = "cart_added";
            }

            if (!hasReachedCjStep(existingStep, "cart_confirmed")) {
                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "confirming_cart",
                    cjPaymentStatus: "not_started",
                });

                const confirmCartResult = await addCartConfirm(accessToken, [cjOrderId]);
                if (!confirmCartResult.ok) {
                    const errorMsg = cjResultErrorMessage(confirmCartResult, "CJ cart confirmation failed");
                    await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg, cjOrderId, "cart_added");
                    return { success: false, cjOrderId, error: errorMsg };
                }

                shipmentOrderId = firstString(
                    shipmentOrderId,
                    (confirmCartResult.data as any)?.shipmentsId,
                    (confirmCartResult.data as any)?.shipmentOrderId,
                );

                if (!shipmentOrderId) {
                    const errorMsg = "CJ cart confirmation did not return a shipment order ID";
                    await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg, cjOrderId, "cart_added");
                    return { success: false, cjOrderId, error: errorMsg };
                }

                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "cart_confirmed",
                    cjPaymentStatus: "not_started",
                    cjShipmentOrderId: shipmentOrderId,
                    cjParentOrderId: shipmentOrderId,
                });
                resumeStep = "cart_confirmed";
            }

            if (!payId) {
                if (!shipmentOrderId) {
                    const errorMsg = "CJ payment order generation requires shipmentOrderId";
                    await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg, cjOrderId, "cart_added");
                    return { success: false, cjOrderId, error: errorMsg };
                }

                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "generating_payment_order",
                    cjPaymentStatus: "not_started",
                    cjShipmentOrderId: shipmentOrderId,
                });

                const parentOrderResult = await saveGenerateParentOrder(accessToken, shipmentOrderId);
                if (!parentOrderResult.ok) {
                    const errorMsg = cjResultErrorMessage(parentOrderResult, "CJ payment order generation failed");
                    await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg, cjOrderId, "cart_confirmed");
                    return { success: false, cjOrderId, error: errorMsg };
                }

                payId = parentOrderResult.data?.payId;
                if (!payId) {
                    const errorMsg = "CJ payment order generation did not return payId";
                    await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg, cjOrderId, "cart_confirmed");
                    return { success: false, cjOrderId, error: errorMsg };
                }
                paymentAmount = toFiniteNumber(
                    parentOrderResult.data?.paymentInformation?.actualPayment ??
                    parentOrderResult.data?.paymentInformation?.payableAmount ??
                    parentOrderResult.data?.orderMoney ??
                    paymentAmount
                );

                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "payment_order_generated",
                    cjPaymentStatus: automationConfig.balancePaymentReady ? "balance_payment_ready" : "manual_payment_required",
                    cjShipmentOrderId: shipmentOrderId,
                    cjParentOrderId: shipmentOrderId,
                    cjPayId: payId,
                    cjPaymentAmount: paymentAmount,
                });
                resumeStep = "payment_order_generated";
            }

            if (!automationConfig.balancePaymentReady) {
                return { success: true, cjOrderId };
            }

            if (!shipmentOrderId || !payId) {
                const errorMsg = "CJ balance payment requires shipmentOrderId and payId";
                await markCjFulfillmentFailed(ctx, args.orderId, automationConfig.mode, errorMsg, cjOrderId, "payment_order_generated");
                return { success: false, cjOrderId, error: errorMsg };
            }

            const previousPaymentWasSubmitted = existingOrder?.cjPaymentStatus === "balance_payment_submitted";
            const previousPaymentWasAttempting =
                existingOrder?.cjPaymentStatus === "balance_payment_attempting" ||
                hasReachedCjStep(existingStep, "paying_balance");
            if (previousPaymentWasSubmitted || previousPaymentWasAttempting) {
                const detailResult = await getOrderDetail(accessToken, cjOrderId);
                if (detailResult.ok && isPaidLikeCjOrderDetail(detailResult.data)) {
                    await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                        orderId: args.orderId,
                        cjStatus: "processing",
                        cjOrderId,
                        cjAutomationMode: automationConfig.mode,
                        cjFulfillmentStep: "paid",
                        cjPaymentStatus: "paid",
                        cjShipmentOrderId: shipmentOrderId,
                        cjPayId: payId,
                        cjPaymentAmount: paymentAmount,
                        cjAutoPaymentError: "",
                    });
                    return { success: true, cjOrderId };
                }

                if (previousPaymentWasSubmitted || !detailResult.ok) {
                    const errorMsg = detailResult.ok
                        ? "CJ balance payment state is ambiguous and requires manual reconciliation"
                        : cjResultErrorMessage(detailResult, "Failed to reconcile CJ balance payment state");
                    await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                        orderId: args.orderId,
                        cjStatus: "failed",
                        cjOrderId,
                        cjError: errorMsg,
                        cjAutomationMode: automationConfig.mode,
                        cjFulfillmentStep: previousPaymentWasSubmitted ? "payment_order_generated" : "paying_balance",
                        cjPaymentStatus: previousPaymentWasSubmitted ? "balance_payment_submitted" : "balance_payment_attempting",
                        cjAutoPaymentError: errorMsg,
                    });
                    return { success: false, cjOrderId, error: errorMsg };
                }

                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "confirmed",
                    cjOrderId,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "payment_order_generated",
                    cjPaymentStatus: "balance_payment_ready",
                    cjAutoPaymentError: "",
                });
            }

            await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                orderId: args.orderId,
                cjStatus: "confirmed",
                cjOrderId,
                cjAutomationMode: automationConfig.mode,
                cjFulfillmentStep: "paying_balance",
                cjPaymentStatus: "balance_payment_attempting",
                cjShipmentOrderId: shipmentOrderId,
                cjPayId: payId,
                cjAutoPaymentAttemptedAt: new Date().toISOString(),
            });

            const paymentResult = await payBalanceV2(accessToken, { shipmentOrderId, payId });
            if (!paymentResult.ok) {
                const errorMsg = cjResultErrorMessage(paymentResult, "CJ balance payment failed");
                if (hasCjApiError(paymentResult) && paymentResult.error.httpStatus === undefined) {
                    await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                        orderId: args.orderId,
                        cjStatus: "failed",
                        cjOrderId,
                        cjError: errorMsg,
                        cjAutomationMode: automationConfig.mode,
                        cjFulfillmentStep: "paying_balance",
                        cjPaymentStatus: "balance_payment_submitted",
                        cjAutoPaymentError: errorMsg,
                    });
                    return { success: false, cjOrderId, error: errorMsg };
                }

                await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                    orderId: args.orderId,
                    cjStatus: "failed",
                    cjOrderId,
                    cjError: errorMsg,
                    cjAutomationMode: automationConfig.mode,
                    cjFulfillmentStep: "payment_order_generated",
                    cjPaymentStatus: "failed",
                    cjAutoPaymentError: errorMsg,
                });
                return { success: false, cjOrderId, error: errorMsg };
            }

            await ctx.runMutation(internal.cjHelpers.updateOrderCjStatus, {
                orderId: args.orderId,
                cjStatus: "processing",
                cjOrderId,
                cjAutomationMode: automationConfig.mode,
                cjFulfillmentStep: "paid",
                cjPaymentStatus: "paid",
                cjShipmentOrderId: shipmentOrderId,
                cjPayId: payId,
                cjPaymentAmount: paymentAmount,
                cjAutoPaymentError: "",
            });
            resumeStep = "paid";

            return { success: true, cjOrderId };
        } catch (error: any) {
            const errorMsg = error.message || "Network error contacting CJ API";
            await markCjFulfillmentFailed(
                ctx,
                args.orderId,
                automationConfig.mode,
                errorMsg,
                cjOrderId,
                resumeStep,
            );

            console.error("CJ Order error:", error);
            return { success: false, error: errorMsg };
        }
    },
});

// ═══════════════════════════════════════════════════════════════════════════
export const refreshConfirmedProductPricing = internalAction({
    args: {
        productId: v.id("products"),
        cjProductId: v.string(),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        sourcingId: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
        const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!token) {
            return { success: false, error: "Failed to authenticate with CJ API" };
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CJ_FETCH_TIMEOUT_MS);
            let response: Response;
            try {
                response = await fetch(
                    `${CJ_API_BASE}/product/query?pid=${encodeURIComponent(args.cjProductId)}`,
                    {
                        method: "GET",
                        headers: {
                            "Content-Type": "application/json",
                            "CJ-Access-Token": token,
                        },
                        signal: controller.signal,
                    }
                );
            } finally {
                clearTimeout(timeout);
            }

            const data = await response.json();
            if (!data?.result || !data?.data) {
                return { success: false, error: data?.message || "CJ product query returned no catalog data" };
            }

            const variants = data.data.variants || [];
            const resolvedVariant =
                (args.cjVariantId ? variants.find((variant: any) => String(variant?.vid) === args.cjVariantId) : null) ||
                (args.cjSku ? variants.find((variant: any) => variant?.variantSku === args.cjSku) : null) ||
                (variants.length === 1 ? variants[0] : null);
            const resolvedVariantId = resolvedVariant?.vid ? String(resolvedVariant.vid) : args.cjVariantId;
            const resolvedSku = typeof resolvedVariant?.variantSku === "string" ? resolvedVariant.variantSku : args.cjSku;
            const confirmedCjCost = extractCjVariantPrice(resolvedVariant);
            const freightQuote = await quoteCjFreightForVariant(token, resolvedVariantId);

            await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                productId: args.productId,
                status: "approved",
                cjProductId: data.data.pid || args.cjProductId,
                cjVariantId: resolvedVariantId,
                cjSku: resolvedSku,
                sourcingId: args.sourcingId,
                confirmedCjCost,
                confirmedCjShippingCost: freightQuote?.shippingCost,
                confirmedCjTaxesFee: freightQuote?.taxesFee,
                confirmedCjClearanceFee: freightQuote?.clearanceFee,
                confirmedCjLogisticsName: freightQuote?.logisticsName,
                cjRawPricingResponse: freightQuote?.rawResponse,
            });

            return { success: true };
        } catch (error: any) {
            return { success: false, error: error?.message || "Failed to refresh CJ pricing" };
        }
    },
});

export const refreshConfirmedProductPricingWithRetry = internalAction({
    args: {
        productId: v.id("products"),
        cjProductId: v.string(),
        cjVariantId: v.optional(v.string()),
        cjSku: v.optional(v.string()),
        sourcingId: v.optional(v.string()),
        attempt: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{
        success: boolean;
        error?: string;
        retryScheduled?: boolean;
    }> => {
        const attempt = Math.max(1, Math.floor(args.attempt ?? 1));
        let result: { success: boolean; error?: string };

        try {
            result = await ctx.runAction(internal.cjDropshipping.refreshConfirmedProductPricing, {
                productId: args.productId,
                cjProductId: args.cjProductId,
                cjVariantId: args.cjVariantId,
                cjSku: args.cjSku,
                sourcingId: args.sourcingId,
            });
        } catch (error: any) {
            result = { success: false, error: error?.message || "Failed to refresh CJ pricing" };
        }

        if (result.success) {
            return { success: true };
        }

        const error = result.error || "Failed to refresh CJ pricing";
        if (attempt < CJ_PRICING_REFRESH_MAX_ATTEMPTS) {
            await ctx.scheduler.runAfter(
                CJ_PRICING_REFRESH_RETRY_DELAY_MS * attempt,
                internal.cjDropshipping.refreshConfirmedProductPricingWithRetry,
                {
                    productId: args.productId,
                    cjProductId: args.cjProductId,
                    cjVariantId: args.cjVariantId,
                    cjSku: args.cjSku,
                    sourcingId: args.sourcingId,
                    attempt: attempt + 1,
                }
            );

            console.warn(
                `CJ pricing refresh failed for product ${args.productId} on attempt ${attempt}; retry scheduled: ${error}`
            );
            return { success: false, error, retryScheduled: true };
        }

        await ctx.runMutation(internal.cjHelpers.recordProductPricingRefreshFailure, {
            productId: args.productId,
            error,
        });
        console.error(`CJ pricing refresh failed permanently for product ${args.productId}: ${error}`);

        return { success: false, error };
    },
});

// TRACKING SYNC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch tracking information for a CJ order
 */
export const getTrackingInfo = internalAction({
    args: {
        orderId: v.id("orders"),
        cjOrderId: v.string(),
    },
    handler: async (ctx, args): Promise<{
        success: boolean;
        trackingNumber?: string;
        trackingUrl?: string;
        carrier?: string;
        cjTrackingStatus?: string;
        estimatedDelivery?: string;
        status?: string;
        error?: string
    }> => {
        const accessToken = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!accessToken) {
            return { success: false, error: "Failed to authenticate with CJ API" };
        }

        try {
            const orderDetailResult = await getOrderDetail(
                accessToken,
                args.cjOrderId,
                undefined,
                { timeoutMs: CJ_FETCH_TIMEOUT_MS },
            );
            if ("error" in orderDetailResult) {
                return { success: false, error: formatCjApiError(orderDetailResult.error) };
            }

            const orderDetail = orderDetailResult.data;
            const trackNumber = getTrackNumberFromOrderDetail(orderDetail);
            let trackingRows: CjTrackingInfoRow[] = [];

            if (trackNumber) {
                const trackingResult = await getCjTrackingInfo(
                    accessToken,
                    trackNumber,
                    { timeoutMs: CJ_FETCH_TIMEOUT_MS },
                );
                if ("error" in trackingResult) {
                    console.warn(
                        `CJ tracking lookup failed for order ${args.cjOrderId}, track ${trackNumber}: ${formatCjApiError(trackingResult.error)}`
                    );
                } else {
                    trackingRows = Array.isArray(trackingResult.data) ? trackingResult.data : [];
                }
            }

            const reconciled = reconcileCjTracking(orderDetail, trackingRows);

            await ctx.runMutation(internal.cjHelpers.updateOrderTracking, {
                orderId: args.orderId,
                trackingNumber: reconciled.trackingNumber,
                trackingUrl: reconciled.trackingUrl,
                carrier: reconciled.carrier,
                cjTrackingStatus: reconciled.cjTrackingStatus,
                estimatedDelivery: reconciled.estimatedDelivery,
                cjStatus: reconciled.cjStatus,
                orderStatus: reconciled.orderStatus,
            });

            return {
                success: true,
                trackingNumber: reconciled.trackingNumber,
                trackingUrl: reconciled.trackingUrl,
                carrier: reconciled.carrier,
                cjTrackingStatus: reconciled.cjTrackingStatus,
                estimatedDelivery: reconciled.estimatedDelivery,
                status: reconciled.cjStatus,
            };
        } catch (error: any) {
            console.error("CJ Tracking fetch error:", error);
            return { success: false, error: error.message };
        }
    },
});

/**
 * Sync tracking for all orders that need updates
 */
export const syncAllTracking = internalAction({
    args: {},
    handler: async (ctx): Promise<{ synced: number; errors: number }> => {
        // Get orders that need tracking sync
        const ordersToSync = await ctx.runQuery(internal.cjHelpers.getOrdersNeedingSync, {});

        let synced = 0;
        let errors = 0;

        for (const order of ordersToSync) {
            if (!order.cjOrderId) continue;

            try {
                const result = await ctx.runAction(internal.cjDropshipping.getTrackingInfo, {
                    orderId: order._id,
                    cjOrderId: order.cjOrderId,
                });

                if (result.success) {
                    synced++;
                }

                if (result.success && result.trackingNumber && result.trackingNumber !== order.trackingNotificationSentFor) {
                    // Send shipping notification email
                    const emailResult = await ctx.runAction(internal.emails.sendShippingNotification, {
                        customerEmail: order.customerEmail,
                        customerName: order.customerName || undefined,
                        orderId: order.stripeSessionId.slice(-12).toUpperCase(),
                        trackingNumber: result.trackingNumber,
                        trackingUrl: result.trackingUrl || "",
                        carrier: result.carrier || "Standard Shipping",
                        estimatedDelivery: result.estimatedDelivery,
                    });
                    if (emailResult.success) {
                        await ctx.runMutation(internal.cjHelpers.markTrackingNotificationSent, {
                            orderId: order._id,
                            trackingNumber: result.trackingNumber,
                        });
                    } else {
                        errors++;
                        console.error(`Shipping notification failed for order ${order._id}: ${emailResult.error}`);
                    }
                }
            } catch (error) {
                errors++;
                console.error(`Failed to sync tracking for order ${order._id}:`, error);
            }
        }

        console.log(`Tracking sync complete: ${synced} updated, ${errors} errors`);
        return { synced, errors };
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map country name to ISO 2-letter code
 */
function getCountryCode(country: string): string {
    const countryMap: Record<string, string> = {
        "United States": "US",
        "USA": "US",
        "US": "US",
        "Canada": "CA",
        "United Kingdom": "GB",
        "UK": "GB",
        "GB": "GB",
        "Australia": "AU",
        "Germany": "DE",
        "France": "FR",
        "Italy": "IT",
        "Spain": "ES",
        "Netherlands": "NL",
        "Belgium": "BE",
        "Austria": "AT",
        "Switzerland": "CH",
        "Sweden": "SE",
        "Norway": "NO",
        "Denmark": "DK",
        "Finland": "FI",
        "Ireland": "IE",
        "Portugal": "PT",
        "Poland": "PL",
        "Japan": "JP",
        "South Korea": "KR",
        "Mexico": "MX",
        "Brazil": "BR",
        "New Zealand": "NZ",
        "Singapore": "SG",
    };

    const upperCountry = country.toUpperCase();
    return countryMap[country] || countryMap[upperCountry] || upperCountry.slice(0, 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT SOURCING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit a product URL (e.g. AliExpress) to CJ for sourcing
 * CJ will add it to their catalog and provide a vid/sku
 */
export const submitForSourcing = internalAction({
    args: {
        productId: v.id("products"),
        productUrl: v.string(),
        productName: v.string(),
        productImage: v.optional(v.string()),
        productDescription: v.optional(v.string()),
        targetPrice: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{ success: boolean; sourcingId?: string; error?: string }> => {
        const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!token) {
            return { success: false, error: "Failed to authenticate with CJ API" };
        }

        try {
            const payloadResult = buildCjSourcingPayload({
                productUrl: args.productUrl,
                productName: args.productName,
                productImage: args.productImage,
                remark: args.productDescription,
                price: args.targetPrice,
                thirdProductId: String(args.productId),
            });
            if ("code" in payloadResult) {
                await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                    productId: args.productId,
                    status: "pending",
                    error: `${payloadResult.code}: ${payloadResult.message}`,
                });
                return { success: false, error: payloadResult.message };
            }

            const result = await createSourcing(token, payloadResult.payload, { timeoutMs: CJ_FETCH_TIMEOUT_MS });
            const responseData = result.ok ? result.data : undefined;
            const sourcingId = typeof responseData === "string"
                ? responseData
                : responseData?.cjSourcingId || responseData?.sourcingId || responseData?.id;

            if (result.ok && sourcingId) {
                // Update product with sourcing ID
                await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                    productId: args.productId,
                    status: "pending",
                    sourcingId: String(sourcingId),
                });

                // Set submission timestamp for admin tracking
                await ctx.runMutation(internal.cjHelpers.updateProductSubmittedAt, {
                    productId: args.productId,
                });

                console.log(`CJ Sourcing submitted for product ${args.productId}: ${sourcingId}`);
                return { success: true, sourcingId: String(sourcingId) };
            } else {
                const errorMsg = "error" in result
                    ? formatCjApiError(result.error)
                    : "CJ accepted the request but did not return a sourcing ID; reconciliation is required.";
                console.error(`CJ Sourcing failed for product ${args.productId}: ${errorMsg}`);
                await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                    productId: args.productId,
                    status: "pending",
                    error: errorMsg,
                });
                return { success: false, error: errorMsg };
            }
        } catch (error: any) {
            console.error("CJ Sourcing error:", error.message);
            return { success: false, error: error.message };
        }
    },
});

/**
 * Check the status of pending sourcing requests
 * Called by cron job every 2 hours
 * Also auto-submits pending products that haven't been submitted yet
 * 
 * IMPORTANT: Also re-checks products previously marked "rejected" because
 * CJ's sourcing ticket lifecycle can cause premature rejections:
 * - CJ receives sourcing request, status = 1 (pending)
 * - CJ processes it, status = 2 (processing)
 * - CJ sources the product, adds it to catalog, sends success email
 * - CJ closes / archives the sourcing ticket, status = 4 or 5 ("failed")
 * If the cron runs while the ticket is in status 4/5 but BEFORE the
 * verification catches the product in the catalog, we incorrectly reject.
 * Re-checking rejected products fixes this race condition.
 */
export const checkSourcingStatus = internalAction({
    args: {},
    handler: async (ctx): Promise<{ checked: number; approved: number; rejected: number; submitted: number; stalePendingResubmitted: number }> => {
        const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!token) {
            console.error("CJ: Cannot check sourcing status - auth failed");
            return { checked: 0, approved: 0, rejected: 0, submitted: 0, stalePendingResubmitted: 0 };
        }

        // Get products pending sourcing approval
        const allPendingProducts = await ctx.runQuery(internal.cjHelpers.getProductsPendingSourcing, {});
        const pendingProducts = [...allPendingProducts]
            .sort((a, b) => (a.cjLastCheckedAt || "").localeCompare(b.cjLastCheckedAt || ""))
            .slice(0, MAX_PENDING_BATCH);

        // Also re-check rejected products — they may have been prematurely
        // rejected due to CJ's ticket lifecycle (status 4/5 before catalog indexing)
        const allRejected = await ctx.runQuery(internal.cjHelpers.getRejectedProductsForRecheck, {});

        // Cap rejected rechecks: only include rejections within RECHECK_WINDOW_DAYS
        // that haven't been checked in the last 10 minutes (cooldown).
        // Sort oldest-checked-first so every rejected product eventually gets a pass,
        // preventing recently-checked items from starving the backlog.
        const recheckCutoff = new Date(Date.now() - RECHECK_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const cooldownCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min cooldown
        const rejectedProducts = allRejected
            .filter(p => {
                // Allow rows with no timestamps through at least once (never checked)
                const lastActivity = p.cjRejectedAt || p.cjSubmittedAt;
                if (!lastActivity) return true; // never checked — always include
                // Only include if within the recheck window
                return lastActivity >= recheckCutoff;
            })
            .filter(p => {
                // Cooldown: skip items checked very recently to avoid hammering
                // the same products every cron cycle
                if (!p.cjLastCheckedAt) return true; // never checked — no cooldown
                return p.cjLastCheckedAt < cooldownCutoff;
            })
            .sort((a, b) => {
                // Sort oldest-checked-first so every product eventually gets rechecked.
                // Missing timestamps are treated as epoch 0 (highest priority).
                const aLastChecked = a.cjLastCheckedAt || "";
                const bLastChecked = b.cjLastCheckedAt || "";
                return aLastChecked.localeCompare(bLastChecked);
            })
            .slice(0, MAX_RECHECK_BATCH);

        if (allRejected.length > rejectedProducts.length) {
            console.log(`CJ Recheck: capped rejected batch to ${rejectedProducts.length}/${allRejected.length} (window=${RECHECK_WINDOW_DAYS}d, cap=${MAX_RECHECK_BATCH})`);
        }

        let approved = 0;
        let rejected = 0;
        let submitted = 0;
        let stalePendingResubmitted = 0;

        // Combine pending (for submission + check) and rejected (for re-check only)
        // Rejected products already have cjSourcingId so they skip the submission step
        const allProducts = [...pendingProducts, ...rejectedProducts];

        // Deduplicate in case a product appears in both queries
        const seen = new Set<string>();
        const deduped = allProducts.filter(p => {
            if (seen.has(p._id)) return false;
            seen.add(p._id);
            return true;
        });

        for (const product of deduped) {
            // If product doesn't have a cjSourcingId yet, auto-submit it to CJ
            if (!product.cjSourcingId && product.sourceUrl) {
                try {
                    const payloadResult = buildCjSourcingPayload({
                        productUrl: product.sourceUrl,
                        productName: product.name,
                        productImage: product.images?.[0],
                        remark: product.description,
                        price: product.price,
                        thirdProductId: String(product._id),
                    });
                    if ("code" in payloadResult) {
                        await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                            productId: product._id,
                            status: "pending",
                            error: `${payloadResult.code}: ${payloadResult.message}`,
                            expectedStatus: product.cjSourcingStatus,
                        });
                        console.warn(`CJ Auto-submit validation failed for ${product.name}: ${payloadResult.code}`);
                        continue;
                    }

                    const result = await createSourcing(token, payloadResult.payload, { timeoutMs: CJ_FETCH_TIMEOUT_MS });
                    const responseData = result.ok ? result.data : undefined;
                    const sourcingId = typeof responseData === "string"
                        ? responseData
                        : responseData?.cjSourcingId || responseData?.sourcingId || responseData?.id;

                    if (result.ok && sourcingId) {
                        // Update product with sourcing ID
                        await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                            productId: product._id,
                            status: "pending",
                            sourcingId: String(sourcingId),
                        });
                        // Persist submission timestamp so this product qualifies for
                        // recheck batching/sorting if it's later false-rejected.
                        await ctx.runMutation(internal.cjHelpers.updateProductSubmittedAt, {
                            productId: product._id,
                        });
                        submitted++;
                        console.log(`CJ Auto-submitted: ${product.name} -> cjSourcingId=${sourcingId}`);
                    } else {
                        const errorMessage = "error" in result
                            ? formatCjApiError(result.error)
                            : "CJ accepted the request but did not return a sourcing ID; reconciliation is required.";
                        await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                            productId: product._id,
                            status: "pending",
                            error: errorMessage,
                            expectedStatus: product.cjSourcingStatus,
                        });
                        console.error(`CJ Auto-submit failed for ${product.name}: ${errorMessage}`);
                    }
                } catch (error: any) {
                    console.error(`Error auto-submitting ${product.name}:`, error.message);
                }

                // CJ allows roughly 1 request/second; leave margin between products.
                await new Promise(resolve => setTimeout(resolve, CJ_API_REQUEST_SPACING_MS));
                continue; // Move to next product
            }

            // If product already has cjSourcingId, check its status
            if (!product.cjSourcingId) continue;

            try {
                // Query CJ for sourcing status - per CJ docs: POST with sourceIds array
                const response = await fetch(`${CJ_API_BASE}/product/sourcing/query`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "CJ-Access-Token": token,
                    },
                    body: JSON.stringify({
                        sourceIds: [product.cjSourcingId],
                    }),
                });

                const data = await response.json();
                console.log(`CJ Sourcing query for ${product.name}:`, JSON.stringify(data, null, 2));

                if (data.result && data.data) {
                    // Response can be an array or single object
                    const sourcing = Array.isArray(data.data) ? data.data[0] : data.data;

                    if (sourcing) {
                        // Per CJ docs: sourceStatus is the status field
                        // Status values: 1=pending, 2=processing, 3=success, 4=failed, 5=search failed, 9=sourcing succeeded
                        const statusIsSuccess = sourcing.sourceStatus === "3" ||
                            sourcing.sourceStatus === 3 ||
                            sourcing.sourceStatus === "9" ||
                            sourcing.sourceStatus === 9;
                        const statusIsFailed = sourcing.sourceStatus === "4" ||
                            sourcing.sourceStatus === "5" ||
                            sourcing.sourceStatus === 4 ||
                            sourcing.sourceStatus === 5;

                        if (statusIsSuccess || statusIsFailed) {
                            // Provider status and product IDs are evidence, not approval.
                            // CJ documents failure responses that still contain cjProductId,
                            // so require a usable catalog record before approving.
                            // Status says failed, but this could be a closed-out ticket
                            // where the product was actually sourced. Verify by checking
                            // if the product exists in CJ's catalog before marking rejected.
                            //
                            // CJ's ticket lifecycle: after sourcing succeeds, CJ closes the
                            // ticket with status 4/5. The product IS in their catalog, but
                            // the sourcing ticket status is misleading.
                            console.log(`CJ Sourcing status ${sourcing.sourceStatus} (${sourcing.sourceStatusStr}) for ${product.name} — verifying product existence before rejecting...`);

                            let productActuallyExists = false;
                            let verificationIncomplete = false;

                            // Strategy 1: Use cjProductId from sourcing response if available
                            const pidToVerify = sourcing.cjProductId || sourcing.productId;
                            if (pidToVerify) {
                                try {
                                    // AbortController timeout to prevent hanging on slow CJ API
                                    const verifyController = new AbortController();
                                    const verifyTimeout = setTimeout(() => verifyController.abort(), CJ_FETCH_TIMEOUT_MS);
                                    let verifyRes: Response;
                                    try {
                                        verifyRes = await fetch(
                                            `${CJ_API_BASE}/product/query?pid=${encodeURIComponent(pidToVerify)}`,
                                            {
                                                method: "GET",
                                                headers: {
                                                    "Content-Type": "application/json",
                                                    "CJ-Access-Token": token,
                                                },
                                                signal: verifyController.signal,
                                            }
                                        );
                                    } finally {
                                        clearTimeout(verifyTimeout);
                                    }
                                    const verifyData = await verifyRes.json();

                                    // Guard: CJ returning result:false means an API-level error
                                    // (auth, rate limit, upstream), not "product doesn't exist".
                                    if (verifyData.result === false) {
                                        verificationIncomplete = true;
                                        console.log(`Strategy 1 (pid lookup): CJ returned result:false — treating as incomplete (${verifyData.message || 'no message'})`);
                                    } else if (verifyData.result && verifyData.data) {
                                        // Product exists in CJ's catalog! The sourcing ticket was just closed.
                                        productActuallyExists = true;
                                        console.log(`CJ Product confirmed in catalog for ${product.name} via pid=${pidToVerify}! Marking as approved.`);

                                        // Match the correct variant by SKU rather than assuming variants[0].
                                        // For multi-variant items, blindly using [0] could attach the wrong vid/SKU.
                                        const variants = verifyData.data.variants || [];
                                        const sourcingSku = sourcing.cjVariantSku;
                                        const matchedVariant = sourcingSku
                                            ? variants.find((v: any) => v.variantSku === sourcingSku)
                                            : null;
                                        // Fall back to variants[0] only for single-variant products
                                        const resolvedVariant = matchedVariant || (variants.length === 1 ? variants[0] : null);
                                        const resolvedVariantId = resolvedVariant?.vid != null ? String(resolvedVariant.vid) : undefined;
                                        const confirmedCjCost = extractCjVariantPrice(resolvedVariant);
                                        const freightQuote = await quoteCjFreightForVariant(token, resolvedVariantId);

                                        await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                                            productId: product._id,
                                            status: "approved",
                                            cjProductId: verifyData.data.pid || pidToVerify,
                                            cjVariantId: resolvedVariantId,
                                            cjSku: resolvedVariant?.variantSku,
                                            confirmedCjCost,
                                            confirmedCjShippingCost: freightQuote?.shippingCost,
                                            confirmedCjTaxesFee: freightQuote?.taxesFee,
                                            confirmedCjClearanceFee: freightQuote?.clearanceFee,
                                            confirmedCjLogisticsName: freightQuote?.logisticsName,
                                            cjRawPricingResponse: freightQuote?.rawResponse,
                                            expectedStatus: product.cjSourcingStatus,
                                        });
                                        approved++;
                                    }
                                } catch (verifyError: unknown) {
                                    verificationIncomplete = true;
                                    const isTimeout = verifyError instanceof Error && verifyError.name === 'AbortError';
                                    const message = verifyError instanceof Error ? verifyError.message : String(verifyError);
                                    console.log(`Strategy 1 (pid lookup) failed: ${isTimeout ? 'request timed out' : message}`);
                                }
                            }

                            // Strategy 2: If pid wasn't available, re-query the sourcing
                            // endpoint — CJ may have populated cjProductId since last check
                            if (!productActuallyExists && product.cjSourcingId) {
                                try {
                                    console.log(`Trying Strategy 2: re-query sourcing for ${product.name} (sourcingId=${product.cjSourcingId})`);

                                    // AbortController timeout for the sourcing re-query
                                    const reQueryController = new AbortController();
                                    const reQueryTimeout = setTimeout(() => reQueryController.abort(), CJ_FETCH_TIMEOUT_MS);
                                    let reQueryRes: Response;
                                    try {
                                        reQueryRes = await fetch(`${CJ_API_BASE}/product/sourcing/query`, {
                                            method: "POST",
                                            headers: {
                                                "Content-Type": "application/json",
                                                "CJ-Access-Token": token,
                                            },
                                            body: JSON.stringify({ sourceIds: [product.cjSourcingId] }),
                                            signal: reQueryController.signal,
                                        });
                                    } finally {
                                        clearTimeout(reQueryTimeout);
                                    }
                                    const reQueryData = await reQueryRes.json();

                                    // Guard: result:false is an API error, not a clean miss.
                                    // Skip ALL downstream processing — data payload is unreliable.
                                    if (reQueryData.result === false) {
                                        verificationIncomplete = true;
                                        console.log(`Strategy 2 (re-query sourcing): CJ returned result:false — treating as incomplete (${reQueryData.message || 'no message'})`);
                                    } else {
                                        const freshSourcing = Array.isArray(reQueryData.data)
                                            ? reQueryData.data[0]
                                            : reQueryData.data;

                                        if (freshSourcing?.cjProductId) {
                                            // CJ now has a product ID — verify it exists
                                            const verify2Controller = new AbortController();
                                            const verify2Timeout = setTimeout(() => verify2Controller.abort(), CJ_FETCH_TIMEOUT_MS);
                                            let verifyRes2: Response;
                                            try {
                                                verifyRes2 = await fetch(
                                                    `${CJ_API_BASE}/product/query?pid=${encodeURIComponent(freshSourcing.cjProductId)}`,
                                                    {
                                                        method: "GET",
                                                        headers: {
                                                            "Content-Type": "application/json",
                                                            "CJ-Access-Token": token,
                                                        },
                                                        signal: verify2Controller.signal,
                                                    }
                                                );
                                            } finally {
                                                clearTimeout(verify2Timeout);
                                            }
                                            const verifyData2 = await verifyRes2.json();

                                            // Guard: result:false is an API error, not a clean miss
                                            if (verifyData2.result === false) {
                                                verificationIncomplete = true;
                                                console.log(`Strategy 2 (pid verify): CJ returned result:false — treating as incomplete (${verifyData2.message || 'no message'})`);
                                            } else if (verifyData2.result && verifyData2.data) {
                                                productActuallyExists = true;
                                                console.log(`CJ Product confirmed via re-query for ${product.name}: cjProductId=${freshSourcing.cjProductId}`);

                                                // Match the correct variant by SKU from the fresh sourcing response.
                                                const variants2 = verifyData2.data.variants || [];
                                                const freshSku = freshSourcing.cjVariantSku;
                                                const matchedVariant2 = freshSku
                                                    ? variants2.find((v: any) => v.variantSku === freshSku)
                                                    : null;
                                                const resolvedVariant2 = matchedVariant2 || (variants2.length === 1 ? variants2[0] : null);
                                                const resolvedVariantId2 = resolvedVariant2?.vid != null ? String(resolvedVariant2.vid) : undefined;
                                                const confirmedCjCost2 = extractCjVariantPrice(resolvedVariant2);
                                                const freightQuote2 = await quoteCjFreightForVariant(token, resolvedVariantId2);

                                                await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                                                    productId: product._id,
                                                    status: "approved",
                                                    cjProductId: freshSourcing.cjProductId,
                                                    cjVariantId: resolvedVariantId2,
                                                    cjSku: resolvedVariant2?.variantSku || freshSourcing.cjVariantSku,
                                                    confirmedCjCost: confirmedCjCost2,
                                                    confirmedCjShippingCost: freightQuote2?.shippingCost,
                                                    confirmedCjTaxesFee: freightQuote2?.taxesFee,
                                                    confirmedCjClearanceFee: freightQuote2?.clearanceFee,
                                                    confirmedCjLogisticsName: freightQuote2?.logisticsName,
                                                    cjRawPricingResponse: freightQuote2?.rawResponse,
                                                    expectedStatus: product.cjSourcingStatus,
                                                });
                                                approved++;
                                            }
                                        }
                                    } // end else (result !== false)
                                } catch (reQueryError: unknown) {
                                    verificationIncomplete = true;
                                    const isTimeout = reQueryError instanceof Error && reQueryError.name === 'AbortError';
                                    const message = reQueryError instanceof Error ? reQueryError.message : String(reQueryError);
                                    console.log(`Strategy 2 (re-query sourcing) failed: ${isTimeout ? 'request timed out' : message}`);
                                }
                            }

                            if (!productActuallyExists && !verificationIncomplete && statusIsFailed) {
                                // Genuinely rejected — product not found in CJ catalog after all strategies
                                // and both verification checks completed cleanly (no timeouts/errors)
                                await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                                    productId: product._id,
                                    status: "rejected",
                                    error: sourcing.sourceStatusStr || "Sourcing request was rejected by CJ",
                                    expectedStatus: product.cjSourcingStatus,
                                });
                                rejected++;
                                console.log(`CJ Sourcing confirmed rejected for ${product.name}: ${sourcing.sourceStatusStr}`);
                            } else if (!productActuallyExists && verificationIncomplete) {
                                // Verification failed (timeout/network error) — do NOT reject.
                                // Leave the product in its current state and let the next cron pass retry.
                                console.log(`CJ Sourcing verification incomplete for ${product.name} — skipping rejection, will retry next cycle`);
                            }
                        } else {
                            // Still pending (status 1 or 2) — check if stale
                            const submittedAt = product.cjSubmittedAt;
                            if (submittedAt) {
                                const hoursSinceSubmission = (Date.now() - new Date(submittedAt).getTime()) / (1000 * 60 * 60);
                                if (hoursSinceSubmission > STALE_PENDING_HOURS) {
                                    // Product has been stuck in CJ's pending queue too long.
                                    // Auto-clear sourcing status so it gets resubmitted on the
                                    // next cron cycle with a fresh sourcing request + new webhook.
                                    console.warn(
                                        `CJ Sourcing STALE REQUIRES RECONCILIATION: ${product.name} stuck pending for ` +
                                        `${Math.round(hoursSinceSubmission)}h (threshold: ${STALE_PENDING_HOURS}h). ` +
                                        `Preserving cjSourcingId=${product.cjSourcingId} to prevent duplicate submission.`
                                    );
                                    await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                                        productId: product._id,
                                        status: "pending",
                                        error: "CJ sourcing is stale and requires reconciliation; the existing CJ ID was preserved.",
                                        expectedStatus: product.cjSourcingStatus,
                                    });
                                }
                            }
                        }
                    }
                }

                // Update lastCheckedAt to track recheck activity regardless of outcome.
                // This ensures the recency sort/filter in the recheck batch uses
                // accurate timestamps and prevents the same products from dominating.
                await ctx.runMutation(internal.cjHelpers.updateProductLastChecked, {
                    productId: product._id,
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Error checking sourcing for ${product.name}:`, message);
            }

            // CJ allows roughly 1 request/second; leave margin between products.
            await new Promise(resolve => setTimeout(resolve, CJ_API_REQUEST_SPACING_MS));
        }

        console.log(`CJ Sourcing check: ${deduped.length} products (${pendingProducts.length}/${allPendingProducts.length} pending + ${rejectedProducts.length} rejected), ${submitted} submitted, ${approved} approved, ${rejected} rejected, ${stalePendingResubmitted} stale-resubmitted`);
        return { checked: deduped.length, approved, rejected, submitted, stalePendingResubmitted };
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCING DIAGNOSTICS — Deep verification for stuck pending products
// Queries CJ's sourcing ticket AND catalog to verify actual product status.
// Auto-approves products confirmed in CJ's catalog. Returns detailed
// per-product diagnostics to the admin UI.
// ═══════════════════════════════════════════════════════════════════════════

export const diagnosePendingProducts = internalAction({
    args: {
        productId: v.optional(v.id("products")),
    },
    handler: async (ctx, args): Promise<{
        results: Array<{
            productId: string;
            productName: string;
            cjSourcingId: string | null;
            sourcingTicketStatus: string;
            sourcingTicketStatusCode: string | number | null;
            cjProductIdFromTicket: string | null;
            cjProductIdFromCatalog: string | null;
            productFoundInCatalog: boolean;
            variantCount: number;
            autoApproved: boolean;
            diagnosis: string;
        }>;
        summary: string;
    }> => {
        const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});
        if (!token) {
            return {
                results: [],
                summary: "❌ CJ API authentication failed — cannot diagnose. Check your CJ_API_KEY.",
            };
        }

        let productsToDiagnose;
        if (args.productId) {
            const product = await ctx.runQuery(internal.cjHelpers.getProductById, {
                productId: args.productId,
            });
            productsToDiagnose = product ? [product] : [];
        } else {
            const pendingProducts = await ctx.runQuery(internal.cjHelpers.getProductsPendingSourcing, {});
            const approvedMissingVariants = await ctx.runQuery(internal.cjHelpers.getApprovedProductsMissingCjVariants, {});
            productsToDiagnose = [...pendingProducts, ...approvedMissingVariants]
                .filter((product, index, products) =>
                    products.findIndex((candidate) => candidate._id === product._id) === index
                );
        }

        if (productsToDiagnose.length === 0) {
            return {
                results: [],
                summary: args.productId
                    ? "Product not found, so there was nothing to diagnose."
                    : "No pending products or approved products missing CJ variants to diagnose.",
            };
        }

        const results: Array<{
            productId: string;
            productName: string;
            cjSourcingId: string | null;
            sourcingTicketStatus: string;
            sourcingTicketStatusCode: string | number | null;
            cjProductIdFromTicket: string | null;
            cjProductIdFromCatalog: string | null;
            productFoundInCatalog: boolean;
            variantCount: number;
            autoApproved: boolean;
            diagnosis: string;
        }> = [];

        let autoApprovedCount = 0;
        const waitForDiagnosticRequestSlot = async () => {
            const slot = await ctx.runMutation(internal.cjHelpers.reserveCjDiagnosticRequestSlot, {
                spacingMs: CJ_DIAGNOSTIC_REQUEST_SPACING_MS,
            });
            if (slot.waitMs > 0) {
                await new Promise(resolve => setTimeout(resolve, slot.waitMs));
            }
        };
        const isCjRateLimitMessage = (message: unknown) =>
            typeof message === "string" &&
            /too many requests|too much request|qps|request frequency|frequency limit|1600200|1\s*time\s*\/\s*1\s*second|1\s*request\s*\/\s*second/i.test(message);
        const formatCjDiagnosticApiFailure = (message: unknown, purpose: string) => {
            const normalizedMessage =
                typeof message === "string" && message.trim() ? message.trim() : "Unknown error";

            if (isCjRateLimitMessage(normalizedMessage)) {
                return `CJ rate limit hit while ${purpose}. CJ only allows about 1 API request per second, so this diagnostic lookup was throttled. This did not resubmit the product. Wait about 60 seconds, then run Diagnose on this item.`;
            }

            return `CJ API error while ${purpose}: ${normalizedMessage}. The API may be temporarily unavailable.`;
        };

        for (const product of productsToDiagnose) {
            const diag: typeof results[0] = {
                productId: product._id,
                productName: product.name,
                cjSourcingId: product.cjSourcingId || null,
                sourcingTicketStatus: "unknown",
                sourcingTicketStatusCode: null,
                cjProductIdFromTicket: null,
                cjProductIdFromCatalog: null,
                productFoundInCatalog: false,
                variantCount: 0,
                autoApproved: false,
                diagnosis: "",
            };

            // ─── Step 1: Check sourcing ticket ───
            if (!product.cjSourcingId) {
                diag.diagnosis = "No cjSourcingId stored — product was never successfully submitted to CJ, or submission is still in progress. Try clicking 'Resubmit'.";
                results.push(diag);
                continue;
            }

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), CJ_FETCH_TIMEOUT_MS);
                let response: Response;
                try {
                    await waitForDiagnosticRequestSlot();
                    response = await fetch(`${CJ_API_BASE}/product/sourcing/query`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "CJ-Access-Token": token,
                        },
                        body: JSON.stringify({ sourceIds: [product.cjSourcingId] }),
                        signal: controller.signal,
                    });
                } finally {
                    clearTimeout(timeout);
                }

                const data = await response.json();
                console.log(`DIAGNOSE ${product.name}:`, JSON.stringify(data, null, 2));

                if (!data.result) {
                    diag.diagnosis = formatCjDiagnosticApiFailure(data.message, "checking CJ sourcing status");
                    results.push(diag);
                    continue;
                }

                const sourcing = Array.isArray(data.data) ? data.data[0] : data.data;

                if (!sourcing) {
                    diag.diagnosis = "CJ returned empty data for this sourcing ID — the ticket may have been deleted or expired. Try 'Resubmit'.";
                    results.push(diag);
                    continue;
                }

                // Map status codes to human-readable names
                const statusMap: Record<string, string> = {
                    "1": "Pending", "2": "Processing", "3": "Success",
                    "4": "Failed/Closed", "5": "Search Failed", "9": "Sourcing Succeeded",
                };
                const statusCode = String(sourcing.sourceStatus);
                diag.sourcingTicketStatusCode = sourcing.sourceStatus;
                diag.sourcingTicketStatus = statusMap[statusCode] || `Unknown (${statusCode})`;
                diag.cjProductIdFromTicket = sourcing.cjProductId || null;

                // ─── Step 2: If sourcing ticket has a cjProductId, verify in catalog ───
                const pidToCheck = sourcing.cjProductId || sourcing.productId;

                if (pidToCheck) {
                    try {
                        const catController = new AbortController();
                        const catTimeout = setTimeout(() => catController.abort(), CJ_FETCH_TIMEOUT_MS);
                        let catResponse: Response;
                        try {
                            await waitForDiagnosticRequestSlot();
                            catResponse = await fetch(
                                `${CJ_API_BASE}/product/query?pid=${encodeURIComponent(pidToCheck)}`,
                                {
                                    method: "GET",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "CJ-Access-Token": token,
                                    },
                                    signal: catController.signal,
                                }
                            );
                        } finally {
                            clearTimeout(catTimeout);
                        }

                        const catData = await catResponse.json();
                        console.log(`DIAGNOSE CATALOG ${product.name}:`, JSON.stringify(catData, null, 2));

                        if (!catData.result && isCjRateLimitMessage(catData.message)) {
                            diag.diagnosis = formatCjDiagnosticApiFailure(
                                catData.message,
                                `verifying CJ catalog data for pid=${pidToCheck}`
                            );
                        } else if (catData.result && catData.data) {
                            diag.productFoundInCatalog = true;
                            diag.cjProductIdFromCatalog = catData.data.pid || pidToCheck;
                            const variants = catData.data.variants || [];
                            diag.variantCount = variants.length;
                            for (const variant of variants) {
                                const vid = variant?.vid != null ? String(variant.vid).trim() : "";
                                if (!vid) continue;

                                const variantName =
                                    (typeof variant.variantName === "string" && variant.variantName.trim()) ||
                                    (typeof variant.variantKey === "string" && variant.variantKey.trim()) ||
                                    (typeof variant.variantValue === "string" && variant.variantValue.trim()) ||
                                    `Variant ${vid}`;
                                const rawPrice = variant.variantSellPrice ?? variant.sellPrice ?? variant.price;
                                const price = rawPrice != null && Number.isFinite(Number(rawPrice))
                                    ? Number(rawPrice)
                                    : undefined;

                                await ctx.runMutation(internal.cjHelpers.appendCjVariant, {
                                    productId: product._id,
                                    cjVariant: {
                                        vid,
                                        sku: typeof variant.variantSku === "string" ? variant.variantSku : "",
                                        name: variantName,
                                        price,
                                        image: typeof variant.variantImage === "string" ? variant.variantImage : undefined,
                                    },
                                });
                            }

                            // ─── Auto-approve: product IS in CJ's catalog ───
                            const sourcingSku = typeof sourcing.cjVariantSku === "string" && sourcing.cjVariantSku.trim()
                                ? sourcing.cjVariantSku.trim()
                                : undefined;
                            const matchedVariant = sourcingSku
                                ? variants.find((v: any) => v.variantSku === sourcingSku)
                                : null;
                            const resolvedVariant = matchedVariant || (variants.length === 1 ? variants[0] : null);
                            const resolvedVariantId = typeof resolvedVariant?.vid === "string" && resolvedVariant.vid.trim()
                                ? resolvedVariant.vid.trim()
                                : undefined;
                            const resolvedSku = typeof resolvedVariant?.variantSku === "string" && resolvedVariant.variantSku.trim()
                                ? resolvedVariant.variantSku.trim()
                                : sourcingSku;
                            const confirmedCjCost = extractCjVariantPrice(resolvedVariant);
                            await waitForDiagnosticRequestSlot();
                            const freightQuote = await quoteCjFreightForVariant(token, resolvedVariantId);

                            await ctx.runMutation(internal.cjHelpers.updateProductSourcingStatus, {
                                productId: product._id,
                                status: "approved",
                                cjProductId: catData.data.pid || pidToCheck,
                                cjVariantId: resolvedVariantId,
                                cjSku: resolvedSku,
                                confirmedCjCost,
                                confirmedCjShippingCost: freightQuote?.shippingCost,
                                confirmedCjTaxesFee: freightQuote?.taxesFee,
                                confirmedCjClearanceFee: freightQuote?.clearanceFee,
                                confirmedCjLogisticsName: freightQuote?.logisticsName,
                                cjRawPricingResponse: freightQuote?.rawResponse,
                            });
                            diag.autoApproved = true;
                            autoApprovedCount++;

                            diag.diagnosis = `✅ CONFIRMED & AUTO-APPROVED — Product exists in CJ catalog (pid=${diag.cjProductIdFromCatalog}, ${diag.variantCount} variant(s)). Sourcing ticket shows "${diag.sourcingTicketStatus}" but product is in catalog and ready for fulfillment.`;
                        } else {
                            diag.diagnosis = `Sourcing ticket has cjProductId=${pidToCheck} but catalog lookup returned no data. CJ may still be indexing the product. Ticket status: "${diag.sourcingTicketStatus}".`;
                        }
                    } catch (catError: unknown) {
                        const msg = catError instanceof Error ? catError.message : String(catError);
                        diag.diagnosis = isCjRateLimitMessage(msg)
                            ? formatCjDiagnosticApiFailure(msg, `verifying CJ catalog data for pid=${pidToCheck}`)
                            : `Sourcing ticket has cjProductId=${pidToCheck} but catalog verification failed: ${msg}. Ticket status: "${diag.sourcingTicketStatus}".`;
                    }
                } else {
                    // No cjProductId from sourcing ticket
                    const isSuccess = statusCode === "3" || statusCode === "9";
                    const isFailed = statusCode === "4" || statusCode === "5";
                    const isPending = statusCode === "1" || statusCode === "2";

                    if (isSuccess) {
                        diag.diagnosis = `Sourcing ticket shows "${diag.sourcingTicketStatus}" (success) but no cjProductId was provided. This is unusual — CJ approved sourcing but hasn't assigned a product ID yet. Will auto-resolve on next webhook or cron cycle.`;
                    } else if (isFailed) {
                        diag.diagnosis = `Sourcing ticket shows "${diag.sourcingTicketStatus}". CJ may have closed the ticket after sourcing (known CJ behavior). No cjProductId available to verify catalog. Try 'Resubmit' to create a fresh sourcing request.`;
                    } else if (isPending) {
                        diag.diagnosis = `Sourcing ticket still shows "${diag.sourcingTicketStatus}" — CJ has not finished processing this request yet. No cjProductId assigned. If you received a confirmation email, CJ's API may be lagging behind their email system. Try 'Resubmit' to create a fresh request.`;
                    } else {
                        diag.diagnosis = `Unknown sourcing status "${diag.sourcingTicketStatus}" (code: ${statusCode}). No cjProductId available.`;
                    }
                }
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                diag.diagnosis = isCjRateLimitMessage(msg)
                    ? formatCjDiagnosticApiFailure(msg, "checking CJ sourcing status")
                    : `Failed to query CJ API: ${msg}`;
            }

            results.push(diag);
        }

        const summary = autoApprovedCount > 0
            ? `✅ Diagnosed ${results.length} product(s): ${autoApprovedCount} confirmed in CJ catalog and auto-approved. CJ requests were paced for the 1 request/second limit.`
            : `Diagnosed ${results.length} product(s): none found in CJ catalog yet. CJ requests were paced for the 1 request/second limit. See details below.`;

        return { results, summary };
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCING CANCELLATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cancel a pending sourcing request on CJ and delete the product locally
 * This fully removes the product from both systems
 */
export const cancelSourcingAndDelete = internalAction({
    args: {
        productId: v.id("products"),
        cjSourcingId: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{ success: boolean; cjCancelled: boolean; error?: string }> => {
        let cjCancelled = false;

        // If we have a CJ sourcing ID, try to cancel it on their end
        if (args.cjSourcingId) {
            const token = await ctx.runAction(internal.cjDropshipping.getAccessToken, {});

            if (token) {
                try {
                    // CJ API endpoint to cancel sourcing request
                    const response = await fetch(`${CJ_API_BASE}/product/sourcing/cancel`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "CJ-Access-Token": token,
                        },
                        body: JSON.stringify({
                            sourcingId: args.cjSourcingId,
                        }),
                    });

                    const data = await response.json();

                    if (data.result) {
                        cjCancelled = true;
                        console.log(`CJ Sourcing cancelled: ${args.cjSourcingId}`);
                    } else {
                        // Log but continue with local deletion
                        console.warn(`CJ cancel failed (may already be processed): ${data.message || 'Unknown'}`);
                        // Still consider it "handled" if it's already processed/approved
                        cjCancelled = data.message?.includes('processed') || data.message?.includes('approved') || true;
                    }
                } catch (error: any) {
                    console.error("CJ Cancel sourcing error:", error.message);
                    // Continue with local deletion even if CJ cancel fails
                }
            } else {
                console.warn("Could not cancel on CJ: auth failed. Proceeding with local deletion.");
            }
        }

        // Now delete the product from our database
        try {
            await ctx.runMutation(internal.cjHelpers.deleteProduct, {
                productId: args.productId,
            });

            console.log(`Product ${args.productId} deleted from database`);
            return { success: true, cjCancelled };
        } catch (error: any) {
            console.error("Failed to delete product locally:", error.message);
            return { success: false, cjCancelled, error: error.message };
        }
    },
});
