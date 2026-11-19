import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const e = JSON.parse(await readFile('docs/quality/fashion-category-image-provenance.json', 'utf8'));
const m = JSON.parse(await readFile('lib/imageManifest.json', 'utf8'))[e.source];
const hash = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(e.source, '/images/brand/mae-dress.png');
assert.equal(e.recipe, 'avif-quality40-effort7-lossless-orientation-v1');
assert.equal(hash(await readFile('public' + e.source)), e.sha256);
assert.equal(e.base, '/images/opt/brand-formats/' + hash(e.sha256 + '|' + e.recipe).slice(0, 24));
assert.equal(m.avifBase, e.base);
assert.ok(m.widths.length > 0, 'Fashion category requires at least one rendition');
assert.deepEqual(
  m.widths,
  e.renditions.map((r) => r.width)
);
for (const r of e.renditions) {
  const b = await readFile('public' + e.base + '-' + r.width + '.avif');
  assert.equal(b.length, r.bytes);
  assert.equal(hash(b), r.sha256);
  const meta = await sharp(b).metadata();
  assert.equal(meta.compression, 'av1');
  assert.equal(meta.width, r.width);
  assert.ok(Math.abs(meta.height - r.width * m.ratio) <= 1);
  const fallback = await readFile('public' + m.base + '-' + r.width + '.webp');
  assert.ok(b.length < fallback.length, 'AVIF must reduce bytes at the same width');
}
console.log(
  'Fashion category source, AVIF hashes, geometry and same-width byte reduction verified.'
);
