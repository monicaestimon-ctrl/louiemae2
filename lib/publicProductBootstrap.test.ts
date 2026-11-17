import { afterEach, expect, it } from 'vitest';
import { publicProductSnapshot, readProductBootstrap, serializeProductBootstrap } from './publicProductBootstrap';
const product = { _id: 'selected', name: 'Chair </script>', description: 'Public description', category: 'Chairs', collection: 'furniture', price: 100, images: ['/chair.png'], inStock: true, fulfillmentProvider: 'zuo',
  supplierCost: 12, tradePrice: 80, variants: [{ id: 'oak', name: 'Oak', priceAdjustment: 5, inStock: true, supplierCost: 5, cjVariantId: 'private-mapping' }] };
afterEach(() => { document.getElementById('lm-product-bootstrap')?.remove(); });
it('serializes only selected public fields and escapes script boundaries', () => {
  const json = serializeProductBootstrap(product);
  expect(json).not.toContain('</script>');
  for (const field of ['supplierCost', 'tradePrice', 'cjVariantId', 'private-mapping']) expect(json).not.toContain(field);
  expect(JSON.parse(json).product.variants[0]).toEqual({ id: 'oak', name: 'Oak', priceAdjustment: 5, inStock: true });
  expect(publicProductSnapshot({ ...product, price: NaN })).toBeNull();
});
it('rejects expired, mismatched and malformed initial documents', () => {
  const element = document.createElement('script'); element.id = 'lm-product-bootstrap'; element.type = 'application/json'; element.dataset.productId = 'selected'; document.head.append(element);
  element.textContent = serializeProductBootstrap(product);
  expect(readProductBootstrap('selected')?.product.name).toBe(product.name);
  expect(readProductBootstrap('different')).toBeNull();
  element.textContent = serializeProductBootstrap(product, Date.now() - 31_000); expect(readProductBootstrap('selected')).toBeNull();
  element.textContent = '<broken'; expect(readProductBootstrap('selected')).toBeNull();
});
