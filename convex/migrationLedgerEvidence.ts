// Complete, bounded migration evidence. Never derive money from a truncated prefix.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { CommerceError } from '../lib/errors';
import { digest } from './dlvSecurity';
import { applyCredit } from '../lib/ledgerStates';
type Ctx = QueryCtx | MutationCtx;
export const CREDIT_LIMIT = 2000;
export const COMMISSION_LIMIT = 5000;
export const SYNC_LIMIT = 200;
export const reconciliation = (message: string): never => { throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', message); };
export function completeRows<T>(rows: T[], limit: number, scope: string): T[] {
  if (rows.length > limit) reconciliation(`${scope}: exceeds ${limit} rows; complete scoped reconciliation required`);
  return rows;
}
export function cents(value: number, scope: string) {
  if (!Number.isSafeInteger(value)) reconciliation(`${scope}: invalid whole-cent amount`);
  return value;
}
export async function legacyCredits(ctx: Ctx, userId: Id<'users'>) {
  const rows = completeRows(await ctx.db.query('holmCredits').withIndex('by_user', q => q.eq('userId', userId)).take(CREDIT_LIMIT + 1), CREDIT_LIMIT, 'Legacy credit');
  const holds = rows.filter(r => r.kind === 'reserved');
  const refs = new Set<string>();
  let held = 0;
  for (const h of holds) {
    const amount = cents(h.heldCents ?? -h.amountCents, 'Legacy hold');
    if (amount <= 0 || amount !== -h.amountCents || !h.ref?.trim() || refs.has(h.ref)) reconciliation('Ambiguous legacy credit hold');
    refs.add(h.ref!); held = cents(held + amount, 'Held credit total');
  }
  const balance = Math.max(0, rows.reduce((n, r) => cents(n + cents(r.amountCents, 'Legacy credit row'), 'Legacy credit total'), 0));
  cents(balance + held, 'Opening credit total');
  const fingerprint = await digest(rows.map(r => ({ id: r._id, amount: r.amountCents, kind: r.kind ?? null, held: r.heldCents ?? null, ref: r.ref ?? null, at: r.at })));
  return { rows, holds, balance, held, fingerprint };
}
export async function commissionEvidence(ctx: Ctx, commission: Doc<'holmCommissions'>, original: Doc<'ldgObligations'>) {
  const owner = await ctx.db.get(original.beneficiaryId);
  if (!owner || owner.legacyUserId !== commission.partnerId || owner.userId !== commission.partnerId || original.legacyCommissionId !== commission._id) reconciliation('Legacy commission beneficiary differs');
  const prefix = `sync:${commission._id}:`;
  const events = completeRows(await ctx.db.query('ldgCommissionEvents').withIndex('by_key', q => q.gte('eventKey', prefix).lt('eventKey', `${prefix}\uffff`)).take(SYNC_LIMIT + 1), SYNC_LIMIT, 'Legacy sync history');
  if (new Set(events.map(e => e.eventKey)).size !== events.length) reconciliation('Duplicate legacy sync events');
  const obligations = [original];
  const seen = new Set<string>([original._id]);
  for (const event of events) {
    if (seen.has(event.obligationId)) continue;
    const row = await ctx.db.get(event.obligationId);
    if (!row || row.beneficiaryId !== original.beneficiaryId || !['offset', 'adjustment'].includes(row.source) || row.legacyCommissionId) reconciliation('Legacy sync event has a foreign or missing obligation');
    seen.add(event.obligationId); obligations.push(row!);
  }
  const accounted = obligations.reduce((n, o) => cents(n + (o.state === 'void' ? 0 : cents(o.earnedMinor - o.reversedMinor, 'Legacy obligation')), 'Legacy accounted total'), 0);
  return { obligations, accounted, events };
}
export async function creditParity(ctx: Ctx, userId: Id<'users'>) {
  const source = await legacyCredits(ctx, userId);
  const account = await ctx.db.query('ldgCreditAccounts').withIndex('by_user', q => q.eq('userId', userId)).unique();
  if (!account) {
    if (source.rows.length) reconciliation('Legacy credit has no v2 account');
    return;
  }
  const events = completeRows(await ctx.db.query('ldgCreditEvents').withIndex('by_account_at', q => q.eq('accountId', account._id)).take(CREDIT_LIMIT + 1), CREDIT_LIMIT, 'Credit event history');
  if (source.rows.length) {
    const opening = events.filter(e => e.eventKey === `opening:credit:${userId}`);
    if (opening.length !== 1 || opening[0].type !== 'opening_balance' || opening[0].sourceFingerprint !== source.fingerprint || opening[0].amountMinor !== source.balance + source.held) reconciliation('Credit opening source changed or lacks verified provenance');
    const holds = events.filter(e => e.eventKey.startsWith('opening:credit-hold:'));
    if (holds.length !== source.holds.length) reconciliation('Migrated credit hold count differs');
    for (const h of source.holds) {
      const matches = holds.filter(e => e.eventKey === `opening:credit-hold:${h._id}`);
      if (matches.length !== 1 || matches[0].type !== 'reserved' || matches[0].ref !== h.ref || matches[0].amountMinor !== (h.heldCents ?? -h.amountCents)) reconciliation('Migrated credit hold differs');
    }
  } else if (events.some(e => e.eventKey === `opening:credit:${userId}`)) reconciliation('Migrated legacy credit source is missing');
  let projection = { availableMinor: 0, reservedMinor: 0, pendingAwardMinor: 0, lifetimeIssuedMinor: 0 };
  for (const e of events) {
    try { projection = applyCredit(projection, e.type, e.amountMinor); }
    catch { reconciliation('Credit event replay failed'); }
  }
  for (const key of Object.keys(projection) as (keyof typeof projection)[]) if (cents(projection[key], 'Credit projection') !== cents(account[key], 'Credit account')) reconciliation(`Credit projection differs: ${key}`);
}
