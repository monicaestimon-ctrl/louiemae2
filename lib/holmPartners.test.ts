import { describe, expect, it } from 'vitest';
import { HOLM_PARTNERS, commissionCents, holmChannel } from './holmPartners';

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

describe('House partner link channels', () => {
  it('keeps the fixed channels as they are', () => {
    for (const c of HOLM_PARTNERS.channels) expect(holmChannel(c)).toBe(c);
  });

  it('maps links shared before the fixed list to the nearest channel', () => {
    expect(holmChannel('pinterest')).toBe('pin');
    expect(holmChannel('Instagram')).toBe('story');
    expect(holmChannel('direct')).toBe('link');
  });

  it('counts anything unknown as a plain link', () => {
    expect(holmChannel('')).toBe('link');
    expect(holmChannel(undefined)).toBe('link');
    expect(holmChannel('<script>')).toBe('link');
  });
});
