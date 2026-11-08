// Tier computation (spec 02 §8.8, v2 §15) and America/Chicago scheduling helpers. Pure.
import type { CommissionCategory, CommissionSchedule, TierKey, TierPolicy } from './config';

export const TIER_ORDER: readonly TierKey[] = ['base', 'active', 'top', 'elite'];
export const tierRank = (t: TierKey) => TIER_ORDER.indexOf(t);

/** Highest tier whose threshold the qualifying amount reaches (boundaries inclusive). */
export function tierFor(qualifyingMinor: number, schedule: CommissionSchedule): TierKey {
  let tier: TierKey = schedule.tiers[0].key;
  for (const t of schedule.tiers) if (qualifyingMinor >= t.minMinor) tier = t.key;
  return tier;
}

export function rateFor(schedule: CommissionSchedule, tier: TierKey, category: CommissionCategory): number {
  const row = schedule.tiers.find((t) => t.key === tier) ?? schedule.tiers[0];
  return Math.min(row.rates[category], schedule.ceilingBps);
}

/**
 * The qualifying window ending at `now` (exclusive): the preceding 12 calendar months of UTC
 * payment timestamps (from the first instant of the month 12 months before the current month),
 * or a rolling 365 days. Leap days are handled by Date arithmetic on calendar fields.
 */
export function tierWindow(now: number, policy: Pick<TierPolicy, 'windowMonths' | 'windowShape'>) {
  if (policy.windowShape === 'rolling_365') return { start: now - 365 * 86_400_000, end: now };
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - policy.windowMonths, 1);
  return { start, end: now };
}

/** The next tier given the earned tier and the downgrade policy (one step a quarter, or immediate). */
export function nextTier(current: TierKey, earned: TierKey, downgrade: TierPolicy['downgrade'], quarterChanged: boolean): TierKey {
  if (tierRank(earned) >= tierRank(current)) return earned;
  if (downgrade === 'immediate') return earned;
  return quarterChanged ? TIER_ORDER[tierRank(current) - 1] : current;
}

export function tierProgress(tier: TierKey, qualifyingMinor: number, schedule: CommissionSchedule) {
  const idx = schedule.tiers.findIndex((t) => t.key === tier);
  const next = schedule.tiers[idx + 1];
  return next ? { next: next.key, toNextMinor: Math.max(0, next.minMinor - qualifyingMinor) } : { next: null, toNextMinor: 0 };
}

/** Local wall-clock parts in an IANA time zone (handles daylight saving). */
export function localParts(at: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second), date: `${p.year}-${p.month}-${p.day}` };
}

/** UTC instant of a local wall-clock time in a time zone (exact across DST). */
export function zonedInstant(tz: string, y: number, mo: number, d: number, h: number, mi: number, s = 0, ms = 0): number {
  let guess = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ms);
    const diff = asUtc - Date.UTC(y, mo - 1, d, h, mi, s, ms);
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

/** Whether `at` falls in the hour starting at a local HH:MM in `tz` (for hourly crons that run once a local day). */
export function inLocalWindow(at: number, tz: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const p = localParts(at, tz);
  const minutes = p.hour * 60 + p.minute;
  const target = h * 60 + m;
  return minutes >= target && minutes < target + 60 ? p.date : null;
}

export const quarterOf = (at: number) => {
  const d = new Date(at);
  return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
};
