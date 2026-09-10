import { buildSourceProductSnapshot, normalizeVariants, sanitizeSourceText, type SourceProductSnapshot } from './smartDescription';
import type { Product } from '../types';

export type SourceEvidenceOverrides = { facts?: string; attributeKeys?: string[]; useDescription?: boolean };
export type GenerationSelection = {
    images: string[]; variants: { id?: string; name: string; supplierName?: string; image?: string; cjVariantId?: string }[];
    subset: boolean; evidence?: SourceEvidenceOverrides;
};
export type SourceContext = Partial<Pick<Product, 'price' | 'category' | 'collection' | 'audience' | 'subcategory' | 'subcategoryIds' | 'primarySubcategoryId' | 'sourceUrl'>>;

export function sourceIdentity(url: string): string {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use a public supplier URL without credentials.');
    const offer = (parsed.hostname === '1688.com' || parsed.hostname.endsWith('.1688.com')) && parsed.pathname.match(/offer\/(\d+)\.html/);
    if (offer) return `https://detail.1688.com/offer/${offer[1]}.html`;
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|spm$|sourceId$)/i.test(key)) parsed.searchParams.delete(key);
    return parsed.toString();
}

/** Source evidence stays separate from merchandising copy in every entry point. */
export function buildGenerationSnapshot(source: SourceProductSnapshot, selection: GenerationSelection, context: SourceContext): SourceProductSnapshot {
    const selectedImages = [...new Set([...selection.images, ...selection.variants.flatMap(v => v.image ? [v.image] : [])])];
    const selectedSet = new Set(selectedImages);
    const evidence = selection.evidence;
    const sourceAttributes = selection.subset
        ? (source.attributes ?? []).filter(a => evidence?.attributeKeys?.includes(a.key))
        : source.attributes ?? [];
    const allowDescription = !selection.subset || evidence?.useDescription === true;
    const facts = sanitizeSourceText(evidence?.facts || '', 6000).text;
    const snapshot = buildSourceProductSnapshot({
        sourceUrl: source.sourceUrl, name: selection.subset ? selection.variants.map(v => v.supplierName || v.name).join(', ') : source.rawTitle,
        rawDescription: [allowDescription ? source.rawDescription : '', facts].filter(Boolean).join('\n'),
        htmlDescription: allowDescription ? source.rawHtmlDescription : '', price: source.price, currency: source.price?.currency,
        images: selectedImages,
        descriptionImages: (source.descriptionImages ?? []).filter(image => selectedSet.has(image.url)),
        variants: selection.variants.map(v => ({ ...v, name: v.supplierName || v.name })), attributes: [...sourceAttributes, ...(facts ? [{ key: 'Confirmed product details', value: facts, source: 'admin_input' as const, confidence: 1 }] : [])],
        category: context.category, subcategory: context.subcategory, collection: context.collection,
        categoryHints: { selectedCategory: context.category, selectedCollection: context.collection,
            selectedSubcategory: context.subcategory, selectedSubcategoryIds: context.subcategoryIds,
            selectedSubcategories: context.subcategoryIds, audience: context.audience, selectionSource: context.collection ? 'admin' : 'unknown' },
        sellerName: source.seller?.name, sellerRating: source.seller?.rating, salesCount: source.seller?.salesCount,
        sourceMetadata: { sourceId: source.sourceMetadata?.sourceId, source: source.sourceMetadata?.source, scoped: selection.subset },
    });
    // A snapshot revision, rather than a render timestamp, identifies the source.
    return { ...snapshot, importedAt: source.importedAt };
}

export function buildImportGenerationInput(product: {
    name: string; productUrl?: string; sourceUrl?: string; description?: string; rawSourceDescription?: string; rawHtmlDescription?: string;
    sourceProperties?: Record<string, string>; images?: string[]; descriptionImages?: string[];
    variants?: GenerationSelection['variants']; selectedVariants?: string[]; selectedImages?: number[]; imageOrder?: number[];
    sourceSnapshotId?: string; sourceScopeStatus?: string; sourceEvidenceOverrides?: SourceEvidenceOverrides;
    targetCollection?: string; collection?: string; targetSubcategory?: string; category?: string; targetSubcategoryIds?: string[];
    subcategoryIds?: string[]; audience?: SourceContext['audience']; price?: number; sourceCurrency?: string;
}) {
    const allImages = [...(product.images ?? []), ...(product.descriptionImages ?? [])];
    const indices = product.selectedImages ?? allImages.map((_, i) => i);
    const order = [...new Set([...(product.imageOrder ?? []).filter(i => indices.includes(i)), ...indices])];
    const variants = (product.variants ?? []).filter(v => !product.selectedVariants || (v.id && product.selectedVariants.includes(v.id)));
    const context: SourceContext = { sourceUrl: product.productUrl || product.sourceUrl, category: product.category,
        collection: product.targetCollection || product.collection, subcategory: product.targetSubcategory,
        subcategoryIds: product.targetSubcategoryIds || product.subcategoryIds, audience: product.audience, price: product.price };
    const selection: GenerationSelection = { images: order.flatMap(i => allImages[i] ? [allImages[i]] : []), variants,
        subset: product.sourceScopeStatus === 'needs_confirmation' || product.sourceScopeStatus === 'confirmed_subset' || variants.length < (product.variants?.length ?? 0),
        evidence: product.sourceEvidenceOverrides };
    const sourceSnapshot = buildSourceProductSnapshot({ name: product.name, sourceUrl: context.sourceUrl,
        rawDescription: product.rawSourceDescription, htmlDescription: product.rawHtmlDescription,
        images: product.images, descriptionImages: product.descriptionImages, variants: product.variants,
        attributes: Object.entries(product.sourceProperties ?? {}).map(([key, value]) => ({ key, value, source: 'otapi_property' as const, confidence: .9 })),
        price: product.price, currency: product.sourceCurrency });
    return { sourceSnapshot, sourceSnapshotId: product.sourceSnapshotId, selection, context };
}

export function semanticGenerationKey(value: unknown): string {
    const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
        ? Object.fromEntries(Object.entries(item).filter(([key]) => !['importedAt', 'createdAt', 'fetchedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, stable(value)])) : item;
    return JSON.stringify(stable(value));
}

export function legacySelection(snapshot: SourceProductSnapshot): GenerationSelection {
    return { images: [...snapshot.images, ...(snapshot.descriptionImages ?? [])].map(i => i.url),
        variants: normalizeVariants(snapshot.variants).flatMap(group => group.values.map(name => ({ name: `${group.name}: ${name}` }))), subset: false };
}
