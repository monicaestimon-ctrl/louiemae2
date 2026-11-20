import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PRODUCT_IMAGE_RECIPE, productImageBase } from './product-image-key.mjs';

const manifest = JSON.parse(await readFile('lib/productImageManifest.json', 'utf8'));
const evidence = JSON.parse(await readFile('docs/quality/product-image-provenance.json', 'utf8'));
assert.equal(evidence.recipe, PRODUCT_IMAGE_RECIPE, 'Provenance must use the current encoding recipe');
assert.ok(evidence.records.length > 0, 'Missing source evidence');
assert.equal(new Set(evidence.records.map(r => r.source)).size, evidence.records.length);
assert.equal(Object.keys(manifest).length, evidence.records.length);
let bytes = 0;
for (const record of evidence.records) {
  const entry = manifest[record.source];
  assert.ok(entry, 'Every source needs an exact manifest mapping');
  assert.match(entry.base, /^\/images\/opt\/products\/[a-f0-9]{24}$/);
  assert.equal(entry.base, productImageBase(record.sha256, evidence.recipe), 'Image key must match its source hash and recipe');
  assert.deepEqual(entry.widths, record.renditions.map(r => r.width));
  assert.equal(new Set(entry.widths).size, entry.widths.length);
  assert.deepEqual(entry.widths, [...entry.widths].sort((a,b) => a-b));
  assert.equal(entry.ratio, record.height / record.width);
  for (const rendition of record.renditions) {
    assert.ok(rendition.width > 0 && rendition.width <= Math.min(record.width, 1600));
    const data = await readFile(`public${entry.base}-${rendition.width}.webp`);
    assert.equal(createHash('sha256').update(data).digest('hex'), rendition.sha256);
    assert.equal(data.length, rendition.bytes);
    const metadata = await sharp(data).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, rendition.width);
    assert.ok(Math.abs(metadata.height - rendition.width * entry.ratio) <= 1);
    bytes += data.length;
  }
}
console.log(JSON.stringify({ sources: evidence.records.length, renditionBytes: bytes, status: 'verified' }));
