import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const tools = ['trade/TradeWelcome.tsx', 'trade/editors.ts', 'trade/admin/HouseStaff.ts', 'trade/TradeApplication.tsx', 'trade/TradeAccount.tsx',
  'trade/DiscoverCatalog.tsx', 'components/delivery/TradeDeliveryCalculator.tsx', 'components/delivery/ProjectDeliveryPanel.tsx',
  'components/delivery/ProductDeliveryEstimate.tsx', 'components/partner/ProgramHubV2.tsx', 'components/partner/ProductRetailReferral.tsx', 'components/delivery/DeliveryQuoteStatus.tsx'];
const roots = Object.keys(manifest).filter(key => manifest[key].dynamicImports?.includes(tools[0]));
assert.equal(roots.length, 1, 'Expected one HOLM application chunk');
const initial = new Set();
function visit(key) {
  if (initial.has(key)) return;
  assert.ok(manifest[key], `Missing manifest record ${key}`);
  initial.add(key);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
visit('trade/index.html');
visit(roots[0]);
for (const key of tools) {
  assert.ok(manifest[key]?.isDynamicEntry, `${key} must remain a dynamic entry`);
  assert.ok(!initial.has(key), `${key} leaked into HOLM startup`);
}
const chunks = await Promise.all([...initial].map(async key => ({ key, file: manifest[key].file, bytes: (await stat(`dist/${manifest[key].file}`)).size, gzipBytes: gzipSync(await readFile(`dist/${manifest[key].file}`)).length })));
const report = { scope: 'HOLM HTML entry and boot static JS closures; excludes interaction-loaded tools, CSS and images; gzip is a reproducible build budget, not a network timing measurement', tools, chunks, bytes: chunks.reduce((n, c) => n + c.bytes, 0), gzipBytes: chunks.reduce((n, c) => n + c.gzipBytes, 0), gzipBudgetBytes: 200 * 1024 };
assert.ok(report.gzipBytes <= report.gzipBudgetBytes, `HOLM startup exceeds 200 KiB gzip: ${report.gzipBytes}`);
await mkdir('artifacts/lighthouse', { recursive: true });
await writeFile('artifacts/lighthouse/deferred-bundles.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

// Opening the cart is an explicit interaction, never part of a public page's startup graph.
initial.clear();
visit('index.html');
for (const key of manifest['index.html'].dynamicImports || []) visit(key);
const cart = 'components/cart/CartDrawer.tsx';
assert.ok(manifest[cart]?.isDynamicEntry, 'Retail cart must remain an interaction-loaded entry');
assert.ok(!initial.has(cart), 'Retail cart leaked into public startup');

for (const key of ['components/HomeProductPreview.tsx', 'components/CollectionProductPreview.tsx', 'components/delivery/DeliveryQuoteStatus.tsx']) {
  assert.ok(manifest[key]?.isDynamicEntry, `${key} must remain a dynamic entry`);
  assert.ok(!initial.has(key), `${key} leaked into retail startup`);
}
