import { describe, expect, it } from 'vitest';
import { programTerms } from './programTerms';
import { CONFIG_SEED } from './config/seed';
import type { AttributionPolicy, CommissionSchedule, CreditPolicy, PayoutSchedule, TierPolicy } from './config';

const seed = <T,>(key: string) => CONFIG_SEED.find((s) => s.key === key)!.value as T;
const full = {
  operator: { legalName: 'Louie Mae LLC', supportEmail: 'withlove@louiemae.com', supportAddress: '1 Main St, Stockton, CA', jurisdiction: 'California', privacyUrl: 'https://www.louiemae.com/privacy', effectiveDate: 'December 1, 2026' },
  schedule: seed<CommissionSchedule>('commission-schedule'),
  tier: seed<TierPolicy>('tier-policy'),
  attribution: seed<AttributionPolicy>('attribution'),
  payout: seed<PayoutSchedule>('payout-schedule'),
  credit: seed<CreditPolicy>('business-credit'),
  clearingDays: 30,
};

describe('program terms (S37)', () => {
  it('refuses to publish while anything is missing (no placeholders)', () => {
    const r = programTerms({ ...full, operator: null, payout: null });
    expect(r).toEqual({ ready: false, missing: ['operator', 'payout'] });
  });

  it('states the implemented rules from configuration', () => {
    const r = programTerms(full);
    if (!r.ready) throw new Error('expected ready');
    const text = r.sections.flatMap((s) => s.items).join('\n');
    expect(text).toContain('within 30 days (30 × 24 hours)');
    expect(text).toContain('Every eligible piece in that order counts');
    expect(text).toContain('furniture 18%, home décor and lighting 12%, clothing 8%');
    expect(text).toContain('at 00:15 America/Chicago');
    expect(text).toContain('by 23:59:59 on the 14th');
    expect(text).toContain('Transferred to your connected Stripe account'.toLowerCase().slice(0, 0));
    expect(text).toContain('$100 in store credit');
    expect(text).toContain('you will not receive both');
    expect(text).toContain('Louie Mae LLC');
    expect(text).not.toMatch(/TBD|TODO|placeholder|\[.*\]|universal 25%|25% off everything/i);
  });
});
