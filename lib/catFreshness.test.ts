import { describe, expect, it } from 'vitest';
import { currentObservation, evaluateVariant, type Observation } from './catFreshness';

const now = 1_800_000_000_000;
const stock: Observation = {
  field: 'stock',
  extractedValue: 'in_stock',
  observedAt: now,
  confidence: 'confirmed',
};
describe('evidence confidence and time', () => {
  it('never verifies inventory from future, unverified or policy-derived observations', () => {
    for (const over of [
      { observedAt: now + 1 },
      { confidence: 'unverified' as const },
      { confidence: 'policy_derived' as const },
    ])
      expect(currentObservation([{ ...stock, ...over }], 'stock', now)).toBeNull();
  });
  it('ignores expired conflicts, retains current conflicts and compares exact decimal values', () => {
    const cost: Observation = { ...stock, field: 'wholesale', extractedValue: '115' };
    expect(
      currentObservation(
        [
          { ...cost, unit: 'USD_per_piece' },
          { ...cost, unit: 'USD_per_pack' },
        ],
        'wholesale',
        now
      )
    ).toBe('conflict');
    expect(
      currentObservation([cost, { ...cost, extractedValue: '115.0000' }], 'wholesale', now)
    ).not.toBe('conflict');
    expect(currentObservation([cost, { ...cost, extractedValue: '116' }], 'wholesale', now)).toBe(
      'conflict'
    );
    expect(currentObservation([{ ...cost, confidence: 'conflict' }], 'wholesale', now)).toBe(
      'conflict'
    );
    expect(
      currentObservation(
        [cost, { ...cost, confidence: 'conflict', effectiveTo: now }],
        'wholesale',
        now
      )
    ).toEqual(cost);
  });
  it('cannot use an active price list to bless missing or future verification', () => {
    for (const verifiedAt of [undefined, now + 1, NaN]) {
      const result = evaluateVariant({
        now,
        piecesPerPack: 1,
        cartons: 1,
        priceListValidUntil: now + 10000,
        cost: {
          wholesaleMinor: 100,
          mapMinor: null,
          mapSource: 'none',
          mapApplicability: 'not_applicable',
          mapUnitBasis: 'piece',
          verifiedAt,
        },
        observations: [stock],
        policy: {
          stockSyncMaxHours: 24,
          checkoutSourceMaxHours: 24,
          costMapMaxDays: 7,
          recheckOnSupplierNotice: true,
        },
      });
      expect(result.holds).toContain('COST_STALE');
    }
  });
});
