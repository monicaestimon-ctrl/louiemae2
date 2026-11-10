import { describe, expect, it } from 'vitest';
import { modeledParcelFreight, validModeledParcel, type ModeledParcelRates } from './modeledParcel';
import { parseConfig } from '../config';
import { CONFIG_SEED } from '../config/seed';
import type { CartonIn } from '../shipping/classify';
const model: ModeledParcelRates = { sourceSha256: 'a'.repeat(64), sourceObservedAt: 1000,
  maxCartons: 4, maxLongestMm: 1200, maxSecondLongestMm: 760, maxLengthPlusGirthMm: 2600,
  maxVolumeMm3: 160_000_000, maxActualWeightG: 22_000, packageMinorByZone: { west: [1000, 2000, 2500] } };
const rule = { dimDivisorMm3PerG: 5021 } as Parameters<typeof modeledParcelFreight>[1];
const carton: CartonIn = { lengthMm: 100, widthMm: 100, heightMm: 100, grossWeightG: 400, supplierMethod: 'ground' };
describe('approved modeled parcel rates', () => {
  it('rates each carton by its own rounded billable weight', () => {
    expect(modeledParcelFreight([carton, { ...carton, grossWeightG: 700 }], rule, 'west', model)).toEqual({ freightMinor: 3000, billableLb: [1, 2] });
    expect(modeledParcelFreight([{ ...carton, lengthMm: 180, widthMm: 180, heightMm: 180 }], rule, 'west', model)).toEqual({ freightMinor: 2500, billableLb: [3] });
  });
  it('requires a quote for unsupported destinations, counts, dimensions, weights and supplier LTL', () => {
    for (const [cartons, zone] of [
      [[carton], 'unknown'], [Array(5).fill(carton), 'west'],
      [[{ ...carton, supplierMethod: 'ltl' }], 'west'],
      [[{ ...carton, widthMm: 800, lengthMm: 810 }], 'west'],
      [[{ ...carton, lengthMm: 1300 }], 'west'],
      [[{ ...carton, grossWeightG: 1400 }], 'west'],
      [[{ ...carton, grossWeightG: 23000 }], 'west'],
      [[{ ...carton, heightMm: 0 }], 'west'],
    ] as [CartonIn[], string][]) expect(modeledParcelFreight(cartons, rule, zone, model)).toHaveProperty('reason');
  });
  it('requires explicit modeled provenance and positive bounded rate tables in settings', () => {
    const seed = CONFIG_SEED.find(x => x.kind === 'carrierRule')!.value as Record<string, unknown>;
    expect(() => parseConfig('carrierRule', { ...seed, rateBasis: 'modeled_parcel', modeledParcel: model })).not.toThrow();
    expect(() => parseConfig('carrierRule', { ...seed, modeledParcel: model })).toThrow();
    expect(() => parseConfig('carrierRule', { ...seed, rateBasis: 'modeled_parcel' })).toThrow();
    expect(validModeledParcel({ ...model, packageMinorByZone: { west: [0] } })).toBe(false);
    expect(validModeledParcel({ ...model, sourceObservedAt: Date.now() + 10000 })).toBe(false);
    expect(validModeledParcel({ ...model, sourceSha256: 'unverified' })).toBe(false);
  });
});
