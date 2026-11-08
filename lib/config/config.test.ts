import { describe, expect, it } from 'vitest';
import { parseConfig } from './index';
import { CONFIG_SEED } from './seed';
import { flag, flagStates, payoutRoute, requireFlag, V2_FLAGS } from '../flags';
import { isCommerceError } from '../errors';

describe('config seed and parsers', () => {
  it('every seed record parses, and keys are unique per version', () => {
    const seen = new Set<string>();
    for (const s of CONFIG_SEED) {
      expect(() => parseConfig(s.kind, s.value)).not.toThrow();
      const id = `${s.kind}/${s.key}/${s.version}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      if (s.status === 'proposed') expect(s.decision).toBeTruthy();
    }
  });

  it('rejects malformed values', () => {
    expect(() => parseConfig('deliveryLadder', { tiersMinor: [5999, 4999], quoteAboveMinor: 4999, minimumMinor: 5999, deliveryProcessingBps: 300 })).toThrow();
    expect(() => parseConfig('commissionSchedule', { ceilingBps: 2300, tiers: [{ key: 'base', minMinor: 0, rates: { furniture: 1000, decor: 800 } }] })).toThrow();
    expect(() => parseConfig('marginPolicy', { targetBps: 12_000 })).toThrow();
    expect(() => parseConfig('payoutSchedule', { day: 15, cutoffDay: 14, localTime: '9am', cutoffLocalTime: '23:59:59', tz: 'America/Chicago', minimumMinor: 5000 })).toThrow();
    expect(() => parseConfig('tierPolicy', [])).toThrow();
  });

  it('seeds the v2 commission schedule exactly', () => {
    const s = CONFIG_SEED.find((x) => x.key === 'commission-schedule')!.value as { tiers: { key: string; minMinor: number; rates: Record<string, number> }[] };
    expect(s.tiers.map((t) => [t.key, t.minMinor, t.rates.furniture, t.rates.decor, t.rates.clothing])).toEqual([
      ['base', 0, 1000, 800, 500],
      ['active', 1_500_000, 1200, 900, 600],
      ['top', 5_000_000, 1500, 1000, 700],
      ['elite', 10_000_000, 1800, 1200, 800],
    ]);
  });
});

describe('flags', () => {
  it('are off unless exactly "true"', () => {
    expect(flag('CREDIT_V2_ENABLED', {})).toBe(false);
    expect(flag('CREDIT_V2_ENABLED', { CREDIT_V2_ENABLED: 'TRUE' })).toBe(false);
    expect(flag('CREDIT_V2_ENABLED', { CREDIT_V2_ENABLED: 'true' })).toBe(true);
    expect(Object.values(flagStates({})).every((x) => x === false)).toBe(true);
    expect(Object.keys(flagStates({}))).toHaveLength(V2_FLAGS.length);
    try {
      requireFlag('EDI_ZUO_ENABLED', {});
      expect.unreachable();
    } catch (e) {
      expect(isCommerceError(e, 'FEATURE_DISABLED')).toBe(true);
    }
  });

  it('never allows both payout routes', () => {
    expect(payoutRoute({})).toBe('none');
    expect(payoutRoute({ PARTNER_PAYOUTS_ENABLED: 'true' })).toBe('legacy');
    expect(payoutRoute({ PAYOUT_EXECUTION_ENABLED: 'true' })).toBe('v2');
    expect(payoutRoute({ PARTNER_PAYOUTS_ENABLED: 'true', PAYOUT_EXECUTION_ENABLED: 'true' })).toBe('conflict');
  });
});
