// Execute unbundled ESM in Node, matching the deployment boundary that Vite/Vitest hide.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
await build({ entryPoints: ['api/sitemap.ts', 'api/og.ts', 'lib/collectionId.ts', 'lib/productMetadata.ts'], outbase: '.',
  outdir: 'artifacts/lighthouse/metadata-runtime', bundle: false, platform: 'node', format: 'esm' });
process.env.VITE_PRELAUNCH_MODE = 'false';
const { default: handler } = await import('../artifacts/lighthouse/metadata-runtime/api/og.js');
const results = [];
for (const [path, expected] of [['collection/furniture', 200], ['constructor', 404], ['"><script>alert(1)</script>', 404]]) {
  const headers = {};
  const response = { status(code) { this.code = code; return this; }, send(body) { this.body = body; }, setHeader(key, value) { headers[key] = value; } };
  handler({ query: { path } }, response);
  assert.equal(response.code, expected);
  if (expected === 404) { assert.equal(headers['Cache-Control'], 'no-store'); assert.ok(!response.body.includes('<script>')); }
  results.push({ path, status: response.code });
}
await writeFile('artifacts/lighthouse/metadata-runtime-check.json', JSON.stringify({ node: process.version, results }, null, 2));
console.log('Unbundled Node metadata runtime verified.');

const { default: sitemapHandler } = await import('../artifacts/lighthouse/metadata-runtime/api/sitemap.js');
const sitemapResult = { status(code) { this.code = code; return this; }, send(body) { this.body = body; }, setHeader() {} };
await sitemapHandler({method:'POST',query:{}},sitemapResult);
assert.equal(sitemapResult.code,405);
console.log('Unbundled sitemap imports and method boundary verified.');
