// Exercise emitted, unbundled Node ESM and the built HTML template, not Vitest's resolver.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

assert.ok(existsSync('dist/index.html'), 'Missing dist/index.html: run npm run build before the product runtime check.');

const output = 'artifacts/lighthouse/product-runtime';
await build({ entryPoints: ['components/CollectionRootHero.tsx', 'api/journal.ts', 'lib/serverJournalDocument.ts', 'lib/journalContent.ts', 'lib/journalUrl.ts', 'api/product.ts', 'api/collection.ts', 'api/page.ts', 'lib/serverPageDocument.ts', 'lib/serverCollectionDocument.ts', 'lib/collectionId.ts', 'lib/productCategories.ts', 'lib/serverProductDocument.ts', 'lib/publicProductBootstrap.ts', 'lib/responsiveImage.ts', 'lib/productMetadata.ts'],
  outbase: '.', outdir: output, bundle: false, platform: 'node', format: 'esm', target: 'node24' });
await mkdir(`${output}/lib`, { recursive: true });
for (const file of ['imageManifest.json', 'productImageManifest.json']) {
  await copyFile(`lib/${file}`, `${output}/lib/${file}`);
}
process.env.VITE_PRELAUNCH_MODE = 'false';
process.env.VITE_CONVEX_URL = 'https://public-fixture.invalid';
const { default: handler } = await import('../artifacts/lighthouse/product-runtime/api/product.js');
const { default: collectionHandler } = await import('../artifacts/lighthouse/product-runtime/api/collection.js');
const { default: pageHandler } = await import('../artifacts/lighthouse/product-runtime/api/page.js');
const { default: journalHandler } = await import('../artifacts/lighthouse/product-runtime/api/journal.js');
const originalFetch = globalThis.fetch;
const results = [];
try {
  for (const [name, value, expected] of [
    ['available', { _id: 'fixture', name: 'Runtime chair', description: 'Public fixture', category: 'Furniture', price: 200, images: [], inStock: true }, 200],
    ['unavailable', { _id: 'fixture', name: 'Runtime chair', description: 'Public fixture', category: 'Furniture', price: 200, images: [], inStock: false }, 200],
    ['missing', null, 404], ['failed', undefined, 503],
  ]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://public-fixture.invalid/api/query');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(JSON.parse(options.body).path, 'products:getStorefrontDetail');
      return { ok: true, json: async () => ({ status: 'success', value }) };
    };
    const headers = {};
    const response = { status(code) { this.code = code; return this; }, send(body) { this.body = body; }, setHeader(key, val) { headers[key] = val; } };
    await handler({ method: 'GET', query: { id: 'fixture' } }, response);
    assert.equal(response.code, expected);
    assert.equal(headers['Cache-Control'], 'no-store');
    if (expected === 200) {
      assert.ok(response.body.includes('Runtime chair'));
      assert.ok(response.body.includes('id="lm-product-document"'));
      assert.ok(response.body.includes('/assets/'));
      if (name === 'unavailable') assert.ok(response.body.includes('Currently unavailable'));
    } else assert.equal(headers['X-Robots-Tag'], 'noindex');
    results.push({ name, status: response.code });
  }
  for (const [name, configuration, expected] of [
    ['collection', { collections: [{ id: 'furniture', title: 'Runtime furniture', subtitle: 'Public collection', subcategories: [] }] }, 200],
    ['missing collection', { collections: [] }, 404], ['unavailable collection', null, 503],
  ]) {
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      const value = request.path === 'siteContent:get' ? configuration : { page: [{ _id: 'fixture', collection: 'furniture', name: 'Runtime chair', price: 200, images: [] }] };
      return { ok: true, json: async () => ({ status: 'success', value }) };
    };
    const response = { status(code) { this.code = code; return this; }, send(body) { this.body = body; }, setHeader() {} };
    await collectionHandler({ method: 'GET', query: { id: 'furniture' } }, response);
    assert.equal(response.code, expected);
    if (expected === 200) {
      assert.ok(response.body.includes('Runtime furniture'));
      assert.ok(response.body.includes('id="lm-collection-document"'));
      assert.ok(response.body.includes('href="/products/fixture"'));
    }
    results.push({ name, status: response.code });
  }
  for (const id of ['shop', 'story']) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', value: {
      home: { categoryImages: { furniture: '/public-fixture.png' } },
      story: { hero: { title: 'Runtime story' }, prologue: {}, chapters: {} },
    } }) });
    const response = { status(code) { this.code = code; return this; }, send(body) { this.body = body; }, setHeader() {} };
    await pageHandler({ method: 'GET', query: { id } }, response);
    assert.equal(response.code, 200); assert.ok(response.body.includes('id="lm-page-document"'));
    assert.ok(response.body.includes('/assets/')); results.push({ name: id, status: response.code });
  }
  const article = { _id: 'fixture', title: 'Runtime story', excerpt: 'Public', contentHtml: '<p>Readable article</p><script>unsafe()</script>', image: '', category: 'Home', date: 'November 17, 2026', status: 'published' };
  for (const id of [undefined, 'fixture']) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', value: id ? article : [article] }) });
    const response = { status(code) { this.code = code; return this; }, send(body) { this.body = body; }, setHeader() {} };
    await journalHandler({ method: 'GET', query: { id } }, response);
    assert.equal(response.code, 200); assert.ok(response.body.includes('Runtime story')); assert.ok(!response.body.includes('unsafe()'));
    results.push({ name: id ? 'article' : 'journal', status: response.code });
  }
} finally { globalThis.fetch = originalFetch; }
await writeFile('artifacts/lighthouse/product-runtime-check.json', JSON.stringify({ node: process.version, results }, null, 2));
console.log('Unbundled product/collection Node runtime and built template verified.');
