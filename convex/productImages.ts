"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_URLS = 40;

const normalizeUrl = (value = "") => {
    const trimmed = value.trim();
    return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
};

const isHttpUrl = (value = "") => /^https?:\/\//i.test(normalizeUrl(value));

const isDurableUrl = (value = "") => {
    const normalized = normalizeUrl(value);
    if (!normalized || normalized.startsWith("/images/") || normalized.startsWith("data:image/")) return true;
    if (!isHttpUrl(normalized)) return false;
    try {
        const host = new URL(normalized).hostname.toLowerCase();
        return host.includes("convex.cloud") || host.includes("convex.site") || host.includes("louiemae.com");
    } catch {
        return false;
    }
};

const shouldCache = (value = "") => isHttpUrl(value) && !isDurableUrl(value);

const requireIdentity = async (ctx: any) => {
    await ctx.runQuery(internal.cjAdminAccess.verifyCjAdminIdentity, {});
};

async function fetchImageBlob(url: string, sourceUrl?: string): Promise<Blob> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "user-agent": "Mozilla/5.0 LouieMaeImageCache/1.0",
                ...(sourceUrl ? { referer: sourceUrl } : {}),
            },
        });
        if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) throw new Error(`URL did not return an image (${contentType || "unknown"})`);
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > MAX_IMAGE_BYTES) throw new Error("Image is too large to cache");
        const blob = await response.blob();
        if (blob.size > MAX_IMAGE_BYTES) throw new Error("Image is too large to cache");
        return blob;
    } finally {
        clearTimeout(timeout);
    }
}

async function cacheUrlsWithStorage(
    ctx: any,
    args: { urls: string[]; sourceUrl?: string }
): Promise<{ results: Array<{ originalUrl: string; finalUrl: string; cached: boolean; error?: string }> }> {
    const urls = [...new Set(args.urls.map(normalizeUrl).filter(Boolean))].slice(0, MAX_CACHE_URLS);
    const results: Array<{ originalUrl: string; finalUrl: string; cached: boolean; error?: string }> = [];
    const memo = new Map<string, string>();

    for (const originalUrl of urls) {
        if (!shouldCache(originalUrl)) {
            results.push({ originalUrl, finalUrl: originalUrl, cached: false });
            continue;
        }
        try {
            if (memo.has(originalUrl)) {
                results.push({ originalUrl, finalUrl: memo.get(originalUrl)!, cached: true });
                continue;
            }
            const blob = await fetchImageBlob(originalUrl, args.sourceUrl);
            const storageId = await ctx.storage.store(blob);
            const finalUrl = await ctx.storage.getUrl(storageId);
            if (!finalUrl) throw new Error("Cached image URL could not be resolved");
            memo.set(originalUrl, finalUrl);
            results.push({ originalUrl, finalUrl, cached: true });
        } catch (error: any) {
            results.push({
                originalUrl,
                finalUrl: originalUrl,
                cached: false,
                error: error?.message || "Image cache failed",
            });
        }
    }

    return { results };
}

export const cacheImageUrls = action({
    args: {
        urls: v.array(v.string()),
        sourceUrl: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{
        results: Array<{ originalUrl: string; finalUrl: string; cached: boolean; error?: string }>;
    }> => {
        await requireIdentity(ctx);
        return await cacheUrlsWithStorage(ctx, args);
    },
});

export const cacheExistingProductImages = action({
    args: {
        productId: v.optional(v.id("products")),
        limit: v.optional(v.number()),
        dryRun: v.optional(v.boolean()),
    },
    handler: async (ctx, args): Promise<{
        processed: number;
        cachedImages: number;
        failedImages: number;
        products: Array<{ productId: string; name: string; cached: number; failed: number; skipped: number }>;
    }> => {
        await requireIdentity(ctx);
        const products = await ctx.runQuery(internal.productImageRecords.getProductsForImageCaching, {
            productId: args.productId,
            limit: args.limit,
        });

        const details: Array<{ productId: string; name: string; cached: number; failed: number; skipped: number }> = [];
        let cachedImages = 0;
        let failedImages = 0;

        for (const product of products as any[]) {
            const urls = [
                ...(product.images || []),
                ...(product.descriptionImages || []),
                ...(product.variants || []).map((variant: any) => variant.image).filter(Boolean),
            ].map(normalizeUrl);
            const cacheable = urls.filter(shouldCache);
            if (cacheable.length === 0) {
                details.push({ productId: product._id, name: product.name, cached: 0, failed: 0, skipped: urls.length });
                continue;
            }

            const result = args.dryRun ? { results: cacheable.map((url) => ({ originalUrl: url, finalUrl: url, cached: false })) }
                : await cacheUrlsWithStorage(ctx, { urls: cacheable, sourceUrl: product.sourceUrl });
            const map = new Map(result.results.map((entry: any) => [entry.originalUrl, entry.finalUrl]));
            const cached = result.results.filter((entry: any) => entry.cached).length;
            const failed = result.results.filter((entry: any) => entry.error).length;
            cachedImages += cached;
            failedImages += failed;

            if (!args.dryRun && cached > 0) {
                await ctx.runMutation(internal.productImageRecords.patchCachedProductImages, {
                    productId: product._id,
                    images: (product.images || []).map((url: string) => map.get(normalizeUrl(url)) || normalizeUrl(url)),
                    descriptionImages: (product.descriptionImages || []).map((url: string) => map.get(normalizeUrl(url)) || normalizeUrl(url)),
                    variants: (product.variants || []).map((variant: any) => ({
                        ...variant,
                        image: variant.image ? (map.get(normalizeUrl(variant.image)) || normalizeUrl(variant.image)) : undefined,
                    })),
                });
            }

            details.push({
                productId: product._id,
                name: product.name,
                cached,
                failed,
                skipped: Math.max(urls.length - cacheable.length, 0),
            });
        }

        return { processed: products.length, cachedImages, failedImages, products: details };
    },
});
