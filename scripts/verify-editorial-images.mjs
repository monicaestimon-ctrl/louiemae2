import { EDITORIAL_WINDOWS, EDITORIAL_WINDOW_RECIPE } from './editorial-image-windows.mjs';
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
  assert.deepEqual(Object.keys(entry.windows).sort(), Object.keys(EDITORIAL_WINDOWS).sort());
  for (const [name, ratio] of Object.entries(EDITORIAL_WINDOWS)) {
    const window = entry.windows[name];
    const source = record.windows[name];
    assert.equal(source.recipe, EDITORIAL_WINDOW_RECIPE);
    assert.equal(window.ratio, ratio);
    assert.equal(
      window.base,
      '/images/opt/editorial/' +
        hash(record.sha256 + ':' + EDITORIAL_WINDOW_RECIPE + ':' + name).slice(0, 24)
    );
    assert.deepEqual(
      window.widths,
      source.renditions.map((r) => r.width)
    );
    for (const r of source.renditions) {
      assert.ok(r.width > 0 && r.width <= record.width);
      assert.equal(r.height, Math.round(r.width * ratio));
      assert.ok(r.height <= record.height);
      const bytes = await readFile('public' + window.base + '-' + r.width + '.webp');
      assert.equal(hash(bytes), r.sha256);
      assert.equal(bytes.length, r.bytes);
      assert.ok(bytes.length < 160000);
      const meta = await sharp(bytes).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, r.width);
      assert.equal(meta.height, r.height);
    }
    assert.ok(window.avifBase, 'Reviewed editorial windows require an AVIF source');
    assert.equal(source.avif.recipe, 'editorial-avif-q55-effort6-cover-centre-v1');
    assert.equal(
      window.avifBase,
      '/images/opt/editorial/' +
        hash(record.sha256 + ':' + source.avif.recipe + ':' + name).slice(0, 24)
    );
    assert.deepEqual(
      source.avif.renditions.map((r) => r.width),
      window.widths
    );
    for (const r of source.avif.renditions) {
      const bytes = await readFile('public' + window.avifBase + '-' + r.width + '.avif');
      assert.equal(hash(bytes), r.sha256);
      assert.equal(bytes.length, r.bytes);
      assert.ok(bytes.length < 160000, 'AVIF exceeds editorial transfer budget');
      assert.equal(r.height, Math.round(r.width * ratio));
      const meta = await sharp(bytes).metadata();
      assert.equal(meta.format, 'heif');
      assert.equal(meta.compression, 'av1');
      assert.equal(meta.width, r.width);
      assert.equal(meta.height, r.height);
    }
  }
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
