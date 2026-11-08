// Versioned manual quotes (spec S20, v2 §12, §18). A quote version holds exact variants, packs,
// address, service, discounts, tax, expiry and terms. Accepting freezes it; any change creates a
// new version that needs acceptance again. Trade prices must still pass MAP, policy and margin.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit } from './sysCore';
import { assertLineMap, assertLineMechanism } from './catPolicies';
import { computeScenarios } from './catPricing';
import { CommerceError, commerceErrorData } from '../lib/errors';
import { addressArg } from './dlvEstimates';

const quoteLine = v.object({ productId: v.id('commerceProducts'), variantId: v.string(), packs: v.number(), unitPackMinor: v.number(), discountMinor: v.number() });

/** Policy checks for each Zuo line of a quote; other providers keep their existing review. */
async function checkLines(ctx: MutationCtx, lines: Doc<'ordQuoteVersions'>['lines']) {
  const notes: string[] = [];
  let map = true;
  let margin = true;
  let policy = true;
  for (const l of lines) {
    const product = await ctx.db.get(l.productId);
    if (!product) throw new CommerceError('INVALID_INPUT', 'Product not found');
    if (!Number.isInteger(l.packs) || l.packs < 1 || l.unitPackMinor <= 0 || l.discountMinor < 0) throw new CommerceError('INVALID_INPUT', 'Invalid quote line');
    if (product.provider !== 'zuo') continue;
    const vid = ctx.db.normalizeId('catVariants', l.variantId);
    const cv = vid ? await ctx.db.get(vid) : null;
    if (!cv) throw new CommerceError('INVALID_INPUT', 'Variant not found');
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
      if (netPack < s.minimumTradeMinor) {
        margin = false;
        notes.push(`${cv.supplierSku}: below the approved trade minimum`);
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
  args: { projectId: v.id('commerceProjects'), lines: v.array(quoteLine), address: v.optional(addressArg), service: v.string(), deliveryMinor: v.number(), taxMinor: v.number(), validDays: v.number(), terms: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    if (!a.lines.length) throw new CommerceError('INVALID_INPUT', 'Add at least one line');
    if (a.validDays < 1 || a.validDays > 30) throw new CommerceError('INVALID_INPUT', 'Quotes are valid for 1–30 days');
    const checks = await checkLines(ctx, a.lines);
    const prior = await ctx.db.query('ordQuoteVersions').withIndex('by_project_version', (q) => q.eq('projectId', a.projectId)).order('desc').first();
    // Drafts and unaccepted sent versions are superseded; an accepted version stays frozen as accepted.
    if (prior && (prior.status === 'draft' || prior.status === 'sent')) await ctx.db.patch(prior._id, { status: 'superseded' });
    const now = Date.now();
    const id = await ctx.db.insert('ordQuoteVersions', {
      projectId: a.projectId,
      version: (prior?.version ?? 0) + 1,
      lines: a.lines,
      ...(a.address ? { address: a.address } : {}),
      service: a.service,
      deliveryMinor: a.deliveryMinor,
      taxMinor: a.taxMinor,
      expiresAt: now + a.validDays * 86_400_000,
      terms: a.terms,
      status: 'draft',
      checks,
      reservesInventory: false,
      createdAt: now,
    });
    await audit(ctx, { actor: admin.email, action: 'quote.version', entityTable: 'ordQuoteVersions', entityId: id, after: { version: (prior?.version ?? 0) + 1, checks } });
    return { id, checks };
  },
});

export const markSent = mutation({
  args: { versionId: v.id('ordQuoteVersions') },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const q = await ctx.db.get(a.versionId);
    if (!q || q.status !== 'draft') throw new CommerceError('INVALID_INPUT', 'Only a draft can be sent');
    if (!q.checks.map || !q.checks.margin || !q.checks.policy) throw new CommerceError('MAP_POLICY_REVIEW', q.checks.notes.join('; '), 'This quote needs review before it can be sent.');
    await ctx.db.patch(q._id, { status: 'sent' });
    await audit(ctx, { actor: admin.email, action: 'quote.sent', entityTable: 'ordQuoteVersions', entityId: q._id });
  },
});

/** Records the customer's acceptance of one exact, unexpired version. Accepted versions are immutable. */
export const accept = mutation({
  args: { versionId: v.id('ordQuoteVersions'), acceptedBy: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const q = await ctx.db.get(a.versionId);
    if (!q || q.status !== 'sent') throw new CommerceError('INVALID_INPUT', 'Only a sent quote can be accepted');
    if (q.expiresAt <= Date.now()) {
      await ctx.db.patch(q._id, { status: 'expired' });
      throw new CommerceError('QUOTE_EXPIRED');
    }
    await ctx.db.patch(q._id, { status: 'accepted', acceptedAt: Date.now(), acceptedBy: a.acceptedBy.slice(0, 200) });
    await audit(ctx, { actor: admin.email, action: 'quote.accept', entityTable: 'ordQuoteVersions', entityId: q._id, reason: a.acceptedBy });
  },
});

export const versions = query({
  args: { projectId: v.id('commerceProjects') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    return ctx.db.query('ordQuoteVersions').withIndex('by_project_version', (q) => q.eq('projectId', a.projectId)).order('desc').take(50);
  },
});

export type QuoteVersionId = Id<'ordQuoteVersions'>;
