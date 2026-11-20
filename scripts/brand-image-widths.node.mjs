import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandImageWidths } from './brand-image-widths.mjs';
test('only the reviewed portrait receives a360width', () => {
  assert.deepEqual(brandImageWidths('/images/brand/girls-dress.png', 533), [360, 480, 533]);
  assert.deepEqual(brandImageWidths('/images/brand/boys-category.png', 640), [480, 640]);
  assert.deepEqual(
    brandImageWidths('/images/brand/girls-dress1.png', 2000),
    [480, 640, 800, 960, 1600]
  );
});
test('never upscales or duplicates widths', () => {
  for (const source of ['/images/brand/girls-dress.png', '/other.png'])
    for (const width of [1, 200, 360, 480, 533, 640, 1600, 2000]) {
      const result = brandImageWidths(source, width);
      assert.ok(result.every((w) => w <= width && w <= 1600));
      assert.deepEqual(
        result,
        [...new Set(result)].sort((a, b) => a - b)
      );
    }
});
test('rejects unavailable geometry instead of generating misleading source sets', () => {
  for (const width of [0, -1, NaN, Infinity, 1.5, undefined])
    assert.throws(() => brandImageWidths('/images/brand/girls-dress.png', width));
});
