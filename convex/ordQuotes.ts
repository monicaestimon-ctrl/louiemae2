// Versioned manual quotes (spec S20, v2 §12, §18). A quote version holds exact variants, packs,
// address, service, discounts, tax, expiry and terms. Accepting freezes it; any change creates a
// new version that needs acceptance again. Trade prices must still pass MAP, policy and margin.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireDeliveryRole } from './dlvAccess';
import { audit } from './sysCore';
import { assertLineMap, assertLineMechanism } from './catPolicies';
import { computeScenarios } from './catPricing';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { addressArg } from './dlvEstimates';
import { assertSellable } from './catCore';
import { checkPackQuantity } from '../lib/catUnits';
import { assertRequestRevisable } from './dlvQuoteLifecycle';

const quoteLine = v.object({
  productId: v.id('commerceProducts'),
  variantId: v.string(),
  packs: v.number(),
  unitPackMinor: v.number(),
  discountMinor: v.number(),
});
export const quoteFreight = v.object({
  supplierCode: v.string(),
  originZip: v.string(),
  freightMinor: v.number(),
  supplierFeeMinor: v.number(),
  evidence: v.string(),
});

/** Policy checks for each Zuo line of a quote; other providers keep their existing review. */
export async function checkQuoteLines(
  ctx: MutationCtx,
  lines: Doc<'ordQuoteVersions'>['lines'],
  channel: 'retail' | 'house'
) {
  const notes: string[] = [];
  let map = true;
  let margin = true;
  let policy = true;
  for (const l of lines) {
    const product = await ctx.db.get(l.productId);
    if (!product) throw new CommerceError('INVALID_INPUT', 'Product not found');
    if (
      !Number.isSafeInteger(l.packs) ||
      l.packs < 1 ||
      l.packs > 10000 ||
      !Number.isSafeInteger(l.unitPackMinor) ||
      l.unitPackMinor <= 0 ||
      !Number.isSafeInteger(l.discountMinor) ||
      l.discountMinor < 0 ||
      l.discountMinor >= l.unitPackMinor * l.packs
    )
      throw new CommerceError('INVALID_INPUT', 'Invalid quote line');
    if (product.provider !== 'zuo') continue;
    const vid = ctx.db.normalizeId('catVariants', l.variantId);
    const cv = vid ? await ctx.db.get(vid) : null;
    if (!cv || cv.productId !== l.productId)
      throw new CommerceError('INVALID_INPUT', 'Variant not found');
    checkPackQuantity(cv, l.packs);
    await assertSellable(ctx, cv._id, 'purchase');
    const netPack = l.unitPackMinor - Math.ceil(l.discountMinor / l.packs);
    try {
      await assertLineMap(ctx, cv._id, netPack);
    } catch (e) {
      map = false;
      notes.push(`${cv.supplierSku}: ${commerceErrorData(e)?.detail ?? 'MAP'}`);
    }
    if (l.discountMinor > 0)
      try {
        await assertLineMechanism(ctx, cv._id, 'project');
      } catch {
        policy = false;
        notes.push(`${cv.supplierSku}: extra discounts are not authorized for this supplier`);
      }
    try {
      const s = await computeScenarios(ctx, cv);
      if (netPack < (channel === 'retail' ? s.minimumRetailMinor : s.minimumTradeMinor)) {
        margin = false;
        notes.push(`${cv.supplierSku}: below the approved channel minimum`);
      }
    } catch (e) {
      margin = false;
      notes.push(`${cv.supplierSku}: ${commerceErrorData(e)?.detail ?? 'economics unavailable'}`);
    }
  }
  return { map, margin, policy, notes };
}

