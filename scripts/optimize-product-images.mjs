/* global fetch, AbortSignal */
// Explicit public-catalog snapshot -> immutable, source-keyed hero renditions.
// Does not publish products, alter inventory, or replace source photographs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const input = process.argv[2];
if (!input) throw new Error('Provide an explicit public retail catalog JSON snapshot');
const sourceBytes = await readFile(input);
const catalog = JSON.parse(sourceBytes.toString('utf8').replace(/^\uFEFF/, ''));
if (!Array.isArray(catalog)) throw new Error('Expected a public catalog array');
const sources = [...new Set(catalog.map(p => p.images?.[0]).filter(Boolean))].sort();
const directory = 'public/images/opt/products';
const cache = 'artifacts/lighthouse/product-originals';
await mkdir(directory, { recursive: true });
await mkdir(cache, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = {};
const records = [];
for (const source of sources) {
  const url = new URL(source);
  if (url.origin !== 'https://diligent-jay-261.convex.cloud' || !/^\/api\/storage\/[a-z0-9-]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error(`Unexpected public image source: ${source}`);
  }
  const cached = path.join(cache, hash(source));
  let original = await readFile(cached).catch(() => null);
  if (!original) {
    const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Image download failed: ${source}`);
    if (Number(response.headers.get('content-length')) > 30_000_000) throw new Error('Image exceeds size limit');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 30_000_000) throw new Error('Image exceeds size limit');
      chunks.push(chunk);
    }
    original = Buffer.concat(chunks);
    await writeFile(cached, original);
  }
  const metadata = await sharp(original, { limitInputPixels: 50_000_000 }).metadata();
  if ((metadata.pages ?? 1) > 1) throw new Error('Animated or multipage sources require separate review');
  const rotated = await sharp(original).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = rotated.info;
  const widths = [...new Set([320, 480, 640, 960, 1280, 1600].filter(w => w < width).concat(Math.min(width, 1600)))];
  const digest = hash(original);
  // Include encoding recipe in the key so changed recipes never overwrite cached URLs.
  const base = `/images/opt/products/${hash(`${digest}:webp85-effort6-v1`).slice(0, 24)}`;
  const renditions = [];
  for (const target of widths) {
    const bytes = await sharp(rotated.data).resize({ width: target, withoutEnlargement: true }).webp({ quality: 85, effort: 6 }).toBuffer();
    const output = `${base}-${target}.webp`;
    await writeFile(path.join('public', output.slice(1)), bytes);
    renditions.push({ width: target, bytes: bytes.length, sha256: hash(bytes) });
  }
  manifest[source] = { base, widths, ratio: height / width };
  records.push({ source, sha256: digest, bytes: original.length, width, height, renditions });
  console.log(`Prepared ${records.length}/${sources.length}`);
}
await writeFile('lib/productImageManifest.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile('docs/quality/product-image-provenance.json', JSON.stringify({
  generatedAt: new Date().toISOString(), catalogSha256: hash(sourceBytes), recipe: 'webp85-effort6-v1', records,
}, null, 2) + '\n');
