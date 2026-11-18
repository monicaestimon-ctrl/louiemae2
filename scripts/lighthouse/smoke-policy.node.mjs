import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSmoke, smokeRoutes, smokeDevices } from './smoke-policy.mjs';
const commit = 'a'.repeat(40);
const fixture = () => ({ expectedCommit: commit, before: { commit }, after: { commit }, results:
  smokeRoutes.flatMap(route => smokeDevices.map(device => ({ route, device: device.name, status: 200,
    sameUrl: true, healthy: true, commands: 0, errors: [], axe: [] }))) });
test('requires every public route and device without making a score claim', () => {
  assert.equal(assessSmoke(fixture()).passed, true);
  assert.match(assessSmoke(fixture()).scope, /not full-spec acceptance/);
  const report = fixture(); report.results.pop(); assert.equal(assessSmoke(report).passed, false);
});
test('rejects duplicates, substituted routes and missing identity', () => {
  for (const change of [r => r.results.push(r.results[0]), r => { r.results[0].route = 'private'; },
    r => { r.after.commit = 'b'.repeat(40); }, r => { delete r.before; }, r => { r.expectedCommit = 'main'; }]) {
    const report = fixture(); change(report); assert.equal(assessSmoke(report).passed, false);
  }
});
test('errors, accessibility failures, redirects and attempted commands cannot pass', () => {
  for (const patch of [{ status: 503 }, { sameUrl: false }, { healthy: false }, { commands: 1 },
    { errors: ['failed'] }, { axe: ['button-name'] }, { errors: undefined }, { axe: undefined }]) {
    const report = fixture(); Object.assign(report.results[0], patch);
    assert.equal(assessSmoke(report).passed, false);
  }
});
