// Internal holds protect our checkout capacity; they do not reserve supplier inventory.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { CommerceError } from '../lib/errors';
import { stockView } from '../lib/stockEvidence';
import { warehouseCurrent } from '../lib/shipping/evidence';
import type { FreshnessPolicy } from '../lib/config';
import { activeConfig } from './sysConfig';
import { digest } from './dlvSecurity';
import { requireDeliveryRole } from './dlvAccess';
import { audit } from './sysCore';

type Ctx = QueryCtx | MutationCtx;
const unavailable = (message: string): never => {
  throw new CommerceError('STOCK_UNAVAILABLE', message);
};

/** Read all relevant commitments or fail closed. Never silently truncate stock deductions. */
export async function commitments(ctx: Ctx, variantId: Id<'catVariants'>, now: number) {
  const held = await ctx.db
    .query('ordInventoryReservations')
    .withIndex('by_variant_status_expires', (q) =>
      q.eq('variantId', variantId).eq('status', 'held').gt('expiresAt', now)
    )
    .take(501);
  const consumed = await ctx.db
    .query('ordInventoryReservations')
    .withIndex('by_variant_status', (q) => q.eq('variantId', variantId).eq('status', 'consumed'))
    .take(501);
  if (held.length > 500 || consumed.length > 500)
    unavailable('Inventory commitments require operational reconciliation');
  return [...held, ...consumed];
}

export async function currentInventory(ctx: Ctx, cv: Doc<'catVariants'>, now: number) {
  const supplier = await ctx.db.get(cv.supplierId);
  const warehouse = cv.warehouseId ? await ctx.db.get(cv.warehouseId) : null;
  const revision = cv.currentStockRevisionId ? await ctx.db.get(cv.currentStockRevisionId) : null;
  const policy = await activeConfig<FreshnessPolicy>(
    ctx,
    'freshnessPolicy',
    supplier?.freshnessKey ?? 'freshness-default'
  );
  const view = stockView(
    revision,
    cv.warehouseId,
    cv.piecesPerPack,
    now,
    Math.min(policy.value.stockSyncMaxHours, policy.value.checkoutSourceMaxHours) * 3600000,
    cv.orderMinimumPacks,
    await digest(warehouse)
  );
  if (warehouse?.supplierId !== cv.supplierId || !warehouseCurrent(warehouse, now)) unavailable('Inventory warehouse requires review');
  return { revision, view };
}

/** Shared by estimate reads and the serializable checkout mutation that inserts the holds. */
export async function availableAfterCommitments(
  ctx: Ctx,
  cv: Doc<'catVariants'>,
  sourcePacks: number,
  now: number,
  excludeIntent?: Id<'ordCheckoutIntents'>
) {
  let committed = 0;
  for (const row of await commitments(ctx, cv._id, now)) {
    if (row.intentId === excludeIntent) continue;
    // Legacy obligations with unknown origin/pack cannot be safely reinterpreted.
    if (!row.warehouseId || !row.piecesPerPack || !Number.isSafeInteger(row.packs) || row.packs < 1)
      unavailable('An existing inventory commitment needs its warehouse and pack basis reconciled');
    if (row.warehouseId !== cv.warehouseId) continue;
    if (row.piecesPerPack !== cv.piecesPerPack)
      unavailable('Pack size changed while inventory commitments remain');
    committed += row.packs;
  }
  return Math.max(0, sourcePacks - committed);
}

