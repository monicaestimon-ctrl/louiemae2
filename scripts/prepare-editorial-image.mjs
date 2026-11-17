import { EDITORIAL_WINDOWS, EDITORIAL_WINDOW_RECIPE } from './editorial-image-windows.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { URL } from 'node:url';
// Explicit downloaded public source and evidence; never changes supplier records.
const [evidencePath, sourcePath] = process.argv.slice(2);
if (!evidencePath || !sourcePath)
  throw Error(
    'Usage: node scripts/prepare-editorial-image.mjs <source-evidence.json> <original-image>'
  );
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const source = new URL(evidence.source);
if (
  source.protocol !== 'https:' ||
  source.username ||
  source.password ||
  source.search ||
  source.hash
)
  throw Error('Expected an immutable public HTTPS image URL');
const original = await readFile(sourcePath);
if (original.length !== evidence.bytes || original.length > 30_000_000)
  throw Error('Source byte count mismatch or size limit exceeded');
const metadata = await sharp(original, { limitInputPixels: 50_000_000 }).metadata();
if (
  metadata.width !== evidence.width ||
  metadata.height !== evidence.height ||
  (metadata.pages ?? 1) > 1 ||
  metadata.orientation > 1
)
  throw Error('Review source geometry/orientation before preparing renditions');
const hash = (b) => createHash('sha256').update(b).digest('hex');
if (hash(original) !== evidence.sha256) throw Error('Source checksum mismatch');
const recipe = 'editorial-webp-q85-effort6-orient-v1';
const base = '/images/opt/editorial/' + hash(evidence.sha256 + ':' + recipe).slice(0, 24);
const widths = [
  ...new Set(
    [320, 480, 640, 960, 1280, 1600]
      .filter((w) => w < evidence.width)
      .concat(Math.min(evidence.width, 1600))
  ),
];
const renditions = [];
await mkdir('public/images/opt/editorial', { recursive: true });
for (const width of widths) {
  const bytes = await sharp(original)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 85, effort: 6 })
    .toBuffer();
  await writeFile('public' + base + '-' + width + '.webp', bytes);
  renditions.push({ width, bytes: bytes.length, sha256: hash(bytes) });
}
const windows = {};
const windowEvidence = {};
for (const [name, ratio] of Object.entries(EDITORIAL_WINDOWS)) {
  const windowBase =
    '/images/opt/editorial/' +
    hash(evidence.sha256 + ':' + EDITORIAL_WINDOW_RECIPE + ':' + name).slice(0, 24);
  const windowWidths = widths.filter(
    (width) => width <= evidence.width && Math.round(width * ratio) <= evidence.height
  );
  const outputs = [];
  for (const width of windowWidths) {
    const height = Math.round(width * ratio);
    const bytes = await sharp(original)
      .resize({ width, height, fit: 'cover', position: 'centre', withoutEnlargement: true })
      .webp({ quality: 85, effort: 6 })
      .toBuffer();
    await writeFile('public' + windowBase + '-' + width + '.webp', bytes);
    outputs.push({ width, height, bytes: bytes.length, sha256: hash(bytes) });
  }
  if (!outputs.length) throw Error('Source is too small for reviewed editorial windows');
  windows[name] = { base: windowBase, widths: windowWidths, ratio };
  windowEvidence[name] = { recipe: EDITORIAL_WINDOW_RECIPE, ratio, renditions: outputs };
}
const manifest = JSON.parse(await readFile('lib/editorialImageManifest.json', 'utf8'));
const provenance = JSON.parse(
  await readFile('docs/quality/editorial-image-provenance.json', 'utf8')
);
if (provenance.recipe !== recipe)
  throw Error('Encoding recipe migration requires a separate review');
manifest[evidence.source] = { base, widths, ratio: evidence.height / evidence.width, windows };
const records = provenance.records
  .filter((record) => record.source !== evidence.source)
  .concat({ ...evidence, renditions, windows: windowEvidence })
  .sort((a, b) => a.source.localeCompare(b.source));
await writeFile('lib/editorialImageManifest.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  'docs/quality/editorial-image-provenance.json',
  JSON.stringify({ recipe, records }, null, 2) + '\n'
);
