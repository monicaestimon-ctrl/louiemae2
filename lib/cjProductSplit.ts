import type { Doc } from '../convex/_generated/dataModel';

export function buildCjProductSplit(product: Doc<'products'>, selectedIds: string[], name: string,
    customerLinks: { cjVariantId: string; customerVariantId: string }[] = [],
    variantImages: { cjVariantId: string; image: string }[] = []) {
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
    if (new Set(variantImages.map(v => v.cjVariantId)).size !== variantImages.length || variantImages.some(v => !selected.has(v.cjVariantId))) {
        throw new Error('Photo assignments must belong to the selected variants.');
    }
    const linkedCustomerIds = new Set<string>();
    const linkedCjIds = new Set<string>();
    for (const link of customerLinks) {
        const option = product.variants?.find(v => v.id === link.customerVariantId);
        if (!selected.has(link.cjVariantId) || !option || linkedCustomerIds.has(link.customerVariantId) || linkedCjIds.has(link.cjVariantId)
            || (option.cjVariantId && option.cjVariantId !== link.cjVariantId)
            || product.variants?.some(v => v.cjVariantId === link.cjVariantId && v.id !== option.id)) {
            throw new Error('Each selected CJ variant must match a different customer option from this listing.');
        }
        linkedCustomerIds.add(link.customerVariantId);
        linkedCjIds.add(link.cjVariantId);
    }
    const variants = moved.map(v => {
        const link = customerLinks.find(link => link.cjVariantId === v.vid);
        const existing = product.variants?.find(option => link ? option.id === link.customerVariantId : option.cjVariantId === v.vid);
        const image = variantImages.find(option => option.cjVariantId === v.vid)?.image || existing?.image || v.image;
        return existing ? { ...existing, ...(variantImages.some(option => option.cjVariantId === v.vid) ? { image } : {}), cjVariantId: v.vid, cjSku: v.sku } : {
            id: `cj_${v.vid}`, name: v.name, ...(image ? { image } : {}),
            priceAdjustment: 0, inStock: false, cjVariantId: v.vid, cjSku: v.sku,
        };
    });
    const remainingOptions = (product.variants ?? []).filter(v => !linkedCustomerIds.has(v.id) && (!v.cjVariantId || !selected.has(v.cjVariantId)));
    const images = [...new Set([...moved.map(v => v.image), ...variants.map(v => v.image)].filter((url): url is string => Boolean(url)))];
    const remainingImages = new Set([...remaining.map(v => v.image), ...remainingOptions.map(v => v.image)]);
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
            images: product.images.filter(image => !images.includes(image) || remainingImages.has(image)),
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
