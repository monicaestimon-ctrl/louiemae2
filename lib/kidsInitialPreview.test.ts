import { expect, it } from 'vitest';
import { CATALOG_VERSION } from './catalogVersion';
import { kidsInitialPreview } from './kidsInitialPreview';
const product = {
  _id: 'kid1',
  name: 'Preview dress',
  price: 32.5,
  images: ['/images/dress.webp'],
  category: 'Dresses',
  variantCount: 3,
  isNew: true,
};
const payload = (products: unknown[] = [product]) => ({
  ready: true,
  version: CATALOG_VERSION,
  products,
});
it('projects only public preview fields and preserves valid empty state', () => {
  expect(
    kidsInitialPreview(
      payload([{ ...product, cost: 2, trade: 5, inStock: true, privateSupplier: { secret: true } }])
    )?.products
  ).toEqual([product]);
  expect(kidsInitialPreview(payload([]))).toEqual(payload([]));
});
it.each([
  null,
  {},
  { ...payload(), ready: false },
  { ...payload(), version: CATALOG_VERSION - 1 },
  payload(Array(9).fill(product)),
  payload([product, product]),
])('rejects unverified, stale, excessive or duplicated data', (value) =>
  expect(kidsInitialPreview(value)).toBeUndefined()
);
it.each([
  { price: -1 },
  { price: Infinity },
  { price: NaN },
  { variantCount: -1 },
  { variantCount: 1.2 },
  { _id: '../private' },
  { name: 'x'.repeat(301) },
  { images: ['/a', '/b'] },
  { images: [42] },
  { images: ['x'.repeat(2049)] },
  { isNew: 'true' },
])('rejects invalid public row fields', (update) =>
  expect(kidsInitialPreview(payload([{ ...product, ...update }]))).toBeUndefined()
);
it('accepts exactly eight cards in source order without mutating the source', () => {
  const input = payload(Array.from({ length: 8 }, (_, i) => ({ ...product, _id: 'kid' + i })));
  const result = kidsInitialPreview(input)!;
  expect(result.products.map((p) => p._id)).toEqual(
    input.products.map((p) => (p as typeof product)._id)
  );
  result.products[0].images.push('/other');
  expect((input.products[0] as typeof product).images).toEqual(['/images/dress.webp']);
});

it.each(['', 'javascript:alert(1)', '//untrusted.invalid/x', 'http://untrusted.invalid/x', 'https://'])('keeps cards while dropping an unusable first image %s', image => {
 const input=payload([{...product,images:[image]}]);
 expect(kidsInitialPreview(input)?.products).toEqual([{...product,images:[]}]);
 expect((input.products[0] as typeof product).images).toEqual([image]);
});