/** Payment is already real: return a reason for the paid-exception queue, never retry a charge. */
export async function paymentStockFailure(ctx: MutationCtx, intent: Doc<'ordCheckoutIntents'>) {
  const now = Date.now();
  const holds = await ctx.db
    .query('ordInventoryReservations')
    .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
    .collect();
  const wanted = new Map<Id<'catVariants'>, number>();
  for (const line of intent.lineSnapshot) {
    if (line.supplierCode !== 'zuo') continue; // Preserve the approved legacy Ashcroft route.
    const variant = await ctx.db.get(line.variantId);
    if (!variant || (line.supplierSku && line.supplierSku !== variant.supplierSku) ||
      (line.warehouseId && line.warehouseId !== variant.warehouseId)) return 'Original supplier identity changed';
    wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.packs);
  }
  for (const [id, packs] of wanted) {
    const cv = await ctx.db.get(id);
    if (!cv || cv.availability !== 'in_stock') return 'Variant is no longer available';
    const own = holds.filter((r) => r.variantId === id);
    if (
      !own.length ||
      own.some(
        (r) =>
          r.status !== 'held' ||
          r.expiresAt <= now ||
          r.warehouseId !== cv.warehouseId ||
          r.piecesPerPack !== cv.piecesPerPack ||
          !r.stockRevisionId
      ) ||
      own.reduce((n, r) => n + r.packs, 0) !== packs
    )
      return 'Checkout inventory hold no longer matches the paid basket';
    try {
      const stock = await currentInventory(ctx, cv, now);
      if (!stock.view.automatic || stock.view.availablePacks === null)
        return 'Current supplier stock requires confirmation';
      const available = await availableAfterCommitments(
        ctx,
        cv,
        stock.view.availablePacks,
        now,
        intent._id
      );
      if (packs > available) return 'Supplier stock no longer covers the paid basket';
    } catch (error) {
      if (!(error instanceof CommerceError)) throw error;
      return 'Current inventory evidence or commitments require review';
    }
  }
  return null;
}

/** A paid exception is still a real obligation; expiry must not return its stock to checkout. */
export async function retainPaidCommitments(ctx: MutationCtx, intentId: Id<'ordCheckoutIntents'>) {
  const rows = await ctx.db
    .query('ordInventoryReservations')
    .withIndex('by_intent', (q) => q.eq('intentId', intentId))
    .collect();
  for (const row of rows) {
    if (row.status === 'held' || row.status === 'released')
      await ctx.db.patch(row._id, { status: 'consumed' });
  }
  const intent = await ctx.db.get(intentId);
  const wanted = new Map<Id<'catVariants'>, number>();
  for (const line of intent?.lineSnapshot ?? []) {
    if (line.supplierCode === 'zuo')
      wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.packs);
  }
  for (const [variantId, packs] of wanted) {
    const recorded = rows.filter((r) => r.variantId === variantId).reduce((n, r) => n + r.packs, 0);
    if (recorded < packs) {
      // Missing historical holds cannot erase a paid obligation. Unknown scope deliberately
      // blocks checkout until operational reconciliation; never invent a warehouse.
      await ctx.db.insert('ordInventoryReservations', {
        variantId,
        intentId,
        packs: packs - recorded,
        status: 'consumed',
        expiresAt: Date.now(),
        createdAt: Date.now(),
      });
    }
  }
}

export const pending = query({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT');
    const rows = await ctx.db
      .query('ordInventoryReservations')
      .withIndex('by_variant_status', (q) => q.eq('variantId', cv._id).eq('status', 'consumed'))
      .take(51);
    return {
      canReconcile: actor.approver,
      currentRevisionId: cv.currentStockRevisionId ?? null,
      hasMore: rows.length > 50,
      rows: rows.slice(0, 50).map((r) => ({
        id: r._id,
        intentId: r.intentId,
        packs: r.packs,
        warehouseId: r.warehouseId ?? null,
        piecesPerPack: r.piecesPerPack ?? null,
      })),
    };
  },
});

