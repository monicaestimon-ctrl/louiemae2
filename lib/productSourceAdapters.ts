import { buildBatchImportProduct } from './batchImportProduct';
import { buildSourceProductSnapshot, type SourceProductSnapshot } from './smartDescription';

/** Shared by URL import, batch import, and source refresh for saved products. */
export function sourceFromImportPayload(result: Parameters<typeof buildBatchImportProduct>[0]['result'], url: string): SourceProductSnapshot {
    const product = buildBatchImportProduct({ _id: 'source', normalizedUrl: url, result }, '', price => price, { evidenceOnly: true });
    const snapshot = buildSourceProductSnapshot({ name: product.name, sourceUrl: product.productUrl,
        rawDescription: product.rawSourceDescription || product.description, htmlDescription: product.rawHtmlDescription,
        images: product.images, descriptionImages: product.descriptionImages, variants: product.variants,
        attributes: Object.entries(product.sourceProperties ?? {}).map(([key, value]) => ({ key, value: String(value), source: 'otapi_property' as const, confidence: .9 })),
        price: product.sourcePriceOriginal ?? product.sourcePriceCny ?? product.price,
        currency: product.sourcePriceCny ? 'CNY' : product.sourceCurrency || 'USD',
        sellerName: product.seller?.name, sellerRating: product.seller?.rating, salesCount: product.reviewCount,
        sourceMetadata: { sourceId: product.sourceId, source: product.source, supplierVariants: product.variants } });
    if (JSON.stringify(snapshot).length > 240_000) throw new Error('Supplier details are too large to preserve safely. Select a smaller source listing.');
    return snapshot;
}
