// Availability observations and the freshness refresh job (spec S10, v2 §6). There is no
// authorized live Zuo stock integration yet: operations record authenticated checks here, and
// the job re-evaluates freshness so stale evidence becomes a hold instead of a sale.
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { requireDeliveryRole } from './dlvAccess';
import { openHold, refreshVariant } from './catCore';
import { audit, openReview } from './sysCore';
import { availability } from './v2Validators';
import { CommerceError, isCommerceError } from '../lib/errors';
import { stockQuantity, stockView } from '../lib/stockEvidence';
import { digest } from './dlvSecurity';
import type { Id } from './_generated/dataModel';

/** Legacy binary writes lacked actual source dates, origin and units. Preserve history only. */
export const recordStock = mutation({
  args: { variantId: v.id('catVariants'), availability, source: v.string() },
  handler: async (ctx) => {
    await requireDeliveryRole(ctx, 'operations');
    throw new CommerceError(
      'INVALID_INPUT',
      'Use the stock evidence form with source time, warehouse and quantity basis.'
    );
  },
});

export const detail = query({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT');
    const warehouse = cv.warehouseId ? await ctx.db.get(cv.warehouseId) : null;
    return {
      variant: {
        id: cv._id,
        sku: cv.supplierSku,
        piecesPerPack: cv.piecesPerPack,
        availability: cv.availability,
        warehouseId: cv.warehouseId ?? null,
      },
      warehouse,
      warehouseFingerprint: await digest(warehouse),
      current: cv.currentStockRevisionId ? await ctx.db.get(cv.currentStockRevisionId) : null,
      history: await ctx.db
        .query('catStockRevisions')
        .withIndex('by_variant_created', (q) => q.eq('variantId', cv._id))
        .order('desc')
        .take(20),
      canReactivate: actor.approver,
    };
  },
});

