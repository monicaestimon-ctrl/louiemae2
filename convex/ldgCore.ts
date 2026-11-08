// Append-only ledger reducers (spec S06). Every money event has a stable key claimed in the same
// mutation (exactly once), is appended to its event table, and only then updates the projection.
// Events are never patched or deleted; corrections are new events.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { applyCommission, applyCredit, LedgerTransitionError, type CommissionEventType, type CreditEventType, type ObligationState } from '../lib/ledgerStates';
import { CommerceError } from '../lib/errors';
import { claimKey, setKeyResult } from './sysCore';

type NewObligation = Omit<Doc<'ldgObligations'>, '_id' | '_creationTime' | 'createdAt' | 'updatedAt' | 'earnedMinor' | 'reversedMinor' | 'heldMinor' | 'refundedBasisMinor' | 'currency'> & {
  refundedBasisMinor?: number;
};

export type CommissionEventInput = {
  eventKey: string;
  type: CommissionEventType;
  amountMinor: number;
  actor: string;
  reason?: string;
  providerRef?: string;
  cumulativeRefundedMinor?: number;
  at?: number;
  patch?: Partial<Pick<Doc<'ldgObligations'>, 'payoutRunId' | 'transferAttemptId' | 'paidAt'>>;
} & ({ obligationId: Id<'ldgObligations'>; create?: undefined } | { obligationId?: undefined; create: NewObligation });

/**
 * Applies one commission event. Returns `{ duplicate: true }` (and changes nothing) when the event
 * key was already used. Invalid transitions throw PAYMENT_RECONCILIATION_REQUIRED.
 */
export async function applyCommissionEvent(ctx: MutationCtx, e: CommissionEventInput) {
  const claim = await claimKey(ctx, e.eventKey, 'commission');
  if (claim.duplicate) return { duplicate: true as const, obligationId: claim.resultRef as Id<'ldgObligations'> | undefined };
  const at = e.at ?? Date.now();
  let obligationId: Id<'ldgObligations'>;
  if (e.create) {
    if (!['earned', 'opening_balance', 'offset', 'manual_adjustment'].includes(e.type)) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', `${e.type} cannot create an obligation`);
    if ((e.type === 'earned' || e.type === 'opening_balance') && e.amountMinor < 0) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'earned amount cannot be negative');
    obligationId = await ctx.db.insert('ldgObligations', {
      ...e.create,
      earnedMinor: e.amountMinor,
      reversedMinor: e.create.state === 'void' && e.type === 'opening_balance' ? e.amountMinor : 0,
      heldMinor: 0,
      refundedBasisMinor: e.create.refundedBasisMinor ?? 0,
      currency: 'USD',
      createdAt: at,
      updatedAt: at,
    });
  } else {
    const o = await ctx.db.get(e.obligationId);
    if (!o) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'obligation not found');
    let next;
    try {
      next = applyCommission(o, e.type, e.amountMinor, at);
    } catch (err) {
      if (err instanceof LedgerTransitionError) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', err.message);
      throw err;
    }
    obligationId = o._id;
    await ctx.db.patch(o._id, {
      state: next.state,
      reversedMinor: next.reversedMinor,
      heldMinor: next.heldMinor,
      ...(e.type === 'cleared' ? { clearedAt: at } : {}),
      ...(e.cumulativeRefundedMinor !== undefined ? { refundedBasisMinor: e.cumulativeRefundedMinor } : {}),
      ...(e.patch ?? {}),
      updatedAt: at,
    });
  }
  const eventId = await ctx.db.insert('ldgCommissionEvents', {
    eventKey: e.eventKey,
    obligationId,
    type: e.type,
    amountMinor: e.amountMinor,
    actor: e.actor,
    at,
    ...(e.reason ? { reason: e.reason } : {}),
    ...(e.providerRef ? { providerRef: e.providerRef } : {}),
    ...(e.cumulativeRefundedMinor !== undefined ? { cumulativeRefundedMinor: e.cumulativeRefundedMinor } : {}),
  });
  await setKeyResult(ctx, e.eventKey, obligationId);
  return { duplicate: false as const, obligationId, eventId };
}

/** Sum of an obligation's events, for the projection-parity invariant (tests and admin checks). */
export async function obligationEventTotals(ctx: QueryCtx, obligationId: Id<'ldgObligations'>) {
  const events = await ctx.db.query('ldgCommissionEvents').withIndex('by_obligation_at', (q) => q.eq('obligationId', obligationId)).collect();
  let earned = 0;
  let reversed = 0;
  for (const ev of events) {
    if (ev.type === 'earned' || ev.type === 'opening_balance' || ev.type === 'offset' || ev.type === 'manual_adjustment') earned += ev.amountMinor;
    if (ev.type === 'refund_reversal') reversed += -ev.amountMinor;
  }
  return { earned, reversed, events: events.length };
}

/** Payable amount of an obligation (positive for earnings, negative for offsets). */
export const payable = (o: Pick<Doc<'ldgObligations'>, 'earnedMinor' | 'reversedMinor'>) => o.earnedMinor - o.reversedMinor;

export const PAYABLE_STATES: readonly ObligationState[] = ['cleared'];

// ---------------- store credit ----------------
export async function creditAccountFor(ctx: MutationCtx, userId: Id<'users'>) {
  const existing = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', (q) => q.eq('userId', userId)).first();
  if (existing) return existing;
  const id = await ctx.db.insert('ldgCreditAccounts', { userId, availableMinor: 0, reservedMinor: 0, pendingAwardMinor: 0, lifetimeIssuedMinor: 0, updatedAt: Date.now() });
  return (await ctx.db.get(id))!;
}

export type CreditEventInput = {
  eventKey: string;
  userId: Id<'users'>;
  type: CreditEventType;
  amountMinor: number;
  actor: string;
  reason?: string;
  ref?: string;
  orderId?: Id<'ordOrders'>;
  intentId?: Id<'ordCheckoutIntents'>;
  referredOrganizationId?: Id<'prgOrganizations'>;
  fundingReserveRef?: string;
  availableAt?: number;
  at?: number;
};

/** Applies one credit event exactly once; overspending throws (so concurrent carts can't both reserve). */
export async function applyCreditEvent(ctx: MutationCtx, e: CreditEventInput) {
  const claim = await claimKey(ctx, e.eventKey, 'credit');
  if (claim.duplicate) return { duplicate: true as const };
  const account = await creditAccountFor(ctx, e.userId);
  let next;
  try {
    next = applyCredit(account, e.type, e.amountMinor);
  } catch (err) {
    if (err instanceof LedgerTransitionError) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', err.message);
    throw err;
  }
  const at = e.at ?? Date.now();
  await ctx.db.patch(account._id, { ...next, updatedAt: at });
  const { userId: _u, at: _a, ...rest } = e;
  void _u;
  void _a;
  const eventId = await ctx.db.insert('ldgCreditEvents', { ...rest, accountId: account._id, at });
  return { duplicate: false as const, eventId, account: next };
}
