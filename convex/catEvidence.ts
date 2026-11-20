// Finance evidence authoring. Evidence changes invalidate qualification, never approved prices.
import { v, type ObjectType } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { digest as evidenceDigest } from './dlvSecurity';
import { normalizeCartons } from '../lib/shipping/evidence';
import type { Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { openHold } from './catCore';
import { audit, openReview } from './sysCore';
import { CommerceError } from '../lib/errors';
import { dollarsToMinor } from '../lib/decimal';
import { stableStringify } from '../lib/zuoImport';
import { stagedAllowanceClass } from '../lib/zuoStagedCatalog';
import { activeConfig } from './sysConfig';
import type { PricingAssumptions } from '../lib/config';

const expense = v.union(
  v.object({ state: v.literal('unknown') }),
  v.object({ state: v.literal('confirmed_zero') }),
  v.object({ state: v.literal('amount'), minor: v.number() })
);

export const detail = query({
  args: { variantId: v.id('catVariants') },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
    const variant = await ctx.db.get(a.variantId);
    if (!variant) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    const current = variant.currentCostRevisionId
      ? await ctx.db.get(variant.currentCostRevisionId)
      : null;
    const history = await ctx.db
      .query('catCostRevisions')
      .withIndex('by_variant_effective', (q) => q.eq('variantId', a.variantId))
      .order('desc')
      .take(20);
    return { variant, current, history, canApproveMap: actor.approver };
  },
});

const costArgs = {
    variantId: v.id('catVariants'),
    expectedRevisionId: v.union(v.id('catCostRevisions'), v.null()),
    requestKey: v.string(),
    wholesaleUsd: v.union(v.string(), v.null()),
    verified: v.boolean(),
    observedAt: v.number(),
    duties: expense,
    inbound: expense,
    fees: expense,
    map: v.union(
      v.object({ state: v.literal('unknown') }),
      v.object({ state: v.literal('not_applicable') }),
      v.object({
        state: v.literal('explicit_sku'),
        minor: v.number(),
        basis: v.union(v.literal('piece'), v.literal('pack')),
      })
    ),
    evidence: v.string(),
    note: v.string(),
};

export const recordCost = mutation({
  args: costArgs,
  handler: async (ctx, a) => saveCostEvidence(ctx, a, await requireDeliveryRole(ctx, 'finance')),
});

