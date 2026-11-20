import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { openHold } from './catCore';
import { audit, openReview } from './sysCore';
import { digest } from './dlvSecurity';
import { stableStringify } from '../lib/canonicalJson';
import { CommerceError } from '../lib/errors';
import { normalizeCartons, warehouseCurrent } from '../lib/shipping/evidence';
import { US_STATES, zipRegion } from '../lib/delivery/destination';

type Ctx = QueryCtx | MutationCtx;
async function snapshot(ctx: Ctx, variantId: Id<'catVariants'>) {
  const variant = await ctx.db.get(variantId);
  if (!variant) throw new CommerceError('INVALID_INPUT', 'Variant not found');
  const cartons = await ctx.db
    .query('catCartons')
    .withIndex('by_variant', (q) => q.eq('variantId', variantId))
    .collect();
  const warehouse = variant.warehouseId ? await ctx.db.get(variant.warehouseId) : null;
  const fingerprint = await digest({
    cartons,
    warehouseId: variant.warehouseId ?? null,
    warehouse,
    piecesPerPack: variant.piecesPerPack,
  });
  return { variant, cartons, warehouse, fingerprint };
}
export const records = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    if (
      !Number.isInteger(a.paginationOpts.numItems) ||
      a.paginationOpts.numItems < 1 ||
      a.paginationOpts.numItems > 50
    )
      throw new CommerceError('INVALID_INPUT');
    const page = await ctx.db.query('catVariants').paginate(a.paginationOpts);
    return {
      ...page,
      page: page.page.map((row) => ({
        id: row._id,
        sku: row.supplierSku,
        name: row.louieMaeVariantName,
        piecesPerPack: row.piecesPerPack,
        availability: row.availability,
      })),
    };
  },
});
export const detail = query({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    const s = await snapshot(ctx, a.variantId);
    const warehouses = await ctx.db
      .query('catWarehouses')
      .withIndex('by_supplier', (q) => q.eq('supplierId', s.variant.supplierId))
      .take(101);
    if (warehouses.length > 100)
      throw new CommerceError('INVALID_INPUT', 'Warehouse list requires scoped pagination');
    const history = await ctx.db
      .query('catSourceObservations')
      .withIndex('by_variant_field_observed', (q) =>
        q.eq('variantId', a.variantId).eq('field', 'shipping_evidence')
      )
      .order('desc')
      .take(20);
    return {
      variant: {
        id: s.variant._id,
        supplierId: s.variant.supplierId,
        sku: s.variant.supplierSku,
        piecesPerPack: s.variant.piecesPerPack,
      },
      cartons: s.cartons,
      warehouse: s.warehouse,
      fingerprint: s.fingerprint,
      warehouses,
      canApprove: actor.approver,
      history,
    };
  },
});
const method = v.union(v.literal('ground'), v.literal('ltl'), v.literal('unknown'));
const carton = v.object({
  count: v.number(),
  length: v.string(),
  width: v.string(),
  height: v.string(),
  weight: v.string(),
  dimensionsUnit: v.union(v.literal('in'), v.literal('mm')),
  weightUnit: v.union(v.literal('lb'), v.literal('g')),
  supplierMethod: method,
});
function evidenceTime(evidence: string, observedAt: number) {
  if (
    !evidence.trim() ||
    evidence.length > 1000 ||
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0 ||
    observedAt > Date.now()
  )
    throw new CommerceError(
      'INVALID_INPUT',
      'Use a source reference and its actual past observation time'
    );
}
async function retry(ctx: MutationCtx, actor: string, key: string, args: unknown) {
  if (!/^[\w-]{8,80}$/.test(key)) throw new CommerceError('INVALID_INPUT');
  const id = `shipping-evidence:${await digest(actor)}:${key}`;
  const hash = await digest(args);
  const old = await ctx.db
    .query('sysIdempotencyKeys')
    .withIndex('by_key', (q) => q.eq('key', id))
    .first();
  if (old && old.scope !== hash)
    throw new CommerceError('INVALID_INPUT', 'Retry differs from saved evidence');
  return { id, hash, result: old?.resultRef };
}
export const saveCartons = mutation({
  args: {
    variantId: v.id('catVariants'),
    expectedFingerprint: v.string(),
    requestKey: v.string(),
    warehouseId: v.union(v.id('catWarehouses'), v.null()),
    cartons: v.array(carton),
    evidence: v.string(),
    observedAt: v.number(),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'operations');
    evidenceTime(a.evidence, a.observedAt);
    if (!a.note.trim() || a.note.length > 1000)
      throw new CommerceError('INVALID_INPUT', 'Explain the shipping evidence change');
    const normalized = normalizeCartons(a.cartons);
    const key = await retry(ctx, actor.email, a.requestKey, a);
    if (key.result) return key.result;
    const s = await snapshot(ctx, a.variantId);
    if (a.expectedFingerprint !== s.fingerprint)
      throw new CommerceError(
        'INVALID_INPUT',
        'Shipping evidence changed. Reload and reconcile your edits.'
      );
    const warehouse = a.warehouseId ? await ctx.db.get(a.warehouseId) : null;
    if (
      a.warehouseId &&
      (!warehouse ||
        warehouse.supplierId !== s.variant.supplierId ||
        !warehouseCurrent(warehouse, Date.now()))
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Choose a current documented warehouse for this supplier'
      );
    const now = Date.now();
    const observationId = await ctx.db.insert('catSourceObservations', {
      supplierId: s.variant.supplierId,
      variantId: s.variant._id,
      supplierSku: s.variant.supplierSku,
      field: 'shipping_evidence',
      extractedValue: stableStringify({
        normalizationVersion: 'carton-evidence-v1-ceil-mm-g',
        raw: a.cartons,
        normalized,
        warehouseId: a.warehouseId,
      }),
      sourceFile: a.evidence.trim(),
      observedAt: a.observedAt,
      contentHash: key.hash,
      verifier: actor.email,
      confidence: 'confirmed',
      createdAt: now,
    });
    // catCartons is the current projection. Prior facts remain in source observations and audit.
    for (const row of s.cartons) await ctx.db.delete(row._id);
    for (const row of normalized)
      await ctx.db.insert('catCartons', {
        ...row,
        variantId: s.variant._id,
        sourceObservationId: observationId,
        createdAt: now,
      });
    await ctx.db.patch(s.variant._id, { warehouseId: a.warehouseId ?? undefined, updatedAt: now });
    await openHold(
      ctx,
      s.variant._id,
      'MANUAL',
      'Shipping evidence changed; delivery and economics requalification required.',
      actor.email
    );
    if (
      s.cartons.map((c) => c.supplierMethod).join() !==
      normalized.map((c) => c.supplierMethod).join()
    )
      await openHold(
        ctx,
        s.variant._id,
        'METHOD_CHANGED',
        'Supplier routing changed; review Ground/LTL eligibility.',
        actor.email
      );
    await openReview(ctx, 'shipping_evidence_changed', 'catVariants', s.variant._id, a.note.trim());
    await audit(ctx, {
      actor: actor.email,
      action: 'shipping.evidence',
      entityTable: 'catVariants',
      entityId: s.variant._id,
      before: { cartons: s.cartons, warehouse: s.warehouse },
      after: { cartons: normalized, warehouse, observationId },
      reason: a.note.trim(),
      requestId: a.requestKey,
    });
    await ctx.db.insert('sysIdempotencyKeys', {
      key: key.id,
      scope: key.hash,
      resultRef: observationId,
      createdAt: now,
    });
    return observationId;
  },
});

