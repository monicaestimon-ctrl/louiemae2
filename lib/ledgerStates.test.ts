import { describe, expect, it } from 'vitest';
import { applyCommission, applyCredit, type ObligationView } from './ledgerStates';

const o = (over: Partial<ObligationView> = {}): ObligationView => ({ state: 'pending', earnedMinor: 1_000, reversedMinor: 0, heldMinor: 0, clearsAt: 100, ...over });

describe('commission obligation state machine', () => {
  it('clears only when due and with something left', () => {
    expect(() => applyCommission(o(), 'cleared', 0, 50)).toThrow(/not yet due/);
    expect(applyCommission(o(), 'cleared', 0, 100).state).toBe('cleared');
    expect(applyCommission(o({ reversedMinor: 1_000 }), 'cleared', 0, 100).state).toBe('void');
  });

  it('reverses refunds cumulatively and never over-reverses', () => {
    const a = applyCommission(o(), 'refund_reversal', -400, 0);
    expect(a).toMatchObject({ reversedMinor: 400, state: 'pending' });
    const b = applyCommission(a, 'refund_reversal', -600, 0);
    expect(b).toMatchObject({ reversedMinor: 1_000, state: 'void' });
    expect(() => applyCommission(a, 'refund_reversal', -601, 0)).toThrow();
    expect(() => applyCommission(a, 'refund_reversal', 10, 0)).toThrow();
  });

  it('holds a dispute, restores once when won and voids when lost', () => {
    const held = applyCommission(o({ state: 'cleared' }), 'dispute_hold', 0, 0);
    expect(held).toMatchObject({ state: 'held', heldMinor: 1_000 });
    expect(applyCommission(held, 'dispute_release', 0, 200).state).toBe('cleared');
    expect(applyCommission(held, 'dispute_release', 0, 50).state).toBe('pending');
    expect(applyCommission(held, 'dispute_lost', 0, 0)).toMatchObject({ state: 'void', reversedMinor: 1_000 });
    expect(() => applyCommission(o({ state: 'transferred' }), 'dispute_hold', 0, 0)).toThrow();
  });

  it('walks the payout path and recovers from failures', () => {
    let x = applyCommission(o({ state: 'cleared' }), 'reserved', 0, 0);
    x = applyCommission(x, 'transfer_submitted', 0, 0);
    expect(applyCommission(x, 'transfer_failed', 0, 0).state).toBe('cleared');
    x = applyCommission(x, 'transferred', 0, 0);
    expect(x.state).toBe('transferred');
    expect(() => applyCommission(x, 'refund_reversal', -1, 0)).toThrow(); // after payout: an offset instead
    expect(applyCommission(x, 'transfer_reversed', 0, 0).state).toBe('cleared');
    expect(() => applyCommission(o(), 'reserved', 0, 0)).toThrow();
    expect(() => applyCommission(o(), 'earned', 1, 0)).toThrow();
  });
});

describe('store credit account', () => {
  const zero = { availableMinor: 0, reservedMinor: 0, pendingAwardMinor: 0, lifetimeIssuedMinor: 0 };
  it('awards, reserves, redeems and releases', () => {
    let a = applyCredit(zero, 'award_pending', 10_000);
    expect(() => applyCredit(a, 'reserved', 1)).toThrow(/not enough/);
    a = applyCredit(a, 'award_available', 10_000);
    expect(a).toMatchObject({ availableMinor: 10_000, pendingAwardMinor: 0, lifetimeIssuedMinor: 10_000 });
    a = applyCredit(a, 'reserved', 6_000);
    expect(() => applyCredit(a, 'reserved', 4_001)).toThrow(); // no overspend
    a = applyCredit(a, 'redeemed', 6_000);
    expect(a).toMatchObject({ availableMinor: 4_000, reservedMinor: 0 });
    a = applyCredit(a, 'reinstated', 6_000);
    expect(a.availableMinor).toBe(10_000);
  });

  it('cancels a pending award and allows a visible offset when credit was spent', () => {
    expect(applyCredit(applyCredit(zero, 'award_pending', 10_000), 'award_cancelled', 10_000).pendingAwardMinor).toBe(0);
    expect(() => applyCredit(zero, 'reversed', 1)).toThrow(/offset/);
    expect(applyCredit(zero, 'offset_created', 10_000).availableMinor).toBe(-10_000);
    expect(() => applyCredit(zero, 'manual_adjustment', -1)).toThrow();
  });
});
