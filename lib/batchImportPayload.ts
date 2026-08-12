/**
 * Compact durable representation of a scrape result. The scraper may return a
 * very large provider response; the review/import UI only needs the fields
 * selected here. Keep this module pure so it can run in Convex and tests.
 */
export const BATCH_IMPORT_PAYLOAD_VERSION = 1 as const;
export const MAX_BATCH_RESULT_BYTES = 350_000;

const truncate = (value: unknown, max: number): string | undefined =>
    typeof value === 'string' ? value.slice(0, max) : undefined;

const finiteNumber = (value: unknown): number | undefined => {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
};

const compactPrice = (price: any) => price && typeof price === 'object' ? {
    OriginalPrice: finiteNumber(price.OriginalPrice),
    ConvertedPriceList: price.ConvertedPriceList ? {
        Internal: { Price: finiteNumber(price.ConvertedPriceList?.Internal?.Price) },
        Original: { Price: finiteNumber(price.ConvertedPriceList?.Original?.Price) },
    } : undefined,
} : undefined;

const compactPicture = (picture: any) => {
    if (typeof picture === 'string') return picture.slice(0, 2_048);
    if (!picture || typeof picture !== 'object') return undefined;
    return {
        Url: truncate(picture.Url, 2_048),
        Large: picture.Large ? { Url: truncate(picture.Large.Url, 2_048) } : undefined,
        Medium: picture.Medium ? { Url: truncate(picture.Medium.Url, 2_048) } : undefined,
        Original: picture.Original ? { Url: truncate(picture.Original.Url, 2_048) } : undefined,
    };
};

const compactArray = <T>(value: unknown, limit: number, mapper: (entry: any) => T | undefined): T[] =>
    Array.isArray(value)
        ? value.slice(0, limit).map(mapper).filter((entry): entry is T => entry !== undefined)
        : [];

const compact1688Item = (item: any) => ({
    Id: truncate(item?.Id, 256) ?? finiteNumber(item?.Id),
    Title: truncate(item?.Title, 500),
    OriginalTitle: truncate(item?.OriginalTitle, 500),
    Description: truncate(typeof item?.Description === 'string' ? item.Description : undefined, 4_000),
    MainPictureUrl: truncate(item?.MainPictureUrl, 2_048),
    VendorId: truncate(item?.VendorId, 256),
    VendorDisplayName: truncate(item?.VendorDisplayName, 500),
    VendorName: truncate(item?.VendorName, 500),
    Price: compactPrice(item?.Price),
    PromotionPrice: compactPrice(item?.PromotionPrice),
    Pictures: compactArray(item?.Pictures, 24, compactPicture),
    PropertyPictures: compactArray(item?.PropertyPictures, 24, compactPicture),
    ItemImages: compactArray(item?.ItemImages, 24, compactPicture),
    FeaturedValues: compactArray(item?.FeaturedValues, 80, (entry) => entry ? ({
        Name: truncate(entry.Name, 200),
        Value: truncate(entry.Value, 1_000),
    }) : undefined),
    Properties: compactArray(item?.Properties, 80, (entry) => entry ? ({
        PropertyName: truncate(entry.PropertyName, 200),
        Name: truncate(entry.Name, 200),
        Value: truncate(entry.Value, 1_000),
        DisplayValue: truncate(entry.DisplayValue, 1_000),
    }) : undefined),
    ConfiguredItems: compactArray(item?.ConfiguredItems, 250, (entry) => entry ? ({
        Id: truncate(entry.Id, 256) ?? finiteNumber(entry.Id),
        Title: truncate(entry.Title, 500),
        Quantity: finiteNumber(entry.Quantity),
        MasterQuantity: finiteNumber(entry.MasterQuantity),
        Price: compactPrice(entry.Price),
        Pictures: compactArray(entry.Pictures, 3, compactPicture),
        Configurators: compactArray(entry.Configurators, 12, (configurator) => configurator ? ({
            PropertyName: truncate(configurator.PropertyName, 200),
            Pid: truncate(configurator.Pid, 200) ?? finiteNumber(configurator.Pid),
            Value: truncate(configurator.Value, 500),
            Vid: truncate(configurator.Vid, 200) ?? finiteNumber(configurator.Vid),
        }) : undefined),
    }) : undefined),
});

export type CompactBatchImportResult = ReturnType<typeof compactBatchImportResult>;

export const compactBatchImportResult = (result: any) => {
    const resolvedUrl = truncate(result?.resolvedUrl, 2_048);
    if (result?.source === '1688') {
        const sourceItem = result.data?.Result ?? result.data ?? {};
        return {
            payloadVersion: BATCH_IMPORT_PAYLOAD_VERSION,
            source: '1688' as const,
            resolvedUrl,
            data: compact1688Item(sourceItem),
            descriptionImages: compactArray(result.descriptionImages, 24, (image) => truncate(image, 2_048)),
            rawDescription: truncate(result.rawDescription, 4_000),
            // Raw provider HTML is intentionally not retained after normalization.
            rawHtmlDescription: '',
        };
    }

    const data = result?.data ?? {};
    const images = compactArray(data.images, 24, (image) => truncate(image, 2_048));
    return {
        payloadVersion: BATCH_IMPORT_PAYLOAD_VERSION,
        source: 'generic' as const,
        resolvedUrl,
        data: {
            title: truncate(data.title, 500) ?? 'Unknown Product',
            description: truncate(data.description, 4_000) ?? '',
            image: truncate(data.image, 2_048) ?? images[0] ?? null,
            images,
            price: finiteNumber(data.price) ?? 0,
            currency: truncate(data.currency, 12) ?? 'USD',
            url: truncate(data.url, 2_048),
        },
    };
};

export const getSerializedByteLength = (value: unknown): number =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const assertBatchImportPayloadSize = (value: unknown): number => {
    const bytes = getSerializedByteLength(value);
    if (bytes > MAX_BATCH_RESULT_BYTES) {
        throw new Error(`Normalized product payload is too large (${bytes} bytes; max ${MAX_BATCH_RESULT_BYTES}).`);
    }
    return bytes;
};
