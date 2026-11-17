import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const tools = ['trade/TradeWelcome.tsx', 'trade/TradeApplication.tsx',
  'components/delivery/TradeDeliveryCalculator.tsx', 'components/delivery/ProjectDeliveryPanel.tsx',
  'components/delivery/ProductDeliveryEstimate.tsx', 'components/partner/ProgramHubV2.tsx'];
const roots = Object.keys(manifest).filter(key => manifest[key].dynamicImports?.includes(tools[0]));
assert.equal(roots.length, 1, 'Expected one HOLM application chunk');
const initial = new Set();
function visit(key) {
  if (initial.has(key)) return;
  assert.ok(manifest[key], `Missing manifest record ${key}`);
  initial.add(key);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
visit(roots[0]);
for (const key of tools) {
  assert.ok(manifest[key]?.isDynamicEntry, `${key} must remain a dynamic entry`);
  assert.ok(!initial.has(key), `${key} leaked into HOLM startup`);
}
const chunks = await Promise.all([...initial].map(async key => ({ key, file: manifest[key].file, bytes: (await stat(`dist/${manifest[key].file}`)).size })));
const report = { scope: 'HOLM boot static JS closure; excludes dynamic tools, CSS, images and network compression', tools, chunks, bytes: chunks.reduce((n, c) => n + c.bytes, 0) };
await mkdir('artifacts/lighthouse', { recursive: true });
await writeFile('artifacts/lighthouse/deferred-bundles.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
