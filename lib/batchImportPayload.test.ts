import { describe, expect, it } from 'vitest';
import { assertBatchImportPayloadSize, compactBatchImportResult, getSerializedByteLength } from './batchImportPayload';
import { buildBatchImportProduct } from './batchImportProduct';

describe('batch import payload compaction', () => {
    it('preserves review/import fields while dropping raw provider bulk', () => {
        const original = {
            source: '1688',
            resolvedUrl: 'https://detail.1688.com/offer/123.html',
            rawDescription: 'Soft linen dress',
            rawHtmlDescription: `<div>${'provider markup '.repeat(20_000)}</div>`,
            descriptionImages: ['https://cdn.example/detail.jpg'],
            data: {
                Result: {
                    Id: '123',
                    Title: 'Linen Dress',
                    OriginalTitle: 'Original Linen Dress',
                    PromotionPrice: { OriginalPrice: 100, ConvertedPriceList: { Internal: { Price: 14 } } },
                    Price: { OriginalPrice: 120, ConvertedPriceList: { Internal: { Price: 17 } } },
                    Pictures: [{ Large: { Url: 'https://cdn.example/main.jpg' } }],
                    ConfiguredItems: [{
                        Id: 'blue-small',
                        Title: 'Blue / Small',
                        Quantity: 4,
                        Price: { OriginalPrice: 105, ConvertedPriceList: { Internal: { Price: 15 } } },
                        Configurators: [{ PropertyName: 'Color', Value: 'Blue' }, { PropertyName: 'Size', Value: 'S' }],
                    }],
                    FeaturedValues: [{ Name: 'Material', Value: 'Linen' }],
                    massiveProviderDebugObject: { rows: new Array(10_000).fill('unused') },
                },
            },
        };
        const compact = compactBatchImportResult(original);
        const product = buildBatchImportProduct(
            { _id: 'item', normalizedUrl: original.resolvedUrl, result: compact },
            'fashion',
            (price) => price * 2,
        );

        expect(product).toMatchObject({
            name: 'Linen Dress',
            price: 14,
            originalPrice: 17,
            images: ['https://cdn.example/main.jpg'],
            sourcePriceCny: 100,
        });
        expect(product.variants).toHaveLength(1);
        expect(product.sourceProperties?.Material).toBe('Linen');
        expect(compact.rawHtmlDescription).toBe('');
        expect(getSerializedByteLength(compact)).toBeLessThan(getSerializedByteLength(original) / 20);
        expect(() => assertBatchImportPayloadSize(compact)).not.toThrow();
    });

    it('bounds generic images and text', () => {
        const compact = compactBatchImportResult({
            source: 'generic',
            data: {
                title: 'x'.repeat(1_000),
                description: 'y'.repeat(10_000),
                images: Array.from({ length: 100 }, (_, index) => `https://example.com/${index}.jpg`),
                price: 25,
                currency: 'USD',
            },
        });
        expect((compact.data as any).title).toHaveLength(500);
        expect((compact.data as any).description).toHaveLength(4_000);
        expect((compact.data as any).images).toHaveLength(24);
    });
});
