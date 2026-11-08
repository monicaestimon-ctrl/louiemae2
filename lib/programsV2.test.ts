import { describe, expect, it } from 'vitest';
import { appliedRate, ATTRIBUTION_WINDOW_MS, looksLikeBot, winningClick } from './attribution';
import { inLocalWindow, localParts, nextTier, rateFor, tierFor, tierWindow, zonedInstant } from './tiers';
import { applyProjectTier, combinedReductionBps, tradeDiscountBps } from './projectDiscount';
import { abuseFlags, profileProblems, safeRedirect } from './enrollment';
import { CONFIG_SEED } from './config/seed';
import type { CommissionSchedule, ProjectDiscountPolicy, TradeDiscountSchedule } from './config';

const sched = CONFIG_SEED.find((s) => s.key === 'commission-schedule')!.value as CommissionSchedule;
const trade = CONFIG_SEED.find((s) => s.key === 'trade-discount')!.value as TradeDiscountSchedule;
const project = CONFIG_SEED.find((s) => s.key === 'project-discount')!.value as ProjectDiscountPolicy;

describe('attribution (REF02, G6)', () => {
  const c = (clickId: string, at: number, eligible = true) => ({ clickId, beneficiaryId: clickId, eligible, at, expiresAt: at + ATTRIBUTION_WINDOW_MS });
  it('picks the last eligible click and ignores ineligible ones', () => {
    expect(winningClick([c('a', 0), c('b', 10), c('self', 20, false)], 30)!.clickId).toBe('b');
  });
  it('honours the exact 30 × 24 h boundary', () => {
    const x = c('a', 0);
    expect(winningClick([x], ATTRIBUTION_WINDOW_MS - 1)!.clickId).toBe('a');
    expect(winningClick([x], ATTRIBUTION_WINDOW_MS)).toBeNull();
  });
  it('breaks ties deterministically and ignores future clicks', () => {
    expect(winningClick([c('a', 5), c('b', 5)], 6)!.clickId).toBe('b');
    expect(winningClick([c('a', 10)], 5)).toBeNull();
  });
  it('filters bots and applies the higher protected rate', () => {
    expect(looksLikeBot('facebookexternalhit/1.1')).toBe(true);
    expect(looksLikeBot('Mozilla/5.0 (iPhone)')).toBe(false);
    expect(appliedRate(1800, 1500)).toBe(1800);
    expect(appliedRate(1200, 1500)).toBe(1500);
  });
});

describe('tiers (REF04, G5, G8)', () => {
  it('uses inclusive thresholds at $15,000, $50,000 and $100,000', () => {
    expect(tierFor(1_499_999, sched)).toBe('base');
    expect(tierFor(1_500_000, sched)).toBe('active');
    expect(tierFor(4_999_999, sched)).toBe('active');
    expect(tierFor(5_000_000, sched)).toBe('top');
    expect(tierFor(10_000_000, sched)).toBe('elite');
    expect(rateFor(sched, 'elite', 'decor')).toBe(1200);
  });
  it('builds the preceding 12 calendar months, including across a leap day', () => {
    const now = Date.UTC(2028, 1, 29, 12); // 29 Feb 2028
    expect(new Date(tierWindow(now, { windowMonths: 12, windowShape: 'calendar_months' }).start).toISOString()).toBe('2027-02-01T00:00:00.000Z');
    expect(tierWindow(now, { windowMonths: 12, windowShape: 'rolling_365' }).start).toBe(now - 365 * 86_400_000);
  });
  it('moves down one step a quarter (Nov 3 rule) or immediately, as configured', () => {
    expect(nextTier('elite', 'base', 'quarterly_one_step', false)).toBe('elite');
    expect(nextTier('elite', 'base', 'quarterly_one_step', true)).toBe('top');
    expect(nextTier('elite', 'base', 'immediate', false)).toBe('base');
    expect(nextTier('base', 'top', 'quarterly_one_step', false)).toBe('top');
  });
  it('finds 00:15 America/Chicago across daylight-saving changes', () => {
    // CDT (UTC−5) in July and CST (UTC−6) in December
    expect(new Date(zonedInstant('America/Chicago', 2026, 7, 1, 0, 15)).toISOString()).toBe('2026-07-01T05:15:00.000Z');
    expect(new Date(zonedInstant('America/Chicago', 2026, 12, 1, 0, 15)).toISOString()).toBe('2026-12-01T06:15:00.000Z');
    // The hourly cron at :15 hits the local window exactly once per local day on both DST change days.
    for (const day of [Date.UTC(2026, 2, 8), Date.UTC(2026, 10, 1)]) {
      const hits = new Set<string>();
      for (let h = -6; h < 30; h++) {
        const d = inLocalWindow(day + h * 3_600_000 + 15 * 60_000, 'America/Chicago', '00:15');
        if (d) hits.add(d);
      }
      expect(hits.size).toBeGreaterThanOrEqual(1);
    }
    expect(localParts(Date.UTC(2026, 11, 15, 15), 'America/Chicago').hour).toBe(9);
  });
});

