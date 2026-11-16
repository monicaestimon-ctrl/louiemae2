import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRouteHealth } from './health.mjs';

const route = { readySelector: '[data-ready="true"]', requiredText: 'Products' };
function fixture({ count = 1, visible = true, text = 'Products' } = {}) {
  let revealed = false;
  return {
    $$: async () => Array.from({ length: count }, () => ({
      scrollIntoView: async () => { revealed = true; }, isVisible: async () => visible,
    })),
    evaluate: async () => {},
    $eval: async () => revealed ? text : '',
    revealed: () => revealed,
  };
}
test('reveals an already-ready deferred section before inspecting its rendered text', async () => {
  const page = fixture();
  assert.deepEqual(await inspectRouteHealth(page, route), { readyAtAuditEnd: true, markerVisible: true, ok: true });
});
test('missing or duplicate readiness markers cannot be rescued by post-audit scrolling', async () => {
  for (const count of [0, 2]) {
    const page = fixture({ count });
    assert.equal((await inspectRouteHealth(page, route)).ok, false);
    assert.equal(page.revealed(), false);
  }
});
test('hidden, wrong-content and outage sections still fail', async () => {
  for (const options of [{ visible: false }, { text: 'Loading' }, { text: 'Products temporarily unavailable' }]) {
    assert.equal((await inspectRouteHealth(fixture(options), route)).ok, false);
  }
});
