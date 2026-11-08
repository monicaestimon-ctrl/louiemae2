// Zuo EDI as a supplier-specific fulfillment adapter (spec S23, v2 §13). Disabled this release
// (EDI_ZUO_ENABLED off) and wired only to a mock transport: no supplier order is ever sent from
// this build. The payload carries one Zuo child order's SKUs, quantities, agreed costs and the
// shipping contact it needs — never Ashcroft lines, other suppliers' costs, referral data or the
// whole cart. Manual and EDI submission are mutually exclusive per child order.
import { v } from 'convex/values';
import { internalMutation, mutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit, claimKey } from './sysCore';
import { requireFlag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import { stableStringify } from '../lib/zuoImport';

export type EdiPayload = {
  poNumber: string;
  mappingVersion: string;
  shipTo: { name: string; line1: string; line2?: string; city: string; state: string; postalCode: string; country: string; phone?: string };
  lines: { supplierSku: string; quantityPacks: number; agreedUnitCostMinor: number | null }[];
};

/** Builds the payload for one Zuo child order from its own allocations only. */
export async function buildPayload(ctx: MutationCtx, child: Doc<'ordSupplierOrders'>): Promise<EdiPayload> {
  if (child.supplierCode !== 'zuo') throw new CommerceError('FORBIDDEN', 'EDI is only for Zuo child orders');
  const order = await ctx.db.get(child.orderId);
  if (!order?.shippingAddress) throw new CommerceError('INVALID_INPUT', 'Missing ship-to address');
  const allocs = await ctx.db.query('ordAllocations').withIndex('by_supplier_order', (q) => q.eq('supplierOrderId', child._id)).collect();
  const lines = [];
  for (const al of allocs) {
    if (al.status === 'cancelled') continue;
    const line = await ctx.db.get(al.orderLineId);
    const variant = line ? await ctx.db.get(line.variantId) : null;
    const cost = line?.costRevisionId ? await ctx.db.get(line.costRevisionId) : null;
    if (!line || !variant || line.supplierCode !== 'zuo') throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Allocation outside the Zuo child order');
    lines.push({ supplierSku: variant.supplierSku, quantityPacks: al.packs, agreedUnitCostMinor: cost?.wholesaleMinor !== null && cost?.wholesaleMinor !== undefined ? cost.wholesaleMinor * variant.piecesPerPack : null });
  }
  return { poNumber: `LM-${String(child._id).slice(-10).toUpperCase()}`, mappingVersion: 'zuo-edi-mapping-1', shipTo: { name: order.email, ...order.shippingAddress, state: order.shippingAddress.state ?? '' }, lines };
}

export type Transport = { send: (payload: EdiPayload) => Promise<{ outcome: 'accepted' | 'rejected' | 'uncertain'; transmissionId?: string }> };

/** Records a transmission outcome. "uncertain" blocks any resubmission or manual fallback until reconciled. */
async function recordOutcome(ctx: MutationCtx, childId: Id<'ordSupplierOrders'>, outcome: 'accepted' | 'rejected' | 'uncertain', transmissionId: string | undefined, by: string) {
  const c = (await ctx.db.get(childId))!;
  const submission: Doc<'ordSupplierOrders'>['submission'] =
    outcome === 'rejected' ? { mode: 'none' } : { ...c.submission, mode: 'edi', ...(transmissionId ? { transmissionId } : {}), ackState: outcome, uncertain: outcome === 'uncertain' };
  await ctx.db.patch(c._id, { submission, status: outcome === 'accepted' ? 'submitted' : outcome === 'rejected' ? 'queued' : c.status, updatedAt: Date.now() });
  await audit(ctx, { actor: by, action: `edi.${outcome}`, entityTable: 'ordSupplierOrders', entityId: c._id });
}

/**
 * Prepares one EDI submission (idempotent per logical PO). Returns the payload for the transport.
 * Refuses when the child was handled manually or an earlier transmission is still uncertain.
 */
export async function prepareSubmission(ctx: MutationCtx, childId: Id<'ordSupplierOrders'>, by: string) {
  requireFlag('EDI_ZUO_ENABLED');
  const c = await ctx.db.get(childId);
  if (!c) throw new CommerceError('INVALID_INPUT', 'Supplier order not found');
  if (c.submission.mode === 'manual') throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Already ordered manually');
  if (c.submission.uncertain) throw new CommerceError('PAYMENT_RECONCILIATION_REQUIRED', 'Reconcile the uncertain transmission first');
  if (c.status !== 'queued') return { duplicate: true as const };
  const payload = await buildPayload(ctx, c);
  const payloadHash = stableStringify(payload);
  const claim = await claimKey(ctx, `edi:${payload.poNumber}`, 'edi');
  if (claim.duplicate) return { duplicate: true as const };
  await ctx.db.patch(c._id, { supplierPo: payload.poNumber, submission: { mode: 'edi', handoffAt: Date.now(), by, payloadHash, uncertain: true }, updatedAt: Date.now() });
  return { duplicate: false as const, payload };
}

/** Test/mock path only: prepares, "sends" through the given transport and records the outcome. */
export async function submitWith(ctx: MutationCtx, childId: Id<'ordSupplierOrders'>, transport: Transport, by: string) {
  const prep = await prepareSubmission(ctx, childId, by);
  if (prep.duplicate) return 'duplicate';
  const res = await transport.send(prep.payload);
  await recordOutcome(ctx, childId, res.outcome, res.transmissionId, by);
  return res.outcome;
}

/** Operations resolves an uncertain transmission after checking with Zuo (accepted → ordered; not received → back to queue). */
export const reconcileUncertain = mutation({
  args: { supplierOrderId: v.id('ordSupplierOrders'), supplierReceived: v.boolean(), note: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const c = await ctx.db.get(a.supplierOrderId);
    if (!c?.submission.uncertain) throw new CommerceError('INVALID_INPUT', 'Nothing to reconcile');
    await recordOutcome(ctx, c._id, a.supplierReceived ? 'accepted' : 'rejected', c.submission.transmissionId, admin.email);
    await audit(ctx, { actor: admin.email, action: 'edi.reconcile', entityTable: 'ordSupplierOrders', entityId: c._id, reason: a.note });
  },
});

/** Supplier acknowledgement / shipment / invoice messages update the child only (never accepted customer prices). */
export const supplierMessage = internalMutation({
  args: { poNumber: v.string(), kind: v.union(v.literal('ack'), v.literal('reject')), transmissionId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query('ordSupplierOrders').withIndex('by_route_status', (q) => q.eq('route', 'manual_dealer_zuo')).take(500);
    const c = rows.find((r) => r.supplierPo === a.poNumber);
    if (!c) return;
    await recordOutcome(ctx, c._id, a.kind === 'ack' ? 'accepted' : 'rejected', a.transmissionId, 'edi:zuo');
    if (a.kind === 'ack') await ctx.db.patch(c._id, { status: 'acknowledged' });
  },
});
