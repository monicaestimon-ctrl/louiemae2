import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const boot = manifest['index.html']?.dynamicImports;
assert.equal(boot?.length, 1, 'Expected one immediately loaded retail boot entry');
const routes = [
  'components/HomePage.tsx',
  'components/StorePage.tsx',
  'components/ProductPage.tsx',
  'components/ShopLandingPage.tsx',
  'components/StoryPage.tsx',
  'components/BlogPage.tsx',
  'components/BlogPostView.tsx',
];
const results = [];
for (const route of routes) {
  const seen = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    assert.ok(manifest[key], `Missing entry ${key}`);
    seen.add(key);
    for (const dependency of manifest[key].imports || []) visit(dependency);
  }
  for (const key of ['index.html', ...boot, route]) visit(key);
  for (const deferred of [
    'components/cart/CartDrawer.tsx',
    'components/ConciergePanel.tsx',
    'components/HomeProductPreview.tsx',
    'components/CollectionProductPreview.tsx',
  ]) {
    assert.ok(!seen.has(deferred), `${deferred} leaked into the initial ${route} graph`);
  }
  const js = [...new Set([...seen].map((key) => manifest[key].file))];
  const css = [...new Set([...seen].flatMap((key) => manifest[key].css || []))];
  const compressed = async (files) =>
    Promise.all(
      files.map(async (file) => ({
        file,
        gzipBytes: gzipSync(await readFile('dist/' + file)).length,
      }))
    );
  const jsFiles = await compressed(js),
    cssFiles = await compressed(css);
  results.push({
    route,
    jsGzipBytes: jsFiles.reduce((n, f) => n + f.gzipBytes, 0),
    cssGzipBytes: cssFiles.reduce((n, f) => n + f.gzipBytes, 0),
    jsFiles,
    cssFiles,
  });
}
await mkdir('artifacts/lighthouse', { recursive: true });
await writeFile(
  'artifacts/lighthouse/retail-bundles.json',
  JSON.stringify(
    {
      scope:
        'Static JS/CSS closure for the registered public retail route components, including immediately imported boot and requested page; excludes subsequent interactions and private/referral/checkout routes. Gzip size, not runtime timing or full-spec acceptance.',
      budgets: { jsGzipBytes: 150 * 1024, cssGzipBytes: 35 * 1024 },
      results,
    },
    null,
    2
  )
);
for (const result of results) {
  assert.ok(
    result.jsGzipBytes <= 150 * 1024,
    `${result.route}: ${result.jsGzipBytes} bytes exceeds 150KiB initial JS`
  );
  assert.ok(
    result.cssGzipBytes <= 35 * 1024,
    `${result.route}: ${result.cssGzipBytes} bytes exceeds 35KiB CSS`
  );
}
console.log(
  JSON.stringify(
    results.map(({ route, jsGzipBytes, cssGzipBytes }) => ({ route, jsGzipBytes, cssGzipBytes }))
  )
);
