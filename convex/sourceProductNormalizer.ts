import {
    SourceAttribute,
    SourceImage,
    SourceProductSnapshot,
    buildSourceProductSnapshot,
    inferSourceDomain,
    inferSourcePlatform,
    isPlaceholderSourceText,
    normalizeImageList,
    sanitizeSourceText,
} from '../lib/smartDescription';

export { sanitizeSourceText };

function asArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

function findJsonLdBlocks(html: string): unknown[] {
    const blocks: unknown[] = [];
    const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        const raw = match[1].trim().slice(0, 50000);
        try {
            blocks.push(JSON.parse(raw));
        } catch {
            // Ignore malformed vendor JSON-LD.
        }
    }
    return blocks;
}

function flattenJsonLd(node: unknown): any[] {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
    if (typeof node !== 'object') return [];
    const obj = node as any;
    return [
        obj,
        ...flattenJsonLd(obj['@graph']),
        ...flattenJsonLd(obj.mainEntity),
        ...flattenJsonLd(obj.itemListElement?.map?.((item: any) => item.item || item)),
    ];
}

export function extractJsonLdProduct(html = ''): {
    title?: string;
    description?: string;
    images: SourceImage[];
    attributes: SourceAttribute[];
    price?: { amount?: number; currency?: string; raw?: string };
    seller?: { name?: string; rating?: number; salesCount?: number };
} {
    const nodes = findJsonLdBlocks(html).flatMap(flattenJsonLd);
    const product = nodes.find((node) => {
        const type = node?.['@type'];
        return Array.isArray(type) ? type.includes('Product') : type === 'Product';
    });
    if (!product) return { images: [], attributes: [] };

    const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const rating = product.aggregateRating;
    const brand = typeof product.brand === 'string' ? product.brand : product.brand?.name;
    const attrs: SourceAttribute[] = [];
    const pushAttr = (key: string, value: unknown) => {
        if (value === undefined || value === null || value === '') return;
        attrs.push({ key, value: String(value), source: 'json_ld', confidence: 0.95 });
    };
    pushAttr('brand', brand);
    pushAttr('sku', product.sku);
    pushAttr('mpn', product.mpn);
    pushAttr('material', product.material);
    pushAttr('color', product.color);
    pushAttr('size', product.size);
    pushAttr('category', product.category);

    return {
        title: product.name,
        description: product.description,
        images: normalizeImageList(product.image, 'gallery'),
        attributes: attrs,
        price: {
            amount: Number.isFinite(Number(offers?.price)) ? Number(offers.price) : undefined,
            currency: offers?.priceCurrency,
            raw: offers?.price ? String(offers.price) : undefined,
        },
        seller: {
            name: brand,
            rating: Number.isFinite(Number(rating?.ratingValue)) ? Number(rating.ratingValue) : undefined,
            salesCount: Number.isFinite(Number(rating?.reviewCount)) ? Number(rating.reviewCount) : undefined,
        },
    };
}

export function extractHtmlTableAttributes(html = ''): SourceAttribute[] {
    const attrs: SourceAttribute[] = [];
    const tableRowRegex = /<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<\/tr>/gi;
    let match: RegExpExecArray | null;
    while ((match = tableRowRegex.exec(html)) !== null) {
        const key = sanitizeSourceText(match[1], 200).text;
        const value = sanitizeSourceText(match[2], 500).text;
        if (key && value) attrs.push({ key, value, source: 'html_table', confidence: 0.8 });
    }
    return attrs;
}

export function normalizeSourceProduct(input: SourceProductSnapshot | any): SourceProductSnapshot & { warnings: string[] } {
    const warnings: string[] = [];
    const maxChars = Number(process.env.SMART_DESCRIPTION_MAX_SOURCE_CHARS || 20000);

    const html = input.rawHtmlDescription || input.html || input.rawHtml || '';
    const jsonLd = extractJsonLdProduct(html);
    const tableAttributes = extractHtmlTableAttributes(html);

    const title = input.rawTitle || input.translatedTitle || input.name || jsonLd.title || input.title;
    const descRawCandidate = input.rawDescription || input.translatedDescription || input.description || jsonLd.description || '';
    const fallbackDescription = jsonLd.description || '';
    const descCandidatePreview = sanitizeSourceText(descRawCandidate, maxChars);
    warnings.push(...descCandidatePreview.warnings);
    const descRaw = isPlaceholderSourceText(descRawCandidate)
        ? (isPlaceholderSourceText(fallbackDescription) ? '' : fallbackDescription)
        : descRawCandidate;
    const desc = sanitizeSourceText(descRaw, maxChars);
    const htmlDesc = sanitizeSourceText(html, maxChars);
    warnings.push(...desc.warnings, ...htmlDesc.warnings);

    const images = [
        ...normalizeImageList(input.images, 'gallery'),
        ...jsonLd.images,
    ];
    const descriptionImages = normalizeImageList(input.descriptionImages, 'detail');
    const seenImages = new Set<string>();
    const dedupedImages = images.filter((image) => {
        if (seenImages.has(image.url)) return false;
        seenImages.add(image.url);
        return true;
    });

    const attrs = [
        ...asArray(input.attributes),
        ...jsonLd.attributes,
        ...tableAttributes,
    ].filter((attr): attr is SourceAttribute => !!attr?.key && !!attr?.value);

    const snapshot = buildSourceProductSnapshot({
        sourceUrl: input.sourceUrl,
        name: title,
        description: desc.text,
        htmlDescription: htmlDesc.text,
        price: input.price?.amount ?? input.price ?? jsonLd.price?.amount,
        currency: input.price?.currency ?? input.currency ?? jsonLd.price?.currency,
        images: dedupedImages,
        descriptionImages,
        variants: input.variants,
        attributes: attrs,
        category: input.categoryHints?.selectedCategory ?? input.category,
        subcategory: input.categoryHints?.selectedSubcategory ?? input.subcategory,
        collection: input.categoryHints?.selectedCollection ?? input.collection,
        sellerName: input.seller?.name ?? jsonLd.seller?.name,
        sellerRating: input.seller?.rating ?? jsonLd.seller?.rating,
        salesCount: input.seller?.salesCount ?? jsonLd.seller?.salesCount,
        sourceMetadata: input.sourceMetadata,
    });

    return {
        ...snapshot,
        sourceDomain: input.sourceDomain || inferSourceDomain(input.sourceUrl),
        sourcePlatform: input.sourcePlatform || inferSourcePlatform(input.sourceUrl),
        rawTitle: sanitizeSourceText(title || '', 500).text,
        rawDescription: desc.text,
        rawHtmlDescription: htmlDesc.text,
        attributes: attrs,
        warnings: [...new Set(warnings)],
    };
}

export function calculateSourceQuality(snapshot: SourceProductSnapshot): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    if (snapshot.rawTitle || snapshot.translatedTitle) {
        score += 15;
        reasons.push('title found');
    }
    if (snapshot.rawDescription || snapshot.translatedDescription || snapshot.rawHtmlDescription) {
        score += 20;
        reasons.push('description found');
    }
    if (snapshot.attributes?.length) {
        score += 25;
        reasons.push('structured attributes found');
    }
    if (snapshot.variants?.length) {
        score += 15;
        reasons.push('variants found');
    }
    if (snapshot.images?.length) {
        score += 15;
        reasons.push('images found');
    }
    if (snapshot.descriptionImages?.length) {
        score += 10;
        reasons.push('detail images found');
    }
    return { score: Math.min(score, 100), reasons };
}