/** Saves a new quote version for a project. Earlier versions are superseded, never edited. */
export const saveVersion = mutation({
  args: {
    projectId: v.id('commerceProjects'),
    lines: v.array(quoteLine),
    address: v.optional(addressArg),
    service: v.string(),
    deliveryMinor: v.number(),
    taxMinor: v.number(),
    taxEvidence: v.optional(v.string()),
    validDays: v.number(),
    terms: v.string(),
    freight: v.optional(v.array(quoteFreight)),
    fixedPaymentMinor: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'operations');
    if (
      !a.lines.length ||
      a.lines.length > 100 ||
      new Set(a.lines.map((l) => l.variantId)).size !== a.lines.length
    )
      throw new CommerceError('INVALID_INPUT', 'Add 1–100 distinct lines');
    const project = await ctx.db.get(a.projectId);
    if (!project) throw new CommerceError('INVALID_INPUT');
    const deliveryRequest = await assertRequestRevisable(ctx, a.projectId);
    if (!Number.isSafeInteger(a.validDays) || a.validDays < 1 || a.validDays > 30)
      throw new CommerceError('INVALID_INPUT', 'Quotes are valid for 1–30 days');
    if (
      ![a.deliveryMinor, a.taxMinor].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !a.terms.trim() ||
      a.terms.length > 10000 ||
      !a.service.trim() ||
      a.service.length > 80
    )
      throw new CommerceError('INVALID_INPUT');
    if (a.taxEvidence !== undefined && (!a.taxEvidence.trim() || a.taxEvidence.length > 2000))
      throw new CommerceError('INVALID_INPUT', 'Provide reviewed tax evidence');
    const checks = await checkQuoteLines(ctx, a.lines, project.channel);
    if (a.freight) {
      if (
        a.freight.length > 100 ||
        new Set(a.freight.map((f) => `${f.supplierCode}:${f.originZip}`)).size !== a.freight.length
      )
        throw new CommerceError('INVALID_INPUT');
      for (const f of a.freight)
        if (
          ![f.freightMinor, f.supplierFeeMinor].every((n) => Number.isSafeInteger(n) && n >= 0) ||
          !f.evidence.trim() ||
          f.evidence.length > 2000 ||
          !/^\d{5}$/.test(f.originZip)
        )
          throw new CommerceError('INVALID_INPUT');
    }
    if (
      a.fixedPaymentMinor !== undefined &&
      (!Number.isSafeInteger(a.fixedPaymentMinor) || a.fixedPaymentMinor < 0)
    )
      throw new CommerceError('INVALID_INPUT');
    const prior = await ctx.db
      .query('ordQuoteVersions')
      .withIndex('by_project_version', (q) => q.eq('projectId', a.projectId))
      .order('desc')
      .first();
    // Drafts and unaccepted sent versions are superseded; an accepted version stays frozen as accepted.
    if (prior && (prior.status === 'draft' || prior.status === 'sent'))
      await ctx.db.patch(prior._id, { status: 'superseded' });
    const now = Date.now();
    const id = await ctx.db.insert('ordQuoteVersions', {
      projectId: a.projectId,
      ...(a.freight ? { freight: a.freight } : {}),
      ...(a.fixedPaymentMinor !== undefined ? { fixedPaymentMinor: a.fixedPaymentMinor } : {}),
      version: (prior?.version ?? 0) + 1,
      lines: a.lines,
      ...(a.address ? { address: a.address } : {}),
      service: a.service,
      deliveryMinor: a.deliveryMinor,
      taxMinor: a.taxMinor,
      ...(a.taxEvidence ? { taxEvidence: a.taxEvidence } : {}),
      expiresAt: now + a.validDays * 86_400_000,
      terms: a.terms,
      status: 'draft',
      checks,
      reservesInventory: false,
      createdAt: now,
    });
    if (deliveryRequest)
      await ctx.db.patch(deliveryRequest._id, {
        quoteVersionId: id,
        quoteExpiresAt: now + a.validDays * 86_400_000,
        status: 'ready_for_review',
        updatedAt: now,
      });
    await audit(ctx, {
      actor: admin.email,
      action: 'quote.version',
      entityTable: 'ordQuoteVersions',
      entityId: id,
      after: { version: (prior?.version ?? 0) + 1, checks },
    });
    return { id, checks };
  },
});

