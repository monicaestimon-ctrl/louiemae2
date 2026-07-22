import { describe, expect, it } from 'vitest';
import { buildBatchImportProduct, CURRENCY_RATES_TO_USD } from './batchImportProduct';

describe('buildBatchImportProduct', () => {
  it('prepares a generic source row for the review queue', () => {
    const product = buildBatchImportProduct({
      _id: 'item-1',
      normalizedUrl: 'https://example.com/item',
      resolvedUrl: 'https://example.com/item/42',
      result: { source: 'generic', data: { title: 'Linen Lamp', price: 20, currency: 'USD', images: ['https://example.com/lamp.jpg'] } },
    }, 'lighting', price => price * 3);

    expect(product.batchItemId).toBe('item-1');
    expect(product.productUrl).toBe('https://example.com/item/42');
    expect(product.customPrice).toBe(60);
    expect(product.selected).toBe(true);
  });

  it('extracts 1688 images, variants, and the resolved URL', () => {
    const product = buildBatchImportProduct({
      _id: 'item-2',
      normalizedUrl: 'https://m.1688.com/share/abc',
      resolvedUrl: 'https://detail.1688.com/offer/123.html',
      result: {
        source: '1688',
        data: {
          Id: '123',
          Title: 'Woven Basket',
          Price: { OriginalPrice: 100, ConvertedPriceList: { Internal: { Price: 14 } } },
          Pictures: [{ Large: { Url: 'https://example.com/basket.jpg' } }],
          ConfiguredItems: [{ Id: 'v1', Title: 'Natural', Price: { ConvertedPriceList: { Internal: { Price: 16 } } }, Quantity: 2 }],
        },
      },
    }, 'decor', price => price * 3);

    expect(product.source).toBe('1688');
    expect(product.images).toEqual(['https://example.com/basket.jpg']);
    expect(product.variants[0]).toMatchObject({ id: 'v1', name: 'Natural', priceAdjustment: 2, inStock: true });
    expect(product.productUrl).toBe('https://detail.1688.com/offer/123.html');
  });

  it('converts an unconverted 1688 OriginalPrice from CNY instead of treating it as USD', () => {
    const product = buildBatchImportProduct({
      _id: 'item-3',
      normalizedUrl: 'https://detail.1688.com/offer/456.html',
      result: { source: '1688', data: { Id: '456', Title: 'Cotton Throw', Price: { OriginalPrice: 100 } } },
    }, 'decor', price => price * 3);

    expect(product.price).toBeCloseTo(100 * CURRENCY_RATES_TO_USD.CNY, 2);
    expect(product.sourcePriceCny).toBe(100);
  });

  it('rejects an incomplete 1688 wrapper instead of creating a placeholder review item', () => {
    expect(() => buildBatchImportProduct({
      _id: 'item-4',
      normalizedUrl: 'https://m.1688.com/share/abc',
      result: { source: '1688', data: { Result: { HasError: false } } },
    }, 'decor', price => price * 3)).toThrow('missing the product title');
  });
});