export const saveWarehouse = mutation({
  args: {
    supplierId: v.id('catSuppliers'),
    warehouseId: v.union(v.id('catWarehouses'), v.null()),
    expectedUpdatedAt: v.union(v.number(), v.null()),
    requestKey: v.string(),
    code: v.string(),
    originZip: v.string(),
    state: v.string(),
    active: v.boolean(),
    evidence: v.string(),
    observedAt: v.number(),
    validUntil: v.number(),
    timezone: v.string(),
    cutoffLocal: v.string(),
    services: v.array(v.union(v.literal('ground'), v.literal('ltl'))),
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'approver');
    evidenceTime(a.evidence, a.observedAt);
    const key = await retry(ctx, actor.email, a.requestKey, a);
    if (key.result) return key.result as Id<'catWarehouses'>;
    const region = zipRegion(a.originZip);
    if (
      !/^[\w-]{1,60}$/.test(a.code) ||
      !/^\d{5}$/.test(a.originZip) ||
      !US_STATES.has(a.state) ||
      !['CONUS', 'AK', 'HI'].includes(region ?? '') ||
      (region === 'AK' || region === 'HI'
        ? a.state !== region
        : a.state === 'AK' || a.state === 'HI')
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Use a US warehouse code, state and ZIP verified against the source'
      );
    if (
      !Number.isSafeInteger(a.validUntil) ||
      (a.active && a.validUntil <= Date.now()) ||
      a.validUntil <= a.observedAt ||
      a.validUntil > Date.now() + 366 * 86400000 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.cutoffLocal) ||
      !a.services.length ||
      new Set(a.services).size !== a.services.length ||
      a.timezone.length > 80
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Confirm a validity period within one year, dispatch cutoff, timezone and distinct services'
      );
    try {
      new globalThis.Intl.DateTimeFormat('en-US', { timeZone: a.timezone });
    } catch {
      throw new CommerceError('INVALID_INPUT', 'Use an IANA timezone');
    }
    if (!(await ctx.db.get(a.supplierId))) throw new CommerceError('INVALID_INPUT');
    const old = a.warehouseId ? await ctx.db.get(a.warehouseId) : null;
    if (
      (a.warehouseId && (!old || old.supplierId !== a.supplierId)) ||
      (old?.updatedAt ?? null) !== a.expectedUpdatedAt
    )
      throw new CommerceError('INVALID_INPUT', 'Warehouse changed. Reload before saving.');
    const duplicate = await ctx.db
      .query('catWarehouses')
      .withIndex('by_supplier', (q) => q.eq('supplierId', a.supplierId).eq('code', a.code))
      .take(2);
    if (duplicate.some((w) => w._id !== a.warehouseId))
      throw new CommerceError('INVALID_INPUT', 'Warehouse code already exists');
    const now = Date.now();
    const value = {
      supplierId: a.supplierId,
      code: a.code,
      originZip: a.originZip,
      state: a.state,
      active: a.active,
      evidenceRef: a.evidence.trim(),
      verifiedAt: a.observedAt,
      validUntil: a.validUntil,
      timezone: a.timezone,
      cutoffLocal: a.cutoffLocal,
      services: a.services,
      updatedAt: Math.max(now, (old?.updatedAt ?? 0) + 1),
    };
    let id = a.warehouseId;
    if (id) await ctx.db.patch(id, value);
    else id = await ctx.db.insert('catWarehouses', value);
    await audit(ctx, {
      actor: actor.email,
      action: 'warehouse.evidence',
      entityTable: 'catWarehouses',
      entityId: id,
      before: old,
      after: value,
      reason: a.evidence.trim(),
      requestId: a.requestKey,
    });
    await ctx.db.insert('sysIdempotencyKeys', {
      key: key.id,
      scope: key.hash,
      resultRef: id,
      createdAt: now,
    });
    return id;
  },
});
