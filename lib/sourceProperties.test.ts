import { serializeSourceProperties, sourcePropertyEntries } from './sourceProperties';
import { describe, expect, it } from 'vitest';
import { convexToJson } from 'convex/values';
import { buildBatchImportProduct } from './batchImportProduct';
import { sourceFromImportPayload } from './productSourceAdapters';

const result = { source: '1688', data: { Title: 'Supplier Barstool', Price: { OriginalPrice: 100 },
  Properties: [{ PropertyName: '尺寸', Value: '65厘米' }, { PropertyName: '材质', Value: '白蜡木' }],
  Pictures: [{ Url: 'https://example.com/stool.jpg' }], ConfiguredItems: [],
} };

describe('supplier property transport', () => {
  it('can send a mapped supplier product to Convex without dropping original property names or values', () => {
    const product = buildBatchImportProduct({ _id: 'item', normalizedUrl: 'https://detail.1688.com/offer/999860531975.html', result }, 'furniture', price => price * 2);
    expect(() => convexToJson({ sourceProperties: product.sourceProperties })).not.toThrow();
    expect(product.sourceProperties).toEqual([{ key: '尺寸', value: '65厘米' }, { key: '材质', value: '白蜡木' }]);
  });
  it('keeps the original supplier labels in generation evidence', () => {
    const snapshot = sourceFromImportPayload(result, 'https://detail.1688.com/offer/999860531975.html');
    expect(snapshot.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: '尺寸', value: '65厘米', source: 'otapi_property' }),
      expect.objectContaining({ key: '材质', value: '白蜡木', source: 'otapi_property' }),
    ]));
  });
});
it('preserves legacy maps, reserved labels and already serialized entries across edits', () => {
  const legacy = Object.fromEntries([['Material', 'Oak'], ['$supplier', '原厂'], ['', 'Unnamed value'], ['尺寸', '65厘米']]);
  const entries = serializeSourceProperties(legacy);
  expect(() => convexToJson({ sourceProperties: entries })).not.toThrow();
  expect(entries).toEqual(Object.entries(legacy).map(([key, value]) => ({ key, value })));
  expect(serializeSourceProperties(entries)).toEqual(entries);
  expect(sourcePropertyEntries({ Material: 'Oak' })).toEqual([{ key: 'Material', value: 'Oak' }]);
  expect(serializeSourceProperties(undefined)).toBeUndefined();
});