import { describe, it, expect } from 'vitest';
import {
  fieldRoute,
  parseFieldBatch,
  replaceFieldSample,
  summarizeFieldMetric,
} from './fieldPolicy';
const batch = () => ({
  version: 1,
  documentToken: 'a'.repeat(32),
  release: 'b'.repeat(40),
  route: 'retail-home',
  device: 'mobile',
  samples: [{ name: 'LCP', value: 1200, revision: 1 }],
});
describe('private-data-free field payload', () => {
  it('accepts only bounded exact fields', () => expect(parseFieldBatch(batch())).toEqual(batch()));
  it.each(['url', 'email', 'zip', 'referrer', 'userId', 'orderId', 'refCode'])(
    'rejects added %s',
    (key) => expect(parseFieldBatch({ ...batch(), [key]: 'private' })).toBeNull()
  );
  it.each([NaN, Infinity, -1, 600001])('rejects invalid metric %s', (value) =>
    expect(
      parseFieldBatch({ ...batch(), samples: [{ name: 'LCP', value, revision: 1 }] })
    ).toBeNull()
  );
  it.each([['mobile'], { value: 'mobile' }, null, 1, true].map(value => [value]))('rejects a non-string device %s', (device) => {
    expect(parseFieldBatch({ ...batch(), device })).toBeNull();
  });
  it('rejects duplicate metric records and nested attribution', () => {
    const b = batch();
    expect(parseFieldBatch({ ...b, samples: [...b.samples, ...b.samples] })).toBeNull();
    expect(
      parseFieldBatch({ ...b, samples: [{ ...b.samples[0], url: '/products/private' }] })
    ).toBeNull();
  });
  it('rejects unknown routes, release strings and persistent identifier shapes', () => {
    expect(parseFieldBatch({ ...batch(), route: '/admin' })).toBeNull();
    expect(parseFieldBatch({ ...batch(), release: 'main' })).toBeNull();
    expect(parseFieldBatch({ ...batch(), documentToken: 'email@example.com' })).toBeNull();
  });
  it('classifies public paths without retaining identifiers or query strings', () => {
    expect(fieldRoute('/products/abc123')).toBe('retail-product');
    expect(fieldRoute('/blog/design')).toBe('retail-article');
    expect(fieldRoute('/collection/kids')).toBe('retail-collection');
    for (const path of [
      '/admin',
      '/trade/projects/secret',
      '/checkout',
      '/products/abc?email=secret',
      '/blog/a/b',
      '/account',
    ])
      expect(fieldRoute(path)).toBeNull();
  });
});
describe('field aggregation semantics', () => {
  it('does not count a duplicate or older delivery as a fresh sample', () => {
    const old = { name: 'CLS' as const, value: 0.02, revision: 2 };
    expect(replaceFieldSample(old, { name: 'CLS', value: 0.01, revision: 1 })).toBe(old);
    expect(replaceFieldSample(old, { name: 'CLS', value: 0.09, revision: 2 })).toBe(old);
    expect(replaceFieldSample(old, { name: 'CLS', value: 0.1, revision: 3 }).value).toBe(0.1);
  });
  it('keeps missing INP distinct from zero and reports insufficient data', () => {
    expect(summarizeFieldMetric('INP', [])).toMatchObject({
      count: 0,
      p75: null,
      status: 'insufficient-data',
    });
    expect(summarizeFieldMetric('INP', [0])).toMatchObject({
      count: 1,
      p75: 0,
      status: 'insufficient-data',
    });
  });
  it('uses one observation per document, exact p75 and no passing claim on truncation', () => {
    const values = [...Array(37).fill(200), ...Array(13).fill(201)];
    expect(summarizeFieldMetric('INP', values)).toMatchObject({
      count: 50,
      p75: 201,
      status: 'above-target',
    });
    expect(summarizeFieldMetric('LCP', Array(50).fill(2500))).toMatchObject({
      p75: 2500,
      status: 'within-target',
    });
    expect(summarizeFieldMetric('LCP', Array(50).fill(1000), true).status).toBe('truncated');
  });
});
it('does not classify private hash-based screens as public visits', () => {
  expect(fieldRoute('/trade/', '#account')).toBeNull();
  expect(fieldRoute('/', '#order/private-token')).toBeNull();
  expect(fieldRoute('/trade/', '')).toBe('holm-home');
});