async function saveCostEvidence(ctx: MutationCtx, a: ObjectType<typeof costArgs>, actor: { email: string; approver: boolean }) {
    const now = Date.now();
    if (
      !/^[\w-]{8,80}$/.test(a.requestKey) ||
      !a.evidence.trim() ||
      a.evidence.length > 1000 ||
      !a.note.trim() ||
      a.note.length > 1000
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'A bounded request key, source reference and review note are required'
      );
    if (!Number.isSafeInteger(a.observedAt) || a.observedAt <= 0 || a.observedAt > now)
      throw new CommerceError('INVALID_INPUT', 'Source observation time must be in the past');
    const digest = async (value: string) =>
      Array.from(
        new Uint8Array(
          await globalThis.crypto.subtle.digest(
            'SHA-256',
            new globalThis.TextEncoder().encode(value)
          )
        ),
        (b) => b.toString(16).padStart(2, '0')
      ).join('');
    const key = `catalog-cost:${await digest(actor.email)}:${a.variantId}:${a.requestKey}`;
    const scope = stableStringify(a);
    const prior = await ctx.db
      .query('sysIdempotencyKeys')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first();
    if (prior) {
      if (prior.scope !== scope || !prior.resultRef)
        throw new CommerceError('INVALID_INPUT', 'Retry differs from the saved evidence');
      return prior.resultRef as Id<'catCostRevisions'>;
    }
    const variant = await ctx.db.get(a.variantId);
    if (!variant) throw new CommerceError('INVALID_INPUT', 'Variant not found');
    if ((variant.currentCostRevisionId ?? null) !== a.expectedRevisionId)
      throw new CommerceError(
        'INVALID_INPUT',
        'Cost evidence changed. Reload the latest revision before saving.'
      );
    const old = variant.currentCostRevisionId
      ? await ctx.db.get(variant.currentCostRevisionId)
      : null;
    // Recording an exemption is a policy decision, including renewed evidence for an old exemption.
    if (a.map.state === 'not_applicable' && !actor.approver)
      throw new CommerceError(
        'FORBIDDEN',
        'A MAP exemption requires an approver and written evidence'
      );
    let wholesaleMinor: number | null = null;
    if (a.wholesaleUsd !== null) {
      if (!/^\d{1,9}(\.\d{1,6})?$/.test(a.wholesaleUsd))
        throw new CommerceError(
          'INVALID_INPUT',
          'Use a positive USD cost with at most six decimal places'
        );
      wholesaleMinor = dollarsToMinor(a.wholesaleUsd, 'ceil');
      if (wholesaleMinor <= 0)
        throw new CommerceError(
          'INVALID_INPUT',
          'Wholesale must be positive or explicitly unknown'
        );
    }
    if (a.verified && wholesaleMinor === null)
      throw new CommerceError('INVALID_INPUT', 'Unknown wholesale cannot be verified');
    function unpack(e: typeof a.duties) {
      if (
        e.state === 'amount' &&
        (!Number.isSafeInteger(e.minor) || e.minor <= 0 || e.minor > 100_000_000)
      )
        throw new CommerceError(
          'INVALID_INPUT',
          'Expenses must be positive whole cents, confirmed zero, or unknown'
        );
      return { minor: e.state === 'amount' ? e.minor : null, zero: e.state === 'confirmed_zero' };
    }
    const duties = unpack(a.duties),
      inbound = unpack(a.inbound),
      fees = unpack(a.fees);
    if (
      a.map.state === 'explicit_sku' &&
      (!Number.isSafeInteger(a.map.minor) || a.map.minor <= 0 || a.map.minor > 100_000_000)
    )
      throw new CommerceError(
        'INVALID_INPUT',
        'Explicit MAP must be positive whole cents; zero is not an exemption'
      );
    const observationIds: Id<'catSourceObservations'>[] = [];
    for (const [field, value] of [
      ['wholesale', a.wholesaleUsd ?? 'unknown'],
      ['map', a.map.state === 'explicit_sku' ? String(a.map.minor / 100) : a.map.state],
      ['cost_expenses', stableStringify({ duties: a.duties, inbound: a.inbound, fees: a.fees })],
    ]) {
      observationIds.push(
        await ctx.db.insert('catSourceObservations', {
          supplierId: variant.supplierId,
          variantId: variant._id,
          supplierSku: variant.supplierSku,
          field,
          extractedValue: value,
          unit:
            field === 'wholesale'
              ? 'USD_per_piece'
              : field === 'map' && a.map.state === 'explicit_sku'
                ? `USD_per_${a.map.basis}`
                : 'source_state',
          sourceFile: a.evidence.trim(),
          observedAt: a.observedAt,
          contentHash: await digest(`${key}:${field}:${scope}`),
          verifier: actor.email,
          confidence: a.verified ? 'confirmed' : 'unverified',
          createdAt: now,
        })
      );
    }
    const id = await ctx.db.insert('catCostRevisions', {
      variantId: variant._id,
      wholesaleMinor,
      ...(a.wholesaleUsd !== null ? { wholesalePrecise: a.wholesaleUsd } : {}),
      currency: 'USD',
      dutiesMinor: duties.minor,
      dutiesConfirmedZero: duties.zero,
      inboundFreightMinor: inbound.minor,
      inboundConfirmedZero: inbound.zero,
      supplierFeesMinor: fees.minor,
      feesConfirmedZero: fees.zero,
      mapMinor: a.map.state === 'explicit_sku' ? a.map.minor : null,
      mapUnitBasis: a.map.state === 'explicit_sku' ? a.map.basis : 'piece',
      mapSource: a.map.state === 'explicit_sku' ? 'explicit_sku' : 'none',
      mapApplicability: a.map.state === 'explicit_sku' ? 'applies' : a.map.state,
      costSource: a.evidence.trim(),
      ...(a.verified ? { verifiedAt: a.observedAt } : {}),
      observationIds,
      createdAt: now,
      createdBy: actor.email,
      effectiveFrom: now,
      source: 'finance-evidence',
    });
    if (old) await ctx.db.patch(old._id, { effectiveTo: now });
    await ctx.db.patch(variant._id, { currentCostRevisionId: id, updatedAt: now });
    await openHold(
      ctx,
      variant._id,
      'MANUAL',
      'Cost evidence changed; requalification and explicit release review required.',
      actor.email
    );
    await openReview(
      ctx,
      'cost_evidence_changed',
      'catVariants',
      variant._id,
      `Revision ${id}; ${a.note.trim()}`
    );
    await audit(ctx, {
      actor: actor.email,
      action: 'cost.evidence',
      entityTable: 'catVariants',
      entityId: variant._id,
      before: old?._id ?? null,
      after: id,
      reason: a.note.trim(),
      requestId: a.requestKey,
    });
    await ctx.db.insert('sysIdempotencyKeys', { key, scope, resultRef: id, createdAt: now });
    return id;
}

