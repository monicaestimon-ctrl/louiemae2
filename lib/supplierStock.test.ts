import { describe, expect, it } from 'vitest';
import type { Observation } from './catFreshness';
import { supplierStockConstraint } from './supplierStock';

const now = 1_800_000_000_000;
const source = (ca: number | null, fl: number | null, over: Partial<Observation> = {}): Observation => ({
  field: 'supplier_inventory_on_hand', observedAt: now - 1000, confidence: 'confirmed',
  extractedValue: JSON.stringify({ CA_QTY: ca, FL_QTY: fl, kind: 'on_hand', unitBasis: 'unknown' }), ...over,
});
describe('supplier on-hand constraints', () => {
  it('withdraws stock only from explicit zero at both warehouses; positive and missing counts never grant availability', () => {
    expect(supplierStockConstraint([source(0, 0)], undefined, now)?.availability).toBe('out_of_stock');
    for (const pair of [[0, null], [null, 0], [null, null], [1, 0], [0, 1]] as const)
      expect(supplierStockConstraint([source(pair[0], pair[1])], undefined, now)?.availability).toBe('unknown');
  });
  it('respects strictly newer stock evidence and keeps equal-time negative evidence conservative', () => {
    expect(supplierStockConstraint([source(0, 0)], now, now)).toBeNull();
    expect(supplierStockConstraint([source(0, 0)], now - 1000, now)?.availability).toBe('out_of_stock');
    expect(supplierStockConstraint([source(0, 0), source(2, 0, { observedAt: now })], undefined, now)?.availability).toBe('unknown');
  });
  it('does not trust malformed, conflicting, future, or unverified source observations', () => {
    for (const extractedValue of ['bad', 'null', '{}', '{"CA_QTY":0,"FL_QTY":0}', '{"CA_QTY":-1,"FL_QTY":0,"kind":"on_hand"}'])
      expect(supplierStockConstraint([source(0, 0, { extractedValue })], undefined, now)?.availability).toBe('unknown');
    expect(supplierStockConstraint([source(0, 0), source(1, 0)], undefined, now)?.availability).toBe('unknown');
    expect(supplierStockConstraint([source(0, 0, { confidence: 'conflict' })], undefined, now)?.availability).toBe('unknown');
    expect(supplierStockConstraint([source(0, 0, { observedAt: now + 1 })], undefined, now)).toBeNull();
    expect(supplierStockConstraint([source(0, 0, { confidence: 'unverified' })], undefined, now)).toBeNull();
    expect(supplierStockConstraint(Array.from({ length: 20 }, () => source(0, 0)), undefined, now)?.availability).toBe('unknown');
  });
});
