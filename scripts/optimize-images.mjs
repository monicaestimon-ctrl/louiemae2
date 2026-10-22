// Builds responsive WebP copies of the storefront's brand photography.
//
//   node scripts/optimize-images.mjs
//
// Originals in public/images/brand stay untouched (admin content and emails still
// point at them). Each one gets WebP renditions in public/images/opt/brand and an
// entry in lib/imageManifest.json, which lib/responsiveImage.ts turns into srcset.
// Re-run after adding or replacing a brand image and commit the output.
import { readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sources = [
  { dir: 'public', url: '', only: ['lm3.jpg'] },
  { dir: 'public/images/brand', url: '/images/brand' },
];
const outDir = 'public/images/opt/brand';
const WIDTHS = [480, 960, 1600];
const QUALITY = 74;

const slug = (name) =>
  name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

await mkdir(path.join(root, outDir), { recursive: true });
const manifest = {};
for (const source of sources) {
  const files = (await readdir(path.join(root, source.dir))).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && (!source.only || source.only.includes(f))).sort();
  for (const file of files) {
    const input = path.join(root, source.dir, file);
    const meta = await sharp(input).metadata();
    const name = slug(file);
    const widths = WIDTHS.filter((w) => w < meta.width);
    if (widths.length < WIDTHS.length) widths.push(Math.min(meta.width, WIDTHS[WIDTHS.length - 1]));
    const unique = [...new Set(widths)];
    for (const w of unique) {
      const out = path.join(root, outDir, `${name}-${w}.webp`);
      const done = await stat(out).catch(() => null);
      if (done && done.mtimeMs > (await stat(input)).mtimeMs) continue;
      await sharp(input).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALITY, effort: 6 }).toFile(out);
    }
    manifest[`${source.url}/${file}`] = { base: `/${path.relative('public', outDir)}/${name}`, widths: unique, ratio: +(meta.height / meta.width).toFixed(4) };
  }
}
const lines = Object.entries(manifest).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
await writeFile(path.join(root, 'lib/imageManifest.json'), `{\n${lines.join(',\n')}\n}\n`);
console.log(`Optimized ${Object.keys(manifest).length} images into ${outDir}.`);