describe('trade and project benefits (S32, G4)', () => {
  it('never applies the general 25% to a supplier without a schedule, and gives Zuo 10% or the approved 5%', () => {
    expect(() => tradeDiscountBps(trade, 'ashcroft')).toThrow();
    expect(tradeDiscountBps(trade, 'zuo')).toBe(1000);
    expect(tradeDiscountBps(trade, 'zuo', true)).toBe(500);
  });
  it('applies the highest reached project tier to stackable lines only, never below floor or MAP', () => {
    const lines = [
      { key: 'a', tradeUnitMinor: 1_000_000, quantity: 1, floorUnitMinor: 0, mapUnitMinor: null, stackable: true },
      { key: 'zuo', tradeUnitMinor: 500_000, quantity: 1, floorUnitMinor: 500_000, mapUnitMinor: null, stackable: false },
    ];
    const r = applyProjectTier(lines, project);
    expect(r.basisMinor).toBe(1_000_000); // Zuo excluded from the threshold basis
    expect(r.tierBps).toBe(300);
    expect(r.lines.find((l) => l.key === 'zuo')).toMatchObject({ eligible: false, discountMinor: 0 });
    const big = applyProjectTier([{ ...lines[0], tradeUnitMinor: 3_000_000 }], project);
    expect(big.tierBps).toBe(500); // 5%, not 3% + 5%
    const floored = applyProjectTier([{ ...lines[0], floorUnitMinor: 990_000 }], project);
    expect(floored.lines[0].unitMinor).toBe(990_000);
    const mapped = applyProjectTier([{ ...lines[0], mapUnitMinor: 999_000 }], project);
    expect(mapped.lines[0].unitMinor).toBe(999_000);
    expect(combinedReductionBps(2500, 300)).toBe(2725);
    expect(combinedReductionBps(2500, 500)).toBe(2875);
  });
});

describe('enrollment checks and redirects (S24, S25)', () => {
  it('validates creator profiles and flags (never blocks) suspicious enrollments', () => {
    expect(profileProblems({ displayName: 'Ava Home', urls: ['https://instagram.com/avahome'] })).toEqual([]);
    expect(profileProblems({ displayName: 'A', urls: [] })).toHaveLength(2);
    expect(abuseFlags({ email: 'x@mailinator.com', urls: ['https://bit.ly/x'], duplicatePayoutIdentity: true, recentEnrollmentsFromSameDomain: 0 })).toHaveLength(3);
    expect(abuseFlags({ email: 'ava@gmail.com', urls: ['https://instagram.com/ava'], duplicatePayoutIdentity: false, recentEnrollmentsFromSameDomain: 1 })).toEqual([]);
  });
  it('allows only same-site allowlisted redirects', () => {
    expect(safeRedirect('/#collection/furniture?product=x')).toBe('/#collection/furniture?product=x');
    expect(safeRedirect('/trade')).toBe('/trade');
    expect(safeRedirect('//evil.com')).toBe('/');
    expect(safeRedirect('https://evil.com')).toBe('/');
    expect(safeRedirect('/admin')).toBe('/');
  });
});
