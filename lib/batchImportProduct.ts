import type { ImportableProduct } from '../components/import/ProductCard';
import type { CollectionType } from '../types';
import { cleanOtapiDescription, extractOtapiSourceProperties } from './otapiHelpers';

const CURRENCY_RATES_TO_USD: Record<string, number> = {
    USD: 1, CNY: 0.14, RMB: 0.14, GBP: 1.27, EUR: 1.09, CAD: 0.74,
    AUD: 0.66, JPY: 0.0067, KRW: 0.00075, HKD: 0.13, SGD: 0.75,
    MYR: 0.22, THB: 0.029, INR: 0.012,
};

export type BatchImportItemSource = {
    _id: string;
    normalizedUrl: string;
    resolvedUrl?: string;
    result?: any;
};

export const buildBatchImportProduct = (
    row: BatchImportItemSource,
    collection: string,
    calculatePrice: (price: number) => number,
): ImportableProduct => {
    const result = row.result;
    if (!result) throw new Error('Batch item is missing source data.');
    const productUrl = row.resolvedUrl || result.resolvedUrl || row.normalizedUrl;

    if (result.source === '1688') {
        const item = result.data?.Result ?? result.data;
        if (!item || typeof item !== 'object') throw new Error('1688 payload missing item data.');
        const getUsd = (price: any) => {
            const converted = Number(price?.ConvertedPriceList?.Internal?.Price || 0);
            if (converted > 0) return converted;
            const cny = Number(price?.OriginalPrice || price?.ConvertedPriceList?.Original?.Price || 0);
            return cny > 0 ? Math.round(cny * CURRENCY_RATES_TO_USD.CNY * 100) / 100 : 0;
        };
        const getCny = (price: any) => price?.OriginalPrice || price?.ConvertedPriceList?.Original?.Price || 0;
        const promo = getUsd(item.PromotionPrice);
        const regular = getUsd(item.Price);
        const salePrice = promo > 0 ? promo : regular;
        const originalPrice = regular > promo && promo > 0 ? regular : salePrice;
        const images: string[] = [];
        const addImage = (url?: string) => { if (url && !images.includes(url)) images.push(url); };
        (item.Pictures || []).forEach((pic: any) => addImage(pic?.Large?.Url || pic?.Medium?.Url || pic?.Url));
        (item.PropertyPictures || []).forEach((pic: any) => addImage(pic?.Large?.Url || pic?.Medium?.Url || pic?.Url || pic?.Original?.Url));
        (item.ItemImages || []).forEach((image: any) => addImage(typeof image === 'string' ? image : image?.Url || image?.Large?.Url));
        addImage(item.MainPictureUrl);
        const variants = (item.ConfiguredItems || []).map((cfg: any, index: number) => {
            const variantPrice = getUsd(cfg.Price);
            const label = Array.isArray(cfg.Configurators)
                ? cfg.Configurators.map((entry: any) => `${entry?.PropertyName ?? entry?.Pid ?? '?'}: ${entry?.Value ?? entry?.Vid ?? '?'}`).join(' / ')
                : '';
            return {
                id: String(cfg.Id || `cfg_${index}`),
                name: cfg.Title || label || `Option ${index + 1}`,
                image: cfg.Pictures?.[0]?.Large?.Url || cfg.Pictures?.[0]?.Medium?.Url || cfg.Pictures?.[0]?.Url,
                priceAdjustment: variantPrice ? variantPrice - salePrice : 0,
                inStock: (cfg.Quantity ?? cfg.MasterQuantity ?? 0) > 0,
            };
        });
        const sourceProperties = extractOtapiSourceProperties(item);
        const featured = (name: string) => Array.isArray(item.FeaturedValues)
            ? item.FeaturedValues.find((entry: any) => entry.Name === name)?.Value
            : undefined;
        return {
            id: `batch_${row._id}`,
            batchItemId: row._id,
            name: item.Title || item.OriginalTitle || 'Unknown Product',
            price: salePrice || originalPrice,
            description: cleanOtapiDescription(item) || result.rawDescription || '',
            images,
            category: '',
            collection: collection as CollectionType,
            variants,
            originalVariants: variants.map((variant: any) => ({ id: variant.id, name: variant.name, image: variant.image })),
            sourceId: String(item.Id || row._id),
            originalPrice,
            salePrice: salePrice || originalPrice,
            shippingInfo: { freeShipping: true, estimatedDays: '7-15', cost: 0 },
            seller: { id: item.VendorId || '', name: item.VendorDisplayName || item.VendorName || 'Unknown', rating: 0, feedbackScore: 0 },
            reviewCount: Number.parseInt(featured('SalesInLast30Days') || '0', 10),
            averageRating: 0,
            productUrl,
            source: '1688',
            selected: true,
            targetCollection: collection as CollectionType,
            customPrice: calculatePrice(salePrice || originalPrice),
            sourcePriceCny: getCny(item.PromotionPrice) || getCny(item.Price) || undefined,
            descriptionImages: result.descriptionImages || [],
            rawSourceDescription: result.rawDescription || '',
            rawHtmlDescription: result.rawHtmlDescription || '',
            sourceProperties: Object.keys(sourceProperties).length ? sourceProperties : undefined,
        };
    }

    const data = result.data || {};
    const currency = String(data.currency || 'USD').toUpperCase().trim();
    const rawPrice = Number(data.price || 0);
    const rate = CURRENCY_RATES_TO_USD[currency];
    if (!rate) throw new Error(`Unsupported source currency ${currency}.`);
    const price = Math.round(rawPrice * rate * 100) / 100;
    return {
        id: `batch_${row._id}`,
        batchItemId: row._id,
        name: data.title || 'Unknown Product',
        price,
        description: data.description || '',
        images: data.images?.length ? data.images : data.image ? [data.image] : [],
        category: '',
        collection: collection as CollectionType,
        variants: [],
        sourceId: String(row._id),
        originalPrice: price,
        salePrice: price,
        shippingInfo: { freeShipping: false, estimatedDays: 'Unknown', cost: 0 },
        seller: { id: '', name: 'Unknown', rating: 0, feedbackScore: 0 },
        reviewCount: 0,
        averageRating: 0,
        productUrl,
        source: 'generic',
        selected: true,
        targetCollection: collection as CollectionType,
        customPrice: calculatePrice(price),
        sourceCurrency: currency,
        sourcePriceOriginal: rawPrice,
    };
};
