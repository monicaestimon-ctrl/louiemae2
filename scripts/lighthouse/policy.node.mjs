import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRun, assessBatch, categories } from './policy.mjs';

const expected = { url: 'https://example.com/', device: 'mobile' };
const report = () => ({ lighthouseVersion: '13.6.0', finalDisplayedUrl: expected.url,
  configSettings: { formFactor: 'mobile' }, audits: { 'errors-in-console': { score: 1 } },
  categories: Object.fromEntries(categories.map(name => [name, { score: 1 }])) });
const run = (score = 1) => {
  const lhr = report(); lhr.categories.performance.score = score;
  return assessRun(lhr, { ok: true, url: expected.url }, expected);
};
test('high-scoring error page is never valid', () => {
  assert.equal(assessRun(report(), { ok: false, url: expected.url }, expected).valid, false);
});
test('missing, null, redirected and wrong-device results fail closed', () => {
  for (const mutate of [r => { r.categories.seo.score = null; }, r => { r.finalDisplayedUrl += 'login'; },
    r => { r.configSettings.formFactor = 'desktop'; }, r => { delete r.audits['errors-in-console']; },
    r => { r.runtimeError = { code: 'NO_FCP' }; }, r => { r.lighthouseVersion = 'other'; }]) {
    const lhr = report(); mutate(lhr);
    assert.equal(assessRun(lhr, { ok: true, url: expected.url }, expected).valid, false);
  }
});
test('release accepts four perfect runs and one 98 but retains all runs', () => {
  const result = assessBatch([run(), run(), run(), run(), run(.98)]);
  assert.equal(result.passed, true); assert.equal(result.runs.length, 5);
});
test('incomplete batches and cherry-picked performance fail', () => {
  assert.equal(assessBatch([run()]).passed, false);
  assert.equal(assessBatch([run(), run(), run(), run(.99), run(.99)]).passed, false);
  assert.equal(assessBatch([run(), run(), run(), run(), run(.97)]).passed, false);
});
test('non-performance categories require the full raw score', () => {
  const changed = run(); changed.scores.accessibility = { raw: .999, displayed: 100 };
  assert.equal(assessBatch([run(), run(), run(), run(), changed]).passed, false);
});
