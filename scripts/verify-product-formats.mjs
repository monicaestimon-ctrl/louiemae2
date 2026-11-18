import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const manifest = JSON.parse(await readFile('lib/productImageManifest.json', 'utf8'));
const originals = JSON.parse(await readFile('docs/quality/product-image-provenance.json', 'utf8'));
const { records } = JSON.parse(
  await readFile('docs/quality/product-format-provenance.json', 'utf8')
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.ok(records.length > 0, 'Prepared product formats need source evidence');
assert.equal(new Set(records.map((record) => record.source)).size, records.length);
assert.equal(Object.values(manifest).filter((entry) => entry.avifBase).length, records.length);
for (const record of records) {
  const original = originals.records.find((item) => item.source === record.source);
  const entry = manifest[record.source];
  assert.ok(original && entry, 'Format must belong to an existing exact-source product image');
  assert.equal(record.sourceSha256, original.sha256);
  assert.equal(record.recipe, 'avif-quality65-effort7-lossless-orientation-v1');
  assert.equal(
    record.base,
    '/images/opt/product-formats/' + hash(record.sourceSha256 + '|' + record.recipe).slice(0, 24)
  );
  assert.equal(entry.avifBase, record.base);
  assert.ok(entry.widths.length > 0);
  assert.deepEqual(
    entry.widths,
    record.renditions.map((item) => item.width)
  );
  for (const rendition of record.renditions) {
    assert.ok(
      Number.isSafeInteger(rendition.width) &&
        rendition.width > 0 &&
        rendition.width <= original.width
    );
    const bytes = await readFile(`public${record.base}-${rendition.width}.avif`);
    assert.equal(bytes.length, rendition.bytes);
    assert.equal(hash(bytes), rendition.sha256);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.compression, 'av1');
    assert.equal(metadata.width, rendition.width);
    assert.ok(Math.abs(metadata.height - rendition.width * entry.ratio) <= 1);
    const webp = await readFile(`public${entry.base}-${rendition.width}.webp`);
    assert.equal(webp.length, rendition.webpBytes);
    assert.ok(bytes.length < webp.length, 'Prepared AVIF must reduce same-width transfer');
  }
}
console.log(`${records.length} exact-source product format families verified.`);