export const markSent = mutation({
  args: { versionId: v.id('ordQuoteVersions') },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    const q = await ctx.db.get(a.versionId);
    if (!q || q.status !== 'draft')
      throw new CommerceError('INVALID_INPUT', 'Only a draft can be sent');
    const project = await ctx.db.get(q.projectId);
    if (!project || q.expiresAt <= Date.now()) throw new CommerceError('QUOTE_EXPIRED');
    const request = await assertRequestRevisable(ctx, q.projectId);
    if (request && request.quoteVersionId !== q._id) throw new CommerceError('QUOTE_EXPIRED');
    const checks = await checkQuoteLines(ctx, q.lines, project.channel);
    if (!checks.map || !checks.margin || !checks.policy)
      throw new CommerceError(
        'MAP_POLICY_REVIEW',
        checks.notes.join('; '),
        'This quote needs review before it can be sent.'
      );
    if (q.freight) {
      const { computeManualQuote } = await import('./dlvManual');
      await computeManualQuote(ctx, q);
    }
    await ctx.db.patch(q._id, { status: 'sent' });
    await audit(ctx, {
      actor: admin.email,
      action: 'quote.sent',
      entityTable: 'ordQuoteVersions',
      entityId: q._id,
    });
  },
});

/** Records the customer's acceptance of one exact, unexpired version. Accepted versions are immutable. */
export const accept = mutation({
  args: { versionId: v.id('ordQuoteVersions'), acceptedBy: v.string(), evidence: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireDeliveryRole(ctx, 'approver');
    if (!a.acceptedBy.trim() || !a.evidence.trim() || a.evidence.length > 2000)
      throw new CommerceError(
        'INVALID_INPUT',
        'Offline acceptance requires customer consent evidence'
      );
    const q = await ctx.db.get(a.versionId);
    if (!q || q.status !== 'sent')
      throw new CommerceError('INVALID_INPUT', 'Only a sent quote can be accepted');
    if (q.expiresAt <= Date.now()) throw new CommerceError('QUOTE_EXPIRED');
    const request = await ctx.db
      .query('dlvQuoteRequests')
      .withIndex('by_project', (i) => i.eq('projectId', q.projectId))
      .unique();
    if (request && (request.status !== 'sent' || request.quoteVersionId !== q._id))
      throw new CommerceError('QUOTE_EXPIRED');
    const project = await ctx.db.get(q.projectId);
    if (!project) throw new CommerceError('INVALID_INPUT');
    const checks = await checkQuoteLines(ctx, q.lines, project.channel);
    if (!checks.map || !checks.margin || !checks.policy)
      throw new CommerceError('COST_REVIEW_REQUIRED');
    if (request) {
      const { computeManualQuote } = await import('./dlvManual');
      await computeManualQuote(ctx, q);
      await ctx.db.patch(request._id, { status: 'accepted', updatedAt: Date.now() });
    }
    await ctx.db.patch(q._id, {
      status: 'accepted',
      acceptedAt: Date.now(),
      acceptedBy: a.acceptedBy.slice(0, 200),
    });
    await audit(ctx, {
      actor: admin.email,
      action: 'quote.accept',
      entityTable: 'ordQuoteVersions',
      entityId: q._id,
      reason: `${a.acceptedBy}: ${a.evidence}`,
    });
  },
});

export const versions = query({
  args: { projectId: v.id('commerceProjects') },
  handler: async (ctx, a) => {
    await requireDeliveryRole(ctx, 'operations');
    return ctx.db
      .query('ordQuoteVersions')
      .withIndex('by_project_version', (q) => q.eq('projectId', a.projectId))
      .order('desc')
      .take(50);
  },
});

export type QuoteVersionId = Id<'ordQuoteVersions'>;
