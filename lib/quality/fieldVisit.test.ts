import { expect, it } from 'vitest';
import { createFieldVisit } from './fieldVisit';
const identity = {
  documentToken: 'a'.repeat(32),
  release: 'b'.repeat(40),
  route: 'retail-home' as const,
  device: 'mobile' as const,
};
it('keeps only the latest metric revision without sending library IDs or inventing INP', () => {
  const visit = createFieldVisit(identity);
  expect(visit.snapshot()).toBeNull();
  expect(visit.observe({ name: 'LCP', id: 'metric-1', value: 2100 })).toBe(true);
  expect(visit.observe({ name: 'LCP', id: 'metric-1', value: 2100 })).toBe(false);
  expect(visit.observe({ name: 'LCP', id: 'metric-1', value: 2200 })).toBe(true);
  expect(visit.snapshot()).toEqual({
    version: 1,
    ...identity,
    samples: [{ name: 'LCP', value: 2200, revision: 2 }],
  });
  expect(JSON.stringify(visit.snapshot())).not.toContain('metric-1');
});
it('does not mix another navigation identity or allow callers to mutate the next payload', () => {
  const metadata = { ...identity };
  const visit = createFieldVisit(metadata);
  metadata.route = 'retail-home';
  metadata.release = 'c'.repeat(40);
  visit.observe({ name: 'LCP', id: 'first', value: 2100 });
  expect(visit.observe({ name: 'LCP', id: 'restored', value: 1000 })).toBe(false);
  const copy = visit.snapshot()!;
  copy.samples[0].value = 0;
  copy.route = 'holm-home';
  expect(visit.snapshot()?.release).toBe(identity.release);
  expect(visit.snapshot()?.route).toBe('retail-home');
  expect(visit.snapshot()?.samples[0].value).toBe(2100);
});
it('permanently discards a revoked visit and cannot resume its buffered measurements', () => {
  const visit = createFieldVisit(identity);
  visit.observe({ name: 'CLS', id: 'cls', value: 0.02 });
  visit.revoke();
  expect(visit.snapshot()).toBeNull();
  expect(visit.observe({ name: 'CLS', id: 'cls', value: 0.03 })).toBe(false);
});
it('accepts a lower reported INP revision but bounds revisions and invalid values', () => {
  const visit = createFieldVisit(identity);
  visit.observe({ name: 'INP', id: 'inp', value: 200 });
  visit.observe({ name: 'INP', id: 'inp', value: 180 });
  expect(visit.snapshot()?.samples[0].value).toBe(180);
  for (let i = 0; i < 110; i++) visit.observe({ name: 'INP', id: 'inp', value: i });
  expect(visit.snapshot()?.samples[0].revision).toBe(100);
  expect(visit.observe({ name: 'CLS', id: 'cls', value: Infinity })).toBe(false);
  expect(visit.observe({ name: 'CLS', id: '', value: 0 })).toBe(false);
});
it('rejects private extra fields in metadata instead of transmitting them', () => {
  expect(() =>
    createFieldVisit({ ...identity, url: '/account/private' } as typeof identity)
  ).toThrow('Invalid field visit');
});
