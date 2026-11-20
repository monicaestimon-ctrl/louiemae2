// Commission obligation and store-credit state machines (spec 03 S06, v2 §17 and §19).
// Pure, so every transition is unit-tested; convex/ldgCore.ts applies them inside mutations.

export type ObligationState = 'pending' | 'cleared' | 'held' | 'reserved' | 'transfer_submitted' | 'transferred' | 'void';
export type CommissionEventType =
  | 'earned'
  | 'opening_balance'
  | 'refund_reversal'
  | 'dispute_hold'
  | 'dispute_release'
  | 'dispute_lost'
  | 'cleared'
  | 'reserved'
  | 'reservation_released'
  | 'transfer_submitted'
  | 'transferred'
  | 'transfer_failed'
  | 'transfer_reversed'
  | 'offset'
  | 'manual_adjustment'
  | 'void';

export type ObligationView = { state: ObligationState; earnedMinor: number; reversedMinor: number; heldMinor: number; clearsAt: number };

/** States from which each event may be applied. Creation events have no prior state. */
export const COMMISSION_TRANSITIONS: Record<Exclude<CommissionEventType, 'earned' | 'opening_balance' | 'offset' | 'manual_adjustment'>, readonly ObligationState[]> = {
  refund_reversal: ['pending', 'cleared', 'held'],
  dispute_hold: ['pending', 'cleared'],
  dispute_release: ['held'],
  dispute_lost: ['held'],
  cleared: ['pending'],
  reserved: ['cleared'],
  reservation_released: ['reserved'],
  transfer_submitted: ['reserved'],
  transferred: ['transfer_submitted', 'reserved'],
  transfer_failed: ['transfer_submitted'],
  transfer_reversed: ['transferred'],
  void: ['pending', 'cleared', 'held'],
};

export class LedgerTransitionError extends Error {}

/**
 * The obligation after an event. `amountMinor` is signed: earned and adjustments positive or
 * negative, refund reversals negative (the amount taken back).
 */
export function applyCommission(o: ObligationView, type: CommissionEventType, amountMinor: number, now: number): ObligationView {
  if (!Number.isSafeInteger(amountMinor)) throw new LedgerTransitionError('amount must be whole cents');
  if (type === 'earned' || type === 'opening_balance' || type === 'offset' || type === 'manual_adjustment')
    throw new LedgerTransitionError(`${type} creates an obligation; it is not applied to one`);
  const allowed = COMMISSION_TRANSITIONS[type];
  if (!allowed.includes(o.state)) throw new LedgerTransitionError(`${type} is not allowed from ${o.state}`);
  const remaining = o.earnedMinor - o.reversedMinor;
  switch (type) {
    case 'refund_reversal': {
      const take = -amountMinor;
      if (take < 0 || take > remaining) throw new LedgerTransitionError('refund reversal must be between 0 and the remaining amount');
      const reversed = o.reversedMinor + take;
      const left = o.earnedMinor - reversed;
      return { ...o, reversedMinor: reversed, heldMinor: o.state === 'held' ? left : o.heldMinor, state: left === 0 ? 'void' : o.state };
    }
    case 'dispute_hold':
      return { ...o, state: 'held', heldMinor: remaining };
    case 'dispute_release':
      return { ...o, heldMinor: 0, state: now >= o.clearsAt ? 'cleared' : 'pending' };
    case 'dispute_lost':
      return { ...o, heldMinor: 0, reversedMinor: o.earnedMinor, state: 'void' };
    case 'cleared':
      if (now < o.clearsAt) throw new LedgerTransitionError('not yet due to clear');
      return { ...o, state: remaining > 0 ? 'cleared' : 'void' };
    case 'reserved':
      return { ...o, state: 'reserved' };
    case 'reservation_released':
    case 'transfer_failed':
    case 'transfer_reversed':
      return { ...o, state: 'cleared' };
    case 'transfer_submitted':
      return { ...o, state: 'transfer_submitted' };
    case 'transferred':
      return { ...o, state: 'transferred' };
    case 'void':
      return { ...o, reversedMinor: o.earnedMinor, state: 'void' };
  }
}

// ---------------- store credit ----------------
export type CreditEventType =
  | 'opening_balance'
  | 'award_pending'
  | 'award_available'
  | 'award_cancelled'
  | 'reserved'
  | 'reservation_released'
  | 'redeemed'
  | 'reversed'
  | 'reinstated'
  | 'offset_created'
  | 'manual_adjustment';

export type CreditAccountView = { availableMinor: number; reservedMinor: number; pendingAwardMinor: number; lifetimeIssuedMinor: number };

/** The account after a credit event. Amounts are positive magnitudes except manual adjustments. */
export function applyCredit(a: CreditAccountView, type: CreditEventType, amountMinor: number): CreditAccountView {
  if (!Number.isSafeInteger(amountMinor)) throw new LedgerTransitionError('amount must be whole cents');
  const pos = (x: number) => {
    if (x < 0) throw new LedgerTransitionError(`${type} amount must be positive`);
    return x;
  };
  const n = { ...a };
  switch (type) {
    case 'opening_balance':
      n.availableMinor += pos(amountMinor);
      break;
    case 'award_pending':
      n.pendingAwardMinor += pos(amountMinor);
      break;
    case 'award_available':
      if (pos(amountMinor) > a.pendingAwardMinor) throw new LedgerTransitionError('award exceeds pending');
      n.pendingAwardMinor -= amountMinor;
      n.availableMinor += amountMinor;
      n.lifetimeIssuedMinor += amountMinor;
      break;
    case 'award_cancelled':
      if (pos(amountMinor) > a.pendingAwardMinor) throw new LedgerTransitionError('cancel exceeds pending');
      n.pendingAwardMinor -= amountMinor;
      break;
    case 'reserved':
      if (pos(amountMinor) > a.availableMinor) throw new LedgerTransitionError('not enough available credit');
      n.availableMinor -= amountMinor;
      n.reservedMinor += amountMinor;
      break;
    case 'reservation_released':
      if (pos(amountMinor) > a.reservedMinor) throw new LedgerTransitionError('release exceeds reserved');
      n.reservedMinor -= amountMinor;
      n.availableMinor += amountMinor;
      break;
    case 'redeemed':
      if (pos(amountMinor) > a.reservedMinor) throw new LedgerTransitionError('redeem exceeds reserved');
      n.reservedMinor -= amountMinor;
      break;
    case 'reversed':
      if (pos(amountMinor) > Math.max(0, a.availableMinor)) throw new LedgerTransitionError('reverse exceeds available; create an offset');
      n.availableMinor -= amountMinor;
      break;
    case 'reinstated':
      n.availableMinor += pos(amountMinor);
      break;
    case 'offset_created':
      n.availableMinor -= pos(amountMinor); // may go negative: a visible offset against future credit
      break;
    case 'manual_adjustment':
      if (a.availableMinor + amountMinor < 0) throw new LedgerTransitionError('adjustment would make credit negative');
      n.availableMinor += amountMinor;
      break;
  }
  return n;
}