export const supplierSourceSnapshot = internalQuery({
  args: { variantIds: v.array(v.id('catVariants')) },
  handler: async (ctx, a) => {
    if (a.variantIds.length < 1 || a.variantIds.length > 20) throw new CommerceError('INVALID_INPUT');
    return Promise.all(a.variantIds.map(async id => {
      const cv = await ctx.db.get(id);
      const supplier = cv ? await ctx.db.get(cv.supplierId) : null;
      if (!cv || supplier?.code !== 'zuo') throw new CommerceError('INVALID_INPUT');
      const cartons = await ctx.db.query('catCartons').withIndex('by_variant', q => q.eq('variantId', id)).collect();
      return { variantId: id, sku: cv.supplierSku, piecesPerPack: cv.piecesPerPack,
        costRevisionId: cv.currentCostRevisionId ?? null, cartonFingerprint: await evidenceDigest(cartons) };
    }));
  },
});

/** Deployment-admin reconciliation of a reviewed supplier file, never a publication endpoint. */
export const reconcileZuoSource = internalMutation({
  args: {
    dryRun: v.boolean(),
    sourceSha256: v.string(),
    sourceName: v.string(),
    sourceObservedAt: v.number(),
    inventorySha256: v.string(),
    inventoryObservedAt: v.number(),
    rows: v.array(v.object({
      variantId: v.id('catVariants'), sku: v.string(), piecesPerPack: v.number(), sourceRow: v.number(),
      expectedCostRevisionId: v.union(v.id('catCostRevisions'), v.null()),
      expectedCartonFingerprint: v.string(),
      wholesaleUsd: v.string(), mapPackMinor: v.union(v.number(), v.null()),
      status: v.union(v.literal('ACTIVE'), v.literal('MD'), v.literal('DISC')),
      caOnHand: v.union(v.number(), v.null()), flOnHand: v.union(v.number(), v.null()),
      cartons: v.array(v.object({ length: v.string(), width: v.string(), height: v.string(), weight: v.string(),
        supplierMethod: v.union(v.literal('ground'), v.literal('ltl')) })),
    })),
  },
  handler: async (ctx, a) => {
    const actor = { email: 'deployment-admin:zuo-source-reconciliation', approver: false };
    const now = Date.now();
    if (!/^[a-f0-9]{64}$/.test(a.sourceSha256) || !/^[a-f0-9]{64}$/.test(a.inventorySha256) ||
      !a.sourceName.trim() || a.sourceName.length > 180 || a.rows.length < 1 || a.rows.length > 20 ||
      new Set(a.rows.map(r => r.variantId)).size !== a.rows.length ||
      [a.sourceObservedAt, a.inventoryObservedAt].some(t => !Number.isSafeInteger(t) || t <= 0 || t > now))
      throw new CommerceError('INVALID_INPUT', 'Invalid source manifest');
    const results = [];
    for (const row of a.rows) {
      const cv = await ctx.db.get(row.variantId);
      const supplier = cv ? await ctx.db.get(cv.supplierId) : null;
      if (!cv || supplier?.code !== 'zuo' || cv.supplierSku !== row.sku || cv.piecesPerPack !== row.piecesPerPack ||
        !Number.isSafeInteger(row.sourceRow) || row.sourceRow < 2 ||
        (row.mapPackMinor !== null && (!Number.isSafeInteger(row.mapPackMinor) || row.mapPackMinor < 0)) ||
        [row.caOnHand, row.flOnHand].some(q => q !== null && (!Number.isSafeInteger(q) || q < 0)) ||
        !/^\d{1,9}(\.\d{1,6})?$/.test(row.wholesaleUsd) || dollarsToMinor(row.wholesaleUsd, 'ceil') <= 0)
        throw new CommerceError('INVALID_INPUT', 'Supplier SKU, pack or source value mismatch');
      const cartons = normalizeCartons(row.cartons.map(c => ({ ...c, count: 1, dimensionsUnit: 'in', weightUnit: 'lb' })));
      const scope = await evidenceDigest({ ...a, dryRun: undefined, rows: undefined, row });
      const key = `zuo-source-v1:${a.sourceSha256}:${a.inventorySha256}:${cv._id}`;
      const prior = await ctx.db.query('sysIdempotencyKeys').withIndex('by_key', q => q.eq('key', key)).first();
      if (prior) {
        if (prior.scope !== scope) throw new CommerceError('INVALID_INPUT', 'Source retry differs');
        results.push({ sku: row.sku, status: 'already_applied' as const });
        continue;
      }
      if ((cv.currentCostRevisionId ?? null) !== row.expectedCostRevisionId)
        throw new CommerceError('INVALID_INPUT', 'Current cost changed; reconcile again');
      const old = cv.currentCostRevisionId ? await ctx.db.get(cv.currentCostRevisionId) : null;
      const oldCartons = await ctx.db.query('catCartons').withIndex('by_variant', q => q.eq('variantId', cv._id)).collect();
      if (await evidenceDigest(oldCartons) !== row.expectedCartonFingerprint)
        throw new CommerceError('INVALID_INPUT', 'Shipping evidence changed; reconcile again');
      if (a.dryRun) {
        results.push({ sku: row.sku, status: 'ready' as const });
        continue;
      }
      // Unknown expenses stay unknown, and source refresh cannot approve exemptions or prices.
      const expenseState = (minor: number | null | undefined, zero: boolean | undefined) =>
        minor !== null && minor !== undefined && minor > 0 ? { state: 'amount' as const, minor } :
          zero || minor === 0 ? { state: 'confirmed_zero' as const } : { state: 'unknown' as const };
      const source = `${a.sourceName}; SHA256 ${a.sourceSha256}; row ${row.sourceRow}; SKU ${row.sku}`;
      const costId = await saveCostEvidence(ctx, {
        variantId: cv._id, expectedRevisionId: row.expectedCostRevisionId, requestKey: `source-${scope.slice(0,64)}`,
        wholesaleUsd: row.wholesaleUsd, verified: true, observedAt: a.sourceObservedAt,
        duties: expenseState(old?.dutiesMinor, old?.dutiesConfirmedZero),
        inbound: expenseState(old?.inboundFreightMinor, old?.inboundConfirmedZero),
        fees: expenseState(old?.supplierFeesMinor, old?.feesConfirmedZero),
        map: row.mapPackMinor !== null && row.mapPackMinor > 0 ? { state: 'explicit_sku', minor: row.mapPackMinor, basis: 'pack' } : { state: 'unknown' },
        evidence: source, note: 'Supplier file reconciliation. Existing prices and unresolved expenses retained; requalification required.',
      }, actor);
      const shippingId = await ctx.db.insert('catSourceObservations', {
        supplierId: cv.supplierId, variantId: cv._id, supplierSku: row.sku, field: 'shipping_evidence',
        extractedValue: stableStringify({ raw: row.cartons, normalized: cartons, previousCartons: oldCartons, sourceStatus: row.status, rawMapPackMinor: row.mapPackMinor }),
        sourceFile: source, observedAt: a.sourceObservedAt, contentHash: scope, verifier: actor.email, confidence: 'confirmed', createdAt: now,
      });
      for (const carton of oldCartons) await ctx.db.delete(carton._id);
      for (const carton of cartons) await ctx.db.insert('catCartons', { ...carton, variantId: cv._id, sourceObservationId: shippingId, createdAt: now });
      await ctx.db.insert('catSourceObservations', {
        supplierId: cv.supplierId, variantId: cv._id, supplierSku: row.sku, field: 'supplier_inventory_on_hand',
        extractedValue: stableStringify({ CA_QTY: row.caOnHand, FL_QTY: row.flOnHand, kind: 'on_hand', unitBasis: 'unknown', availableToSellConfirmed: false }),
        sourceFile: `ZUO_Daily_Inventory.csv; SHA256 ${a.inventorySha256}`, observedAt: a.inventoryObservedAt,
        contentHash: scope, verifier: actor.email, confidence: 'confirmed', createdAt: now,
      });
      await openHold(ctx, cv._id, 'STOCK_UNVERIFIED', 'On-hand source recorded; quantity basis and available-to-sell treatment still require confirmation.', actor.email);
      if (oldCartons.map(c => c.supplierMethod).join() !== cartons.map(c => c.supplierMethod).join())
        await openHold(ctx, cv._id, 'METHOD_CHANGED', 'Supplier shipping method changed; review current routing.', actor.email);
      if (row.status === 'DISC') await ctx.db.patch(cv._id, { availability: 'discontinued', updatedAt: now });
      await audit(ctx, { actor: actor.email, action: 'supplier.source_reconciled', entityTable: 'catVariants', entityId: cv._id,
        before: { costRevisionId: old?._id ?? null }, after: { costRevisionId: costId, shippingId, status: row.status },
        reason: source, requestId: key });
      await ctx.db.insert('sysIdempotencyKeys', { key, scope, resultRef: costId, createdAt: now });
      results.push({ sku: row.sku, status: 'applied' as const });
    }
    return { dryRun: a.dryRun, results };
  },
});

