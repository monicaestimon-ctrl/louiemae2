// Finance evidence authoring. Evidence changes invalidate qualification, never approved prices.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { openHold } from './catCore';
import { audit, openReview } from './sysCore';
import { CommerceError } from '../lib/errors';
import { dollarsToMinor } from '../lib/decimal';
import { stableStringify } from '../lib/zuoImport';

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

export const recordCost = mutation({
  args: {
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
  },
  handler: async (ctx, a) => {
    const actor = await requireDeliveryRole(ctx, 'finance');
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
  },
});
