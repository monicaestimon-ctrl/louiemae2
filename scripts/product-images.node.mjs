import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { productImageBase, PRODUCT_IMAGE_RECIPE } from './product-image-key.mjs';
import { orientProductSource } from './product-image-orientation.mjs';

test('JPEG orientation preserves every decoded pixel before the intended WebP encoding', async () => {
  const pixels = Buffer.from(Array.from({ length: 32 * 48 * 3 }, (_, index) => (index * 73) % 256));
  const original = await sharp(pixels, { raw: { width: 32, height: 48, channels: 3 } }).jpeg({ quality: 96 }).withMetadata({ orientation: 6 }).toBuffer();
  const expected = await sharp(original).rotate().raw().toBuffer({ resolveWithObject: true });
  const oriented = await orientProductSource(original);
  assert.equal(oriented.info.format, 'png');
  const actual = await sharp(oriented.data).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(actual.data, expected.data);
  assert.deepEqual([actual.info.width, actual.info.height], [48, 32]);
});

test('changed source bytes or encoding recipe cannot reuse an old rendition URL', () => {
  const original = 'a'.repeat(64);
  const key = productImageBase(original, PRODUCT_IMAGE_RECIPE);
  assert.notEqual(productImageBase('b'.repeat(64), PRODUCT_IMAGE_RECIPE), key);
  assert.notEqual(productImageBase(original, 'webp85-effort6-v1'), key);
  assert.throws(() => productImageBase('missing', PRODUCT_IMAGE_RECIPE));
});
