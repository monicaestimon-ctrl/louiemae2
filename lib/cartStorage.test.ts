import { expect, it } from 'vitest';
import { restoreCart, savedCartItem, validCartQuantity } from './cartStorage';
const line = {
  product: {
    id: 'chair',
    name: 'Chair',
    price: 100,
    images: ['https://example.com/chair.jpg'],
    fulfillmentProvider: 'ashcroft',
    cost: 25,
    supplierContact: 'private',
  },
  quantity: 2,
  selectedVariant: { id: 'tan', name: 'Tan', priceAdjustment: 10, inStock: true, cjSku: 'private' },
};
it('restores bounded display fields without persisting supplier data', () => {
  const result = restoreCart(JSON.stringify([line]));
  expect(result.recoveryNotice).toBe('');
  expect(result.items[0]).toMatchObject({
    quantity: 2,
    product: { id: 'chair', price: 100 },
    selectedVariant: { id: 'tan', priceAdjustment: 10 },
  });
  expect(result.items[0].product).not.toHaveProperty('cost');
  expect(result.items[0].product).not.toHaveProperty('supplierContact');
  expect(result.items[0].selectedVariant).not.toHaveProperty('cjSku');
});
it.each([0, -1, 0.5, Infinity, NaN, 10001, '2', null])('rejects unsafe quantities %j', (value) =>
  expect(validCartQuantity(value)).toBe(false)
);
it.each([
  '{',
  '{}',
  'null',
  '[null]',
  JSON.stringify([{ ...line, quantity: 0 }]),
  'x'.repeat(256001),
])('recovers malformed storage %s', (raw) => {
  const result = restoreCart(raw);
  expect(result.items).toEqual([]);
  expect(result.recoveryNotice).toBeTruthy();
});
it('retains valid lines while reporting invalid or duplicate records', () => {
  const result = restoreCart(JSON.stringify([line, null, line]));
  expect(result.items).toHaveLength(1);
  expect(result.recoveryNotice).toBeTruthy();
});
it('rejects invalid variants and negative adjusted prices', () => {
  expect(
    savedCartItem({ ...line, selectedVariant: { ...line.selectedVariant, priceAdjustment: -101 } })
  ).toBeNull();
  expect(savedCartItem({ ...line, selectedVariant: { id: 'tan' } })).toBeNull();
});
it('allows separate variants without summing or silently rounding quantities', () => {
  const result = restoreCart(
    JSON.stringify([
      line,
      { ...line, selectedVariant: { ...line.selectedVariant, id: 'black' }, quantity: 3 },
    ])
  );
  expect(result.items.map((i) => i.quantity)).toEqual([2, 3]);
  expect(result.recoveryNotice).toBe('');
});
it('does not restore unsupported providers or active image URLs', () => {
  expect(
    savedCartItem({ ...line, product: { ...line.product, fulfillmentProvider: 'unknown' } })
  ).toBeNull();
  expect(
    savedCartItem({
      ...line,
      product: { ...line.product, images: ['javascript:alert(1)', '//example.com/x', '/safe.png'] },
    })?.product.images
  ).toEqual(['/safe.png']);
});
it('keeps valid public selling rules as saved display metadata and omits malformed rules', () => {
  const selectedVariant = {
    ...line.selectedVariant,
    quantityRules: { minimum: 3, increment: 2, piecesPerPack: 2, supplierCost: 10 },
  };
  expect(savedCartItem({ ...line, selectedVariant })?.selectedVariant?.quantityRules).toEqual({
    minimum: 3,
    increment: 2,
    piecesPerPack: 2,
  });
  expect(
    savedCartItem({
      ...line,
      selectedVariant: { ...selectedVariant, quantityRules: { minimum: 0, increment: 1 } },
    })?.selectedVariant?.quantityRules
  ).toBeUndefined();
  expect(validCartQuantity(9999)).toBe(true);
  expect(validCartQuantity(10000)).toBe(false);
});
