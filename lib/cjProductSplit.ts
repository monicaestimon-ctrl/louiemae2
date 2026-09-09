import type { Doc } from '../convex/_generated/dataModel';

export function buildCjProductSplit(product: Doc<'products'>, selectedIds: string[], name: string) {
    const selected = new Set(selectedIds);
    const catalog = product.cjVariants ?? [];
    if (!name.trim()) throw new Error('Enter a name for the new listing.');
    if (selected.size === 0) throw new Error('Select the variants to move.');
    if (selected.size !== selectedIds.length || selectedIds.some(id => !catalog.some(v => v.vid === id))) {
        throw new Error('The variants have changed. Refresh and select them again.');
    }
    if (selected.size >= catalog.length) throw new Error('Leave at least one CJ variant in the original listing.');
    const moved = catalog.filter(v => selected.has(v.vid));
    const remaining = catalog.filter(v => !selected.has(v.vid));
    const variants = moved.map(v => {
        const existing = product.variants?.find(option => option.cjVariantId === v.vid);
        return existing ? { ...existing } : {
            id: `cj_${v.vid}`, name: v.name, ...(v.image ? { image: v.image } : {}),
            priceAdjustment: 0, inStock: false, cjVariantId: v.vid, cjSku: v.sku,
        };
    });
    const remainingOptions = (product.variants ?? []).filter(v => !v.cjVariantId || !selected.has(v.cjVariantId));
    const images = [...new Set(moved.map(v => v.image).filter((url): url is string => Boolean(url)))];
    const newProduct = {
        name: name.trim(), price: product.price, description: product.description,
        category: product.category, collection: product.collection,
        audience: product.audience, canonicalProductType: product.canonicalProductType,
        subcategoryIds: product.subcategoryIds, primarySubcategoryId: product.primarySubcategoryId,
        ...(product.subcategory ? { subcategory: product.subcategory } : {}),
        images, variants, storefrontStatus: 'hidden' as const, inStock: variants.some(v => v.inStock),
        cjSourcingStatus: product.cjSourcingStatus,
        cjProductId: product.cjProductId, sourceUrl: product.sourceUrl,
        cjVariantId: moved[0].vid, cjSku: moved[0].sku,
        cjVariants: moved, cjVariantScope: moved.map(v => v.vid),
        cjInventoryStatus: 'unknown' as const, cjInventoryNextCheckAt: 0,
        adminPriceLocked: true,
    };
    return {
        newProduct,
        sourcePatch: {
            cjVariants: remaining, cjVariantScope: remaining.map(v => v.vid), variants: remainingOptions,
            cjVariantId: remaining.some(v => v.vid === product.cjVariantId) ? product.cjVariantId : remaining[0].vid,
            cjSku: remaining.find(v => v.vid === product.cjVariantId)?.sku ?? remaining[0].sku,
            cjInventoryByVariant: (product.cjInventoryByVariant ?? []).filter(v =>
                v.vid ? !selected.has(v.vid) : !moved.some(m => m.sku === v.sku)),
            cjInventoryTotal: undefined, cjInventoryStatus: 'unknown' as const, cjInventoryNextCheckAt: 0,
            inStock: remainingOptions.some(v => v.inStock),
        },
    };
}
