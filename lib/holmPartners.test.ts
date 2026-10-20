import { describe, expect, it } from 'vitest';
import { HOLM_PARTNERS, commissionCents } from './holmPartners';

describe('House partner commission', () => {
  it('pays the tier rate on the retail amount', () => {
    expect(commissionCents(100_000, HOLM_PARTNERS.tiers.base)).toBe(10_000);
    expect(commissionCents(100_000, HOLM_PARTNERS.tiers.elite)).toBe(18_000);
  });

  it('never exceeds the 23% ceiling', () => {
    expect(commissionCents(100_000, 3000)).toBe(23_000);
  });

  it('pays nothing on an empty order', () => {
    expect(commissionCents(0, 1000)).toBe(0);
  });
});
