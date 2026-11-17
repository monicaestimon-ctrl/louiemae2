import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLighthouseReport } from './report.mjs';
test('shows all failures and cannot label a passing subset full acceptance', () => {
  const report = renderLighthouseReport({ fullRegistryRun: false, pendingCoverage: ['private accounts'], omittedRoutes: ['holm-home'], batches: [{ route: 'product', device: 'mobile', passed: true, errors: [], runs: [{ valid: true, scores: { performance: { raw: .995, displayed: 100 } }, artifacts: ['product-mobile-1.json'] }] }] });
  assert.match(report, /coverage incomplete/);
  assert.match(report, /holm-home/);
  assert.match(report, /raw 0.995/);
  assert.match(report, /private accounts/);
  assert.doesNotMatch(report, /Registered release gate passed/);
});
test('escapes route and error text and retains unsuccessful runs', () => {
  const report = renderLighthouseReport({ scope: '<script>bad()</script>', batches: [{ route: '<img>', device: 'mobile', passed: false, errors: ['Not healthy'], runs: [{ valid: false, errors: ['<script>failure</script>'], scores: {} }, { valid: true, scores: {} }] }] });
  assert.doesNotMatch(report, /<script>/);
  assert.match(report, /&lt;script&gt;/);
  assert.match(report, /Failed \/ unverified/);
  assert.match(report, /scope="row">2/);
  assert.match(report, /Not measured/);
});

test('an in-progress full registry manifest cannot announce a completed release', () => {
  const scores = Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo'].map(category => [category, { raw: 1, displayed: 100 }]));
  const batch = { route: 'home', device: 'mobile', passed: true, errors: [], runs: Array.from({ length: 5 }, () => ({ valid: true, scores })) };
  const manifest = { selectedRoutes: ['home'], fullRegistryRun: true, pendingCoverage: [], omittedRoutes: [], batches: [batch] };
  assert.doesNotMatch(renderLighthouseReport(manifest), /Registered release gate passed/);
  assert.match(renderLighthouseReport({ ...manifest, batches: [batch, { ...batch, device: 'desktop' }] }), /Registered release gate passed/);
});
