import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const recipe = JSON.parse(await readFile('scripts/fonts/holm-headline-recipe.json', 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const [source, candidate, license, css, html] = await Promise.all([
  readFile(recipe.source),
  readFile(recipe.candidate),
  readFile(recipe.license),
  readFile('trade/style.css', 'utf8'),
  readFile('trade/index.html', 'utf8'),
]);
assert.equal(hash(source), recipe.sourceSha256, 'The reviewed source font changed');
assert.equal(hash(candidate), recipe.candidateSha256, 'Regenerate and review the headline font');
assert.equal(hash(license.toString('utf8').replace(/\r\n/g, '\n')), recipe.licenseSha256, 'Keep the source font license');
assert.equal(candidate.toString('ascii', 0, 4), 'wOF2');
assert.equal(candidate.readUInt32BE(8), candidate.length);
assert.equal(candidate.length, recipe.bytes);
assert.match(
  css,
  /\.hf-copy h1\{font-family:"Newsreader Headline","Newsreader Fallback",Georgia,serif;font-weight:400;/
);
assert.match(
  css,
  /font-family:"Newsreader Headline";font-style:normal;font-weight:400;font-display:swap;src:url\("\/fonts\/newsreader-headline-400-optical\.woff2"\)/
);
assert.match(html, /rel="preload" href="\/fonts\/newsreader-headline-400-optical\.woff2"/);
assert.doesNotMatch(html, /Newsreader Hero|newsreader-hero-500/);
const files = [
  recipe.candidate,
  'public/fonts/dm-sans-latin-normal.woff2',
  'public/fonts/newsreader-logo.woff2',
];
const bytes = await Promise.all(
  files.map(async (file) => ({ file, bytes: (await readFile(file)).length }))
);
const total = bytes.reduce((sum, file) => sum + file.bytes, 0);
assert.ok(total <= 80 * 1024, 'The three declared first-viewport fonts exceed 80 KiB');
await mkdir('artifacts/lighthouse', { recursive: true });
await writeFile(
  'artifacts/lighthouse/holm-headline-font.json',
  JSON.stringify(
    {
      scope:
        'Source/recipe integrity and declared headline font budget; not a field or complete route font audit',
      files: bytes,
      total,
      sourceSha256: recipe.sourceSha256,
      candidateSha256: recipe.candidateSha256,
    },
    null,
    2
  )
);
console.log(`HOLM headline font integrity verified; declared first-viewport fonts ${total} bytes.`);
