// Team tools for the partner program (spec section 10): commission exclusions, each partner's
// ledger, manual adjustments and a CSV export. Admin only.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { isPartner, profileOf } from './holmAccess';

const DAY = 864e5;

// ---------- exclusions ----------
export const exclusions = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const rows = await ctx.db.query('holmCommissionExclusions').take(500);
    return rows.map((r) => ({ id: r._id, kind: r.kind, label: r.label, reason: r.reason, by: r.by, at: r.at }));
  },
});

/** Stop a product, or every product in a category, from earning commission from now on. */
export const addExclusion = mutation({
  args: { kind: v.union(v.literal('product'), v.literal('category')), value: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const reason = a.reason.trim().slice(0, 200);
    if (!reason) throw new Error('Add a reason for the exclusion.');
    let value = a.value.trim();
    let label = value;
    if (a.kind === 'product') {
      const id = ctx.db.normalizeId('commerceProducts', value);
      const product = id ? await ctx.db.get(id) : null;
      if (!product) throw new Error('Product not found. Use its id from the catalog.');
      const listing = await ctx.db.query('commerceListings').withIndex('by_product_channel', (q) => q.eq('productId', product._id)).first();
      value = product._id;
      label = listing?.snapshot.name || product.sourceKey;
    } else {
      value = value.toLowerCase().slice(0, 60);
      if (value.length < 3) throw new Error('Enter at least three letters of the category.');
      label = value;
    }
    const existing = await ctx.db.query('holmCommissionExclusions').withIndex('by_kind_value', (q) => q.eq('kind', a.kind).eq('value', value)).first();
    if (existing) return existing._id;
    return ctx.db.insert('holmCommissionExclusions', { kind: a.kind, value, label, reason, by: admin.email, at: Date.now() });
  },
});

export const removeExclusion = mutation({
  args: { id: v.id('holmCommissionExclusions') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    await ctx.db.delete(a.id);
  },
});

// ---------- ledger and adjustments ----------
/** One partner's commission ledger, newest first. */
export const ledger = query({
  args: { userId: v.id('users') },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const rows = await ctx.db.query('holmCommissions').withIndex('by_partner', (q) => q.eq('partnerId', a.userId)).order('desc').take(200);
    const payouts = await ctx.db.query('holmPayouts').withIndex('by_partner', (q) => q.eq('partnerId', a.userId)).order('desc').take(60);
    return {
      rows: rows.map((c) => ({
        id: c._id,
        createdAt: c.createdAt,
        source: c.source ?? 'house_quote',
        order: c.stripeSessionId ?? (c.commerceProjectId ? String(c.commerceProjectId).slice(-8).toUpperCase() : null),
        baseCents: c.baseCents,
        rateBps: c.rateBps,
        amountCents: c.amountCents,
        status: c.status,
        channel: c.channel ?? null,
        note: c.note ?? null,
      })),
      payouts: payouts.map((p) => ({
        id: p._id,
        paidAt: p.paidAt,
        amountCents: p.amountCents,
        method: p.method ?? 'manual',
        status: p.status ?? 'paid',
        reference: p.reference,
        // A Stripe transfer opens in the Stripe dashboard.
        url: p.method === 'stripe' && p.reference.startsWith('tr_') ? `https://dashboard.stripe.com/connect/transfers/${p.reference}` : null,
        error: p.error ?? null,
      })),
    };
  },
});

/** A manual correction, with a required note. It goes on the partner's next payout. */
export const adjust = mutation({
  args: { userId: v.id('users'), amountCents: v.number(), note: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const p = await profileOf(ctx, a.userId);
    if (!p || !isPartner(p)) throw new Error('Partner not found.');
    const note = a.note.trim().slice(0, 200);
    if (!note) throw new Error('Add a note explaining the adjustment.');
    if (!Number.isSafeInteger(a.amountCents) || a.amountCents === 0 || Math.abs(a.amountCents) > 1_000_000)
      throw new Error('Enter an amount between −$10,000 and $10,000.');
    const now = Date.now();
    return ctx.db.insert('holmCommissions', {
      partnerId: a.userId,
      source: 'adjustment',
      baseCents: 0,
      rateBps: 0,
      amountCents: a.amountCents,
      status: 'cleared',
      clearsAt: now,
      createdAt: now,
      note: `${note} (by ${admin.email})`,
    });
  },
});

/** Every commission row from the last 12 months, for the CSV export. */
export const commissionsCsv = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const since = Date.now() - 365 * DAY;
    const partners = await ctx.db.query('holmProfiles').withIndex('by_partner_status', (q) => q.eq('partnerStatus', 'active')).take(500);
    const out: (string | number)[][] = [['Date', 'Partner', 'Code', 'Source', 'Order value', 'Rate %', 'Commission', 'Status', 'Channel', 'Note']];
    for (const p of partners) {
      const rows = await ctx.db
        .query('holmCommissions')
        .withIndex('by_partner', (q) => q.eq('partnerId', p.userId).gte('createdAt', since))
        .take(2000);
      for (const c of rows)
        out.push([
          new Date(c.createdAt).toISOString().slice(0, 10),
          p.businessName || p.displayName,
          p.refCode ?? '',
          c.source ?? 'house_quote',
          (c.baseCents / 100).toFixed(2),
          (c.rateBps / 100).toFixed(2),
          (c.amountCents / 100).toFixed(2),
          c.status,
          c.channel ?? '',
          c.note ?? '',
        ]);
    }
    return out;
  },
});
