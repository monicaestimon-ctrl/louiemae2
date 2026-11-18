// Explicit cached, source-verified originals only. No product publication or remote downloads.
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { orientProductSource } from './product-image-orientation.mjs';
const source = process.argv[2];
if (!source)
  throw new Error('Provide one exact source URL from the verified product image manifest');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const originals = JSON.parse(await readFile('docs/quality/product-image-provenance.json', 'utf8'));
const manifest = JSON.parse(await readFile('lib/productImageManifest.json', 'utf8'));
const evidence = JSON.parse(await readFile('docs/quality/product-format-provenance.json', 'utf8'));
const original = originals.records.find((record) => record.source === source);
const entry = manifest[source];
if (!original || !entry) throw new Error('Source is not in the verified product image manifest');
const bytes = await readFile('artifacts/lighthouse/product-originals/' + hash(source));
if (hash(bytes) !== original.sha256)
  throw new Error('Cached original does not match source evidence');
const recipe = 'avif-quality65-effort7-lossless-orientation-v1';
const base = '/images/opt/product-formats/' + hash(hash(bytes) + '|' + recipe).slice(0, 24);
const oriented = await orientProductSource(bytes);
const renditions = [];
const staged = [];
for (const width of entry.widths) {
  const output = await sharp(oriented.data)
    .resize({ width, withoutEnlargement: true })
    .avif({ quality: 65, effort: 7 })
    .toBuffer();
  const webp = original.renditions.find((record) => record.width === width);
  if (!webp || output.length >= webp.bytes)
    throw new Error('Format does not improve every same-width fallback');
  staged.push({ path: `public${base}-${width}.avif`, output });
  renditions.push({ width, bytes: output.length, webpBytes: webp.bytes, sha256: hash(output) });
}
evidence.records = evidence.records.filter((record) => record.source !== source);
evidence.records.push({ source, sourceSha256: hash(bytes), recipe, base, renditions });
evidence.records.sort((a, b) => a.source.localeCompare(b.source));
entry.avifBase = base;
// Nothing enters the build tree until the entire family and its evidence have passed.
await mkdir('public/images/opt/product-formats', { recursive: true });
for (const file of staged) await writeFile(file.path, file.output);
await writeFile('lib/productImageManifest.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  'docs/quality/product-format-provenance.json',
  JSON.stringify(evidence, null, 2) + '\n'
);
console.log(JSON.stringify({ source, base, renditions }));
