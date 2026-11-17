import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const evidence = JSON.parse(await readFile('docs/quality/editorial-image-provenance.json', 'utf8'));
const manifest = JSON.parse(await readFile('lib/editorialImageManifest.json', 'utf8'));
assert.equal(evidence.recipe, 'editorial-webp-q85-effort6-orient-v1');
assert.equal(new Set(evidence.records.map((r) => r.source)).size, evidence.records.length);
assert.equal(Object.keys(manifest).length, evidence.records.length);
for (const record of evidence.records) {
  const entry = manifest[record.source];
  assert.ok(entry);
  assert.equal(
    entry.base,
    '/images/opt/editorial/' + hash(record.sha256 + ':' + evidence.recipe).slice(0, 24)
  );
  assert.equal(entry.ratio, record.height / record.width);
  assert.deepEqual(
    entry.widths,
    record.renditions.map((r) => r.width)
  );
  assert.deepEqual(
    entry.widths,
    [...new Set(entry.widths)].sort((a, b) => a - b)
  );
  for (const rendition of record.renditions) {
    assert.ok(rendition.width > 0 && rendition.width <= record.width);
    const bytes = await readFile('public' + entry.base + '-' + rendition.width + '.webp');
    assert.equal(hash(bytes), rendition.sha256);
    assert.equal(bytes.length, rendition.bytes);
    assert.ok(bytes.length < 160000, 'Editorial rendition exceeds transfer budget');
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, rendition.width);
    assert.ok(Math.abs(meta.height - rendition.width * entry.ratio) <= 1);
  }
}
console.log('Editorial source mappings, rendition hashes, dimensions and budgets verified.');
