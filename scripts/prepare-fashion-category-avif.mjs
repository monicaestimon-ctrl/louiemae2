import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = 'public/images/brand/mae-dress.png';
const bytes = await readFile(source);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const recipe = 'avif-quality40-effort7-lossless-orientation-v1';
const key = createHash('sha256')
  .update(sha256 + '|' + recipe)
  .digest('hex')
  .slice(0, 24);
const base = '/images/opt/brand-formats/' + key;
await mkdir('public/images/opt/brand-formats', { recursive: true });
const manifest = JSON.parse(await readFile('lib/imageManifest.json', 'utf8'));
const entry = manifest['/images/brand/mae-dress.png'];
const oriented = await sharp(bytes).rotate().png().toBuffer();
const renditions = [];
for (const width of entry.widths) {
  const output = await sharp(oriented)
    .resize({ width, withoutEnlargement: true })
    .avif({ quality: 40, effort: 7 })
    .toBuffer();
  await writeFile('public' + base + '-' + width + '.avif', output);
  renditions.push({
    width,
    bytes: output.length,
    sha256: createHash('sha256').update(output).digest('hex'),
  });
}
entry.avifBase = base;
await writeFile(
  'lib/imageManifest.json',
  '{\n' +
    Object.entries(manifest)
      .map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v))
      .join(',\n') +
    '\n}\n'
);
await writeFile(
  'docs/quality/fashion-category-image-provenance.json',
  JSON.stringify(
    { source: '/images/brand/mae-dress.png', sha256, recipe, base, renditions },
    null,
    2
  ) + '\n'
);
console.log(JSON.stringify(renditions));