/** Restore the approved packet allowance lost by the original staged migration.
 * Never changes prices, carrier methods, stock, commission eligibility or publication. */
export const restoreStagedAllowances = internalMutation({
  args: { dryRun: v.boolean(), rows: v.array(v.object({ variantId: v.id('catVariants'),
    expectedSizeClass: v.string(), sourceSha256: v.string() })) },
  handler: async (ctx, a) => {
    if (!a.rows.length || a.rows.length > 20 || new Set(a.rows.map(r => r.variantId)).size !== a.rows.length)
      throw new CommerceError('INVALID_INPUT', 'Choose 1–20 distinct variants');
    const assumptions = await activeConfig<PricingAssumptions>(ctx, 'pricingAssumptions', 'zuo-pricing-assumptions');
    const results = [];
    for (const row of a.rows) {
      const cv = await ctx.db.get(row.variantId);
      const product = cv ? await ctx.db.get(cv.productId) : null;
      const source = product?.zuoStaging;
      if (!cv || !product || product.provider !== 'zuo' || !source || source.sku !== cv.supplierSku
        || source.pack !== cv.piecesPerPack || source.unitsPerSellUnit !== cv.piecesPerPack
        || !/^[a-f0-9]{64}$/.test(row.sourceSha256) || await evidenceDigest(source.sourceEvidence) !== row.sourceSha256)
        throw new CommerceError('INVALID_INPUT', 'Preserved source identity changed');
      const allowance = stagedAllowanceClass(JSON.parse(source.sourceEvidence));
      if (!allowance || assumptions.value.allowanceBySize[allowance.sizeClass] !== allowance.allowanceMinor)
        throw new CommerceError('INVALID_INPUT', 'Packet allowance does not match approved pricing assumptions');
      const current = cv.sizeClass ?? 'UNKNOWN';
      const already = current === allowance.sizeClass;
      if (!already && (current !== 'UNKNOWN' || current !== row.expectedSizeClass))
        throw new CommerceError('INVALID_INPUT', 'Existing reviewed allowance must not be overwritten');
      if (!a.dryRun && !already) {
        await ctx.db.patch(cv._id, { sizeClass: allowance.sizeClass, updatedAt: Date.now() });
        await openHold(ctx, cv._id, 'MANUAL', 'Restored packet delivery allowance; requalify economics before publication', 'system:staged-allowance-reconciliation');
        await audit(ctx, { actor: 'system:staged-allowance-reconciliation', action: 'pricing.restore_allowance',
          entityTable: 'catVariants', entityId: cv._id, before: current, after: allowance,
          reason: `Preserved source SHA-256 ${row.sourceSha256}; pricing assumptions v${assumptions.version}` });
      }
      results.push({ variantId: cv._id, sku: cv.supplierSku, ...allowance, status: already ? 'already_restored' : a.dryRun ? 'ready' : 'restored' });
    }
    return { results };
  },
});