export const recordEvidence = mutation({
  args: {
    variantId: v.id('catVariants'),
    expectedRevisionId: v.union(v.id('catStockRevisions'), v.null()),
    expectedWarehouseId: v.union(v.id('catWarehouses'), v.null()),
    expectedWarehouseFingerprint: v.string(),
    expectedPiecesPerPack: v.number(),
    requestKey: v.string(),
    quantity: v.union(v.string(), v.null()),
    unitBasis: v.union(
      v.literal('piece'),
      v.literal('pack'),
      v.literal('piece_or_pack'),
      v.literal('unknown')
    ),
    kind: v.union(
      v.literal('available_to_sell'),
      v.literal('on_hand'),
      v.literal('binary'),
      v.literal('unknown')
    ),
    availability,
    confirmed: v.boolean(),
    observedAt: v.number(),
    validUntil: v.optional(v.number()),
    source: v.string(),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    const now = Date.now();
    if (
      !/^[\w-]{8,80}$/.test(a.requestKey) ||
      !a.source.trim() ||
      a.source.length > 1000 ||
      !a.note.trim() ||
      a.note.length > 1000 ||
      !Number.isSafeInteger(a.observedAt) ||
      a.observedAt <= 0 ||
      a.observedAt > now
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Provide a source reference, actual past observation time and review note'
      );
    const quantity = stockQuantity(a.quantity);
    if (
      a.validUntil !== undefined &&
      (!Number.isSafeInteger(a.validUntil) || a.validUntil <= a.observedAt)
    )
      throw new CommerceError('INVALID_INPUT', 'Source expiry must follow its observation time');
    if (
      (a.kind === 'binary' && quantity !== null) ||
      (['available_to_sell', 'on_hand'].includes(a.kind) && quantity === null)
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Binary availability has no quantity; counted sources require an explicit quantity'
      );
    if (a.availability === 'in_stock' && quantity === 0)
      throw new CommerceError('INVALID_INPUT', 'Zero stock cannot be marked in stock');
    const key = `stock-evidence:${await digest(actor.email)}:${a.requestKey}`,
      hash = await digest(a);
    const previous = await ctx.db
      .query('sysIdempotencyKeys')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first();
    if (previous) {
      if (previous.scope !== hash || !previous.resultRef)
        throw new CommerceError('INVALID_INPUT', 'Retry differs from saved stock evidence');
      return previous.resultRef as Id<'catStockRevisions'>;
    }
    const cv = await ctx.db.get(a.variantId);
    if (!cv) throw new CommerceError('INVALID_INPUT');
    if (
      (cv.currentStockRevisionId ?? null) !== a.expectedRevisionId ||
      (cv.warehouseId ?? null) !== a.expectedWarehouseId ||
      cv.piecesPerPack !== a.expectedPiecesPerPack
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Stock, warehouse or pack changed. Reload before saving.'
      );
    const old = cv.currentStockRevisionId ? await ctx.db.get(cv.currentStockRevisionId) : null;
    if (old && old.observedAt > a.observedAt)
      throw new CommerceError(
        'INVALID_INPUT',
        'An older source cannot replace the current stock observation'
      );
    const warehouse = cv.warehouseId ? await ctx.db.get(cv.warehouseId) : null;
    const warehouseFingerprint = await digest(warehouse);
    if (a.expectedWarehouseFingerprint !== warehouseFingerprint)
      throw new CommerceError(
        'INVALID_INPUT',
        'Warehouse evidence changed. Reload before confirming stock.'
      );
    if (
      a.confirmed &&
      a.availability !== 'discontinued' &&
      (!warehouse || warehouse.supplierId !== cv.supplierId)
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Assign the supplier warehouse before confirming its stock'
      );
    if (
      cv.availability === 'discontinued' &&
      a.availability !== 'discontinued' &&
      (!actor.approver || !a.confirmed)
    )
      throw new CommerceError(
        'FORBIDDEN',
        'Restoring a discontinued variant requires an approver and verified evidence'
      );
    const record = {
      variantId: cv._id,
      warehouseId: cv.warehouseId ?? null,
      warehouseFingerprint,
      quantity: a.quantity,
      unitBasis: a.unitBasis,
      kind: a.kind,
      availability: a.availability,
      confirmed: a.confirmed,
      piecesPerPack: cv.piecesPerPack,
      source: a.source.trim(),
      note: a.note.trim(),
      observedAt: a.observedAt,
      ...(a.validUntil !== undefined ? { validUntil: a.validUntil } : {}),
      createdAt: now,
      createdBy: actor.email,
    };
    const id = await ctx.db.insert('catStockRevisions', record);
    const view = stockView(
      record,
      cv.warehouseId,
      cv.piecesPerPack,
      now,
      Number.MAX_SAFE_INTEGER,
      cv.orderMinimumPacks,
      record.warehouseFingerprint
    );
    await ctx.db.insert('catSourceObservations', {
      supplierId: cv.supplierId,
      variantId: cv._id,
      supplierSku: cv.supplierSku,
      field: 'stock',
      extractedValue: view.availability,
      unit: a.unitBasis,
      sourceFile: a.source.trim(),
      observedAt: a.observedAt,
      contentHash: hash,
      verifier: actor.email,
      confidence: view.current ? 'confirmed' : 'unverified',
      createdAt: now,
    });
    await ctx.db.patch(cv._id, {
      currentStockRevisionId: id,
      availability:
        a.confirmed && a.availability === 'discontinued' ? 'discontinued' : view.availability,
      availabilityObservedAt: a.observedAt,
      updatedAt: now,
    });
    await openHold(
      ctx,
      cv._id,
      'MANUAL',
      'Stock source changed; review availability, units, origin and fulfillment before release.',
      actor.email
    );
    if (!view.current)
      await openHold(
        ctx,
        cv._id,
        'STOCK_UNVERIFIED',
        'Stock source or quantity basis remains unresolved.',
        actor.email
      );
    await openReview(ctx, 'stock_evidence_changed', 'catVariants', cv._id, `Stock revision ${id}; ${a.note.trim()}`);
    await audit(ctx, {
      actor: actor.email,
      action: 'stock.evidence',
      entityTable: 'catVariants',
      entityId: cv._id,
      before: old?._id ?? null,
      after: id,
      reason: a.note.trim(),
      requestId: a.requestKey,
    });
    await ctx.db.insert('sysIdempotencyKeys', { key, scope: hash, resultRef: id, createdAt: now });
    try {
      await refreshVariant(ctx, cv._id, actor.email, now);
    } catch (e) {
      if (!isCommerceError(e, 'POLICY_NOT_APPROVED')) throw e;
    }
    return id;
  },
});

/** One page of the freshness refresh; schedules the next page. Skips quietly while the policy is unapproved. */
export const refreshPage = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const page = await ctx.db
      .query('catVariants')
      .paginate({ cursor: a.cursor ?? null, numItems: 50 });
    for (const cv of page.page) {
      try {
        await refreshVariant(ctx, cv._id, 'system:freshness');
      } catch (e) {
        if (isCommerceError(e, 'POLICY_NOT_APPROVED'))
          return { skipped: 'freshness policy not approved' };
        throw e;
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.catStock.refreshPage, {
        cursor: page.continueCursor,
      });
    return { processed: page.page.length };
  },
});
