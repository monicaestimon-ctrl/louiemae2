// Trade and project benefits (spec S32, v2 §18). Trade discounts come from an explicit per-supplier
// schedule; the general 25% is never applied to a supplier without a schedule entry, Zuo gets its
// approved 10% (or documented 5%) and never stacks a project discount. Project thresholds use the
// eligible subtotal after the trade discount and before the project discount, excluding tax,
// delivery and credits; the highest reached tier applies, never both.
import type { ProjectDiscountPolicy, TradeDiscountSchedule } from './config';
import { CommerceError } from './errors';

export function tradeDiscountBps(schedule: TradeDiscountSchedule, supplierCode: string, approvedException = false) {
  const s = schedule.suppliers[supplierCode];
  if (!s) {
    if (schedule.general.requiresSchedule) throw new CommerceError('POLICY_NOT_APPROVED', `No trade discount schedule for ${supplierCode}`);
    return schedule.general.maxBps;
  }
  const bps = approvedException && s.approvedExceptionBps !== undefined ? s.approvedExceptionBps : s.defaultBps;
  return Math.min(bps, schedule.general.maxBps);
}

export type ProjectLine = { key: string; tradeUnitMinor: number; quantity: number; floorUnitMinor: number; mapUnitMinor: number | null; stackable: boolean };

/**
 * Applies the project tier to eligible lines. Each line shows whether it is project-eligible and
 * its actual discount; a line never goes below its floor or MAP.
 */
export function applyProjectTier(lines: readonly ProjectLine[], policy: ProjectDiscountPolicy) {
  const eligible = lines.filter((l) => l.stackable);
  const basis = eligible.reduce((t, l) => t + l.tradeUnitMinor * l.quantity, 0);
  const tier = [...policy.tiers].sort((a, b) => b.minMinor - a.minMinor).find((t) => basis >= t.minMinor) ?? null;
  const out = lines.map((l) => {
    if (!l.stackable || !tier) return { key: l.key, eligible: l.stackable, unitMinor: l.tradeUnitMinor, discountMinor: 0 };
    const target = Math.round((l.tradeUnitMinor * (10_000 - tier.bps)) / 10_000);
    const unitMinor = Math.min(l.tradeUnitMinor, Math.max(target, l.floorUnitMinor, l.mapUnitMinor ?? 0));
    return { key: l.key, eligible: true, unitMinor, discountMinor: (l.tradeUnitMinor - unitMinor) * l.quantity };
  });
  return { basisMinor: basis, tierBps: tier?.bps ?? 0, lines: out, discountMinor: out.reduce((t, l) => t + l.discountMinor, 0) };
}

/** Combined reduction off retail for a trade discount and a project tier (e.g. 25% + 3% → 27.25%). */
export const combinedReductionBps = (tradeBps: number, projectBps: number) => 10_000 - ((10_000 - tradeBps) * (10_000 - projectBps)) / 10_000;
