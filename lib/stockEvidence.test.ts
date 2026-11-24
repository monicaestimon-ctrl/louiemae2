import { describe, expect, it } from 'vitest';
import { stockQuantity, stockView, type StockEvidence } from './stockEvidence';
const now = 1_800_000_000_000;
const source: StockEvidence = {
  warehouseId: 'CA',
  warehouseFingerprint: 'warehouse-v1',
  quantity: '5.000000000',
  unitBasis: 'piece',
  kind: 'available_to_sell',
  availability: 'in_stock',
  confirmed: true,
  piecesPerPack: 2,
  observedAt: now - 1000,
};
const view = (over: Partial<StockEvidence> = {}, warehouse = 'CA', pack = 2, minimum = 1) =>
  stockView({ ...source, ...over }, warehouse, pack, now, 86400000, minimum, 'warehouse-v1');
describe('stock source semantics', () => {
  it('floors piece counts into whole packs and respects the minimum purchase quantity', () => {
    expect(view()).toMatchObject({ availablePacks: 2, automatic: true, availability: 'in_stock' });
    expect(view({ unitBasis: 'pack' })).toMatchObject({ availablePacks: 5 });
    expect(view({ quantity: '1' })).toMatchObject({
      availablePacks: 0,
      availability: 'out_of_stock',
      automatic: false,
    });
    expect(view({}, 'CA', 2, 3).availability).toBe('out_of_stock');
  });
  it('does not confuse unknown units, physical on-hand stock or a binary flag with available allocations', () => {
    expect(view({ unitBasis: 'unknown' })).toMatchObject({ current: false, automatic: false });
    expect(view({ unitBasis: 'piece_or_pack' })).toMatchObject({ current: false });
    expect(view({ unitBasis: 'piece_or_pack', piecesPerPack: 1 }, 'CA', 1)).toMatchObject({
      current: true,
      availablePacks: 5,
    });
    expect(view({ kind: 'on_hand' })).toMatchObject({
      current: true,
      automatic: false,
      availablePacks: 2,
    });
    expect(view({ kind: 'binary', quantity: null })).toMatchObject({
      current: true,
      automatic: false,
      availablePacks: null,
    });
  });
  it('rejects another origin, changed pack, expired, future and unverified evidence', () => {
    expect(view({}, 'FL').current).toBe(false);
    expect(view({ warehouseFingerprint: 'warehouse-v2' }).current).toBe(false);
    expect(view({}, 'CA', 4).current).toBe(false);
    for (const over of [
      { confirmed: false },
      { observedAt: now + 1 },
      { observedAt: now - 86400001 },
      { validUntil: now },
    ])
      expect(view(over).current).toBe(false);
  });
  it('never rounds a fractional quantity up or silently treats unknown as zero', () => {
    expect(stockQuantity(null)).toBeNull();
    expect(stockQuantity('0.000')).toBe(0);
    for (const value of ['0.5', '-1', '1e3', '', '1000001'])
      expect(() => stockQuantity(value)).toThrow();
  });
});