export const reconcile = mutation({
  args: {
    reservationId: v.id('ordInventoryReservations'),
    expectedRevisionId: v.id('catStockRevisions'),
    evidence: v.string(),
    note: v.string(),
    confirmed: v.boolean(),
    requestKey: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    if (
      !a.confirmed ||
      a.evidence.trim().length < 3 ||
      a.evidence.length > 1000 ||
      a.note.trim().length < 3 ||
      a.note.length > 1000 ||
      !/^[\w-]{16,80}$/.test(a.requestKey)
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Confirm supplier allocation with a source reference and review note'
      );
    const key = `inventory-reconcile:${await digest(actor.email)}:${a.requestKey}`;
    const hash = await digest(a);
    const prior = await ctx.db
      .query('sysIdempotencyKeys')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first();
    if (prior) {
      if (prior.scope !== hash || prior.resultRef !== a.reservationId)
        throw new CommerceError('INVALID_INPUT', 'Retry differs from the saved reconciliation');
      return a.reservationId;
    }
    const row = await ctx.db.get(a.reservationId);
    const cv = row ? await ctx.db.get(row.variantId) : null;
    const intent = row ? await ctx.db.get(row.intentId) : null;
    if (
      !row ||
      row.status !== 'consumed' ||
      !cv ||
      !intent ||
      !['paid', 'exception'].includes(intent.status) ||
      cv.currentStockRevisionId !== a.expectedRevisionId
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Pending allocation or current stock changed; reload'
      );
    const { revision, view } = await currentInventory(ctx, cv, Date.now());
    const order = await ctx.db
      .query('ordOrders')
      .withIndex('by_intent', (q) => q.eq('intentId', intent._id))
      .first();
    // Exceptions cannot release their obligation without a documented fulfillment/refund resolution.
    if (!order || intent.status !== 'paid')
      throw new CommerceError(
        'INVALID_INPUT',
        'Resolve the paid-order exception before reconciling supplier stock'
      );
    if (
      !revision ||
      !view.current ||
      revision.kind !== 'available_to_sell' ||
      revision.observedAt < order.paidAt ||
      revision._id === row.stockRevisionId ||
      row.warehouseId !== cv.warehouseId ||
      row.piecesPerPack !== cv.piecesPerPack
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Use a newer current warehouse count that accounts for this paid allocation'
      );
    const lines = await ctx.db
      .query('ordOrderLines')
      .withIndex('by_order', (q) => q.eq('orderId', order._id))
      .collect();
    let acknowledgedPacks = 0;
    for (const line of lines.filter((l) => l.variantId === cv._id)) {
      for (const allocation of await ctx.db
        .query('ordAllocations')
        .withIndex('by_line', (q) => q.eq('orderLineId', line._id))
        .collect()) {
        const child = await ctx.db.get(allocation.supplierOrderId);
        if (
          allocation.status !== 'cancelled' &&
          child?.supplierConfirmation?.trim() &&
          child.submission.handoffAt &&
          child.submission.handoffAt <= revision.observedAt &&
          !child.submission.uncertain &&
          ['acknowledged', 'partially_shipped', 'shipped', 'delivered'].includes(child.status)
        )
          acknowledgedPacks += allocation.packs;
      }
    }
    if (acknowledgedPacks !== row.packs)
      throw new CommerceError(
        'INVALID_INPUT',
        'Record supplier handoff and acknowledgement for the complete allocation before reconciliation'
      );
    await ctx.db.patch(row._id, {
      status: 'reconciled',
      reconciledRevisionId: revision._id,
      reconciliationEvidence: a.evidence.trim(),
      reconciledAt: Date.now(),
      reconciledBy: actor.email,
    });
    await audit(ctx, {
      actor: actor.email,
      action: 'inventory.supplier_allocation_reconciled',
      entityTable: 'ordInventoryReservations',
      entityId: row._id,
      before: row,
      after: { stockRevisionId: revision._id, evidence: a.evidence.trim() },
      reason: a.note.trim(),
      requestId: key,
    });
    await ctx.db.insert('sysIdempotencyKeys', {
      key,
      scope: hash,
      resultRef: row._id,
      createdAt: Date.now(),
    });
    return row._id;
  },
});
