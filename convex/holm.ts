import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { listingReady } from './commerceReadiness';
import { address } from './commerceTables';
import { clientShow, holmBusinessType } from './holmTables';
import { checkQuantity, totalLines } from '../lib/commerce';
import { deliveryCents, freightFor } from '../lib/holmDelivery';
import { launchPrice, retailDelivery } from '../lib/retailLaunch';
import {
  HOLM_RULES,
  applyProjectPricing,
  clientSellCents,
  floorCents,
  tradeCents,
} from '../lib/holmPricing';

type Ctx = QueryCtx | MutationCtx;

// ---------- who is viewing ----------
import { viewer, isVerified, isAdmin, isPartner, requireUser } from './holmAccess';
import { markReferralVerified, recordReferral, resolveAttribution } from './holmPartners';

export const me = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return { signedIn: false as const };
    const admin = await isAdmin(ctx);
    return {
      signedIn: true as const,
      email: me.email,
      displayName: me.profile?.displayName || me.email.split('@')[0],
      businessName: me.profile?.businessName || null,
      tradeStatus: admin ? ('approved' as const) : me.profile?.tradeStatus || ('none' as const),
      verified: admin || isVerified(me.profile),
      partner: isPartner(me.profile),
      admin,
    };
  },
});

/** Create the House profile on first sign-in. */
export const ensureProfile = mutation({
  args: { ref: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (me.profile) return me.profile._id;
    const now = Date.now();
    await recordReferral(ctx, me.userId, a.ref);
    return ctx.db.insert('holmProfiles', {
      userId: me.userId,
      displayName: me.email.split('@')[0] || 'Member',
      tradeStatus: 'none',
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------- pricing ----------
type FulfillmentVariant = NonNullable<Doc<'commerceListings'>['fulfillment']>[number];

/**
 * Landed cost of one unit in USD cents: supplier cost, or CJ's landed cost when higher.
 * Ashcroft bills freight separately, so its freight allowance is part of the landed cost.
 */
function costCents(
  product: Doc<'commerceProducts'>,
  variant: FulfillmentVariant,
  linked: Doc<'products'> | null,
  freight: number
) {
  const supplier = Math.round(variant.cost * (product.draft.usdRate || 1) * 100);
  if (product.provider === 'ashcroft') return supplier > 0 ? supplier + freight : 0;
  const landed = linked?.confirmedLandedCost ?? linked?.estimatedLandedCost;
  return Math.max(supplier, landed ? Math.round(landed * 100) : 0);
}
/** Retail unit price in cents. House-only pieces fall back to the House estimate grossed up. */
function retailCents(variant: FulfillmentVariant) {
  if (variant.retail > 0) return variant.retail;
  return Math.round(variant.commercial / 0.75);
}

async function pricedListing(ctx: Ctx, listing: Doc<'commerceListings'>) {
  const product = await ctx.db.get(listing.productId);
  if (!product || !(await listingReady(ctx, product, listing))) return null;
  const linked = product.cjProductId ? await ctx.db.get(product.cjProductId) : null;
  // Ashcroft pieces use the louiemae.com price as retail: the storefront builds the freight
  // allowance into it (see storefrontListing), so trade at 25% off carries freight too.
  const store =
    product.provider === 'ashcroft'
      ? await ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) => q.eq('productId', product._id).eq('channel', 'retail'))
          .unique()
      : null;
  const named = store?.snapshot ?? listing.snapshot;
  const rate = product.provider === 'ashcroft' ? retailDelivery(named.category, named.name) : null;
  const variants = listing.snapshot.variants.flatMap((sv) => {
    const route = listing.fulfillment?.find((f) => f.id === sv.id);
    if (!route) return [];
    const base = store?.snapshot.variants.find((v) => v.id === sv.id)?.price || retailCents(route);
    if (base <= 0) return [];
    const retail = rate ? launchPrice(base, rate.freight, rate.delivery) : base;
    const byPrefix = freightFor(route.sku);
    const freight = rate ? { cents: rate.freight, known: true } : byPrefix;
    const cost = costCents(product, route, linked, freight.cents);
    return [{ ...sv, retail, cost, sku: route.sku, freightKnown: freight.known, trade: tradeCents(retail, cost), floor: floorCents(cost) }];
  });
  return variants.length ? { product, listing, variants, inStock: linked?.inStock !== false } : null;
}

// ---------- catalog ----------
export const catalog = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    const trade = (me && isVerified(me.profile)) || (me ? await isAdmin(ctx) : false);
    const listings = await ctx.db
      .query('commerceListings')
      .withIndex('by_channel_published', (q) => q.eq('channel', 'house').eq('published', true))
      .take(300);
    const out = [];
    for (const listing of listings) {
      const priced = await pricedListing(ctx, listing);
      if (!priced) continue;
      const s = listing.snapshot;
      out.push({
        id: listing.productId,
        name: s.name,
        description: s.description,
        category: s.category,
        images: s.images,
        facts: s.facts,
        inStock: priced.inStock,
        variants: priced.variants.map((x) => ({
          id: x.id,
          name: x.name,
          image: x.image,
          minimum: x.minimum,
          increment: x.increment,
          retail: x.retail,
          // Trade prices only reach verified trade accounts.
          trade: trade ? x.trade : null,
        })),
      });
    }
    return { trade, items: out };
  },
});

/** Margin after landed cost and card processing, in basis points of the price. */
function marginBps(priceCents: number, costCents: number) {
  if (priceCents <= 0) return 0;
  const processing = (priceCents * HOLM_RULES.processingBps) / 10000 + HOLM_RULES.processingCents;
  return Math.round(((priceCents - costCents - processing) / priceCents) * 10000);
}

/** Every House piece with its cost, prices and margins, flagged where pricing needs a look. */
export const adminPricing = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const listings = await ctx.db
      .query('commerceListings')
      .withIndex('by_channel_published', (q) => q.eq('channel', 'house').eq('published', true))
      .take(300);
    const deepest = Math.max(...HOLM_RULES.projectTiers.map((t) => t.bps));
    const rows = [];
    for (const listing of listings) {
      const priced = await pricedListing(ctx, listing);
      if (!priced) continue;
      for (const x of priced.variants) {
        const listedTrade = Math.round((x.retail * (10000 - HOLM_RULES.tradeDiscountBps)) / 10000);
        const project = Math.min(x.trade, Math.max(x.floor, Math.round((x.trade * (10000 - deepest)) / 10000)));
        const flags: string[] = [];
        if (x.cost <= 0) flags.push('No dealer cost: trade has no margin floor');
        if (x.cost > 0 && x.trade > listedTrade) flags.push(`Floor holds trade at ${Math.round((1 - x.trade / x.retail) * 100)}% off`);
        if (priced.product.provider === 'ashcroft' && !x.freightKnown) flags.push('Freight allowance estimated');
        if (x.cost > 0 && marginBps(project, x.cost) < HOLM_RULES.minMarginBps - 5) flags.push('Below margin floor');
        rows.push({
          productId: priced.product._id,
          name: listing.snapshot.name,
          variant: x.name,
          sku: x.sku,
          retailCents: x.retail,
          tradeCents: x.trade,
          projectCents: project,
          costCents: x.cost,
          retailMarginBps: x.cost > 0 ? marginBps(x.retail, x.cost) : null,
          tradeMarginBps: x.cost > 0 ? marginBps(x.trade, x.cost) : null,
          projectMarginBps: x.cost > 0 ? marginBps(project, x.cost) : null,
          flags,
        });
      }
    }
    return rows.sort((a, b) => b.flags.length - a.flags.length || (a.tradeMarginBps ?? -1e9) - (b.tradeMarginBps ?? -1e9));
  },
});

// ---------- trade application ----------
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const applyTrade = mutation({
  args: {
    businessType: holmBusinessType,
    businessName: v.string(),
    state: v.string(),
    ein: v.string(),
    website: v.string(),
    credential: v.string(),
    company: v.optional(v.string()),
    workEmail: v.optional(v.string()),
    taxRequested: v.boolean(),
    certificateId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    const ein = a.ein.replace(/\D/g, '');
    const name = a.businessName.trim();
    if (!name || name.length > 200) throw new Error('Enter your legal business name.');
    if (ein.length !== 9) throw new Error('An EIN has 9 digits, written 12-3456789.');
    if (!a.website.trim() || a.website.length > 300) throw new Error('Add a website or business Instagram.');
    if (a.businessType === 'pm') {
      if (!a.company?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.workEmail || ''))
        throw new Error('Add the company and a work email at that company.');
    } else if (!a.credential.trim() || a.credential.length > 500) {
      throw new Error('Add the credential for your business type.');
    }
    if (a.state.length > 60) throw new Error('Choose your state of registration.');
    const open = await ctx.db
      .query('holmTradeApplications')
      .withIndex('by_user', (q) => q.eq('userId', me.userId))
      .order('desc')
      .first();
    if (open?.status === 'pending') throw new Error('Your application is already in review.');
    const now = Date.now();
    const id = await ctx.db.insert('holmTradeApplications', {
      userId: me.userId,
      email: me.email,
      businessType: a.businessType,
      businessName: name,
      state: a.state,
      einLast4: ein.slice(-4),
      website: a.website.trim(),
      credential: a.credential.trim(),
      company: a.company?.trim() || undefined,
      workEmail: a.workEmail?.trim().toLowerCase() || undefined,
      taxRequested: a.taxRequested,
      certificateId: a.certificateId,
      status: 'pending',
      submittedAt: now,
    });
    const profile = { businessName: name, businessType: a.businessType, tradeStatus: 'pending' as const, updatedAt: now };
    if (me.profile) await ctx.db.patch(me.profile._id, profile);
    else
      await ctx.db.insert('holmProfiles', {
        userId: me.userId,
        displayName: name,
        createdAt: now,
        ...profile,
      });
    await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
      key: `trade-application:${id}`,
      to: 'owner',
      subject: `House of Louie Mae — trade application from ${name}`,
      text: `${name} applied for a trade account.\n\nBusiness type: ${a.businessType}\nState: ${a.state}\nWebsite: ${a.website}\nCredential: ${a.businessType === 'pm' ? `${a.company} · ${a.workEmail}` : a.credential}\nTax exemption requested: ${a.taxRequested ? 'yes' : 'no'}\n\nReview it at https://louiemae.com/trade#admin`,
      replyTo: me.email,
    });
    return id;
  },
});

export const myApplication = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return null;
    const a = await ctx.db
      .query('holmTradeApplications')
      .withIndex('by_user', (q) => q.eq('userId', me.userId))
      .order('desc')
      .first();
    return a ? { status: a.status, businessName: a.businessName, reviewNote: a.reviewNote ?? null, submittedAt: a.submittedAt } : null;
  },
});

export const adminApplications = query({
  args: { status: v.optional(v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'), v.literal('needs_info'))) },
  handler: async (ctx, a) => {
    await requireCjAdminIdentity(ctx);
    const rows = await ctx.db
      .query('holmTradeApplications')
      .withIndex('by_status', (q) => q.eq('status', a.status ?? 'pending'))
      .order('desc')
      .take(100);
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        certificateUrl: r.certificateId ? await ctx.storage.getUrl(r.certificateId) : null,
      }))
    );
  },
});

export const reviewApplication = mutation({
  args: {
    id: v.id('holmTradeApplications'),
    decision: v.union(v.literal('approved'), v.literal('rejected'), v.literal('needs_info')),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const app = await ctx.db.get(a.id);
    if (!app) throw new Error('Application not found.');
    const now = Date.now();
    const note = a.note?.trim().slice(0, 1000) || undefined;
    await ctx.db.patch(a.id, { status: a.decision, reviewerEmail: admin.email, reviewNote: note, decidedAt: now });
    const profile = await ctx.db
      .query('holmProfiles')
      .withIndex('by_user', (q) => q.eq('userId', app.userId))
      .unique();
    const patch = {
      tradeStatus: a.decision,
      ...(a.decision === 'approved' && app.taxRequested && app.certificateId ? { taxExempt: true } : {}),
      updatedAt: now,
    };
    if (profile) await ctx.db.patch(profile._id, patch);
    if (a.decision === 'approved') await markReferralVerified(ctx, app.userId);
    const copy = {
      approved: `Your trade account for ${app.businessName} is approved. Trade pricing is now on for every piece, and your digital trade pass is in your account.\n\nhttps://louiemae.com/trade`,
      rejected: `We weren't able to approve the trade account for ${app.businessName}.${note ? `\n\n${note}` : ''}\n\nReply to this email if anything has changed.`,
      needs_info: `We need a little more to approve the trade account for ${app.businessName}.${note ? `\n\n${note}` : ''}\n\nReply to this email with the details.`,
    }[a.decision];
    await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
      key: `trade-decision:${a.id}:${a.decision}:${now}`,
      to: app.email,
      subject: a.decision === 'approved' ? 'Your House of Louie Mae trade account is approved' : 'Your House of Louie Mae trade application',
      text: copy,
    });
  },
});

// ---------- quote requests (into the shared commerce pipeline) ----------
const quoteItem = v.object({
  productId: v.id('commerceProducts'),
  variantId: v.string(),
  quantity: v.number(),
  zone: v.string(),
});

async function priceSelection(
  ctx: MutationCtx,
  items: { productId: Id<'commerceProducts'>; variantId: string; quantity: number; zone: string }[],
  trade: boolean
) {
  if (!items.length || items.length > 50) throw new Error('Add 1–50 pieces to the project.');
  const seen = new Set<string>();
  const rows = [];
  for (const s of items) {
    const key = `${s.productId}:${s.variantId}`;
    if (seen.has(key)) throw new Error('Combine duplicate pieces into one line.');
    seen.add(key);
    const listing = await ctx.db
      .query('commerceListings')
      .withIndex('by_product_channel', (q) => q.eq('productId', s.productId).eq('channel', 'house'))
      .unique();
    const priced = listing ? await pricedListing(ctx, listing) : null;
    const variant = priced?.variants.find((x) => x.id === s.variantId);
    const route = listing?.fulfillment?.find((x) => x.id === s.variantId);
    if (!priced || !variant || !route) throw new Error('A piece is no longer available. Refresh the tray.');
    checkQuantity(s.quantity, variant);
    rows.push({ s, priced, variant, route });
  }
  const pp = trade
    ? applyProjectPricing(rows.map((r) => ({ unitCents: r.variant.trade, quantity: r.s.quantity, floorCents: r.variant.floor })))
    : null;
  const lines = rows.map((r, i) => ({
    productId: r.priced.product._id,
    variantId: r.variant.id,
    name: r.priced.listing.snapshot.name,
    variantName: r.variant.name,
    quantity: r.s.quantity,
    unitPrice: pp ? pp.units[i] : r.variant.retail,
    provider: r.priced.product.provider,
    sku: r.route.sku,
    ...(r.priced.product.cjProductId ? { cjProductId: r.priced.product.cjProductId } : {}),
    ...(r.route.cjVariantId ? { cjVariantId: r.route.cjVariantId } : {}),
    ...(r.route.cjSku ? { cjSku: r.route.cjSku } : {}),
  }));
  const retailSubtotal = rows.reduce((t, r) => t + r.variant.retail * r.s.quantity, 0);
  return {
    lines,
    zones: rows.map((r) => r.s.zone),
    retailSubtotal,
    subtotal: lines.reduce((t, l) => t + l.unitPrice * l.quantity, 0),
    projectDiscount: pp?.discountCents ?? 0,
    tierBps: pp?.bps ?? 0,
  };
}

export const requestQuote = mutation({
  args: {
    token: v.string(),
    projectName: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    business: v.string(),
    address,
    timing: v.union(v.literal('asap'), v.literal('date'), v.literal('split')),
    date: v.string(),
    receiving: v.union(v.literal('white'), v.literal('threshold'), v.literal('dock')),
    notes: v.string(),
    website: v.string(),
    items: v.array(quoteItem),
    refCode: v.optional(v.string()),
    visitorId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = await viewer(ctx);
    const email = (me?.email || a.email).trim().toLowerCase();
    if (
      a.website ||
      !/^[\w-]{20,80}$/.test(a.token) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !a.name.trim() ||
      a.name.length > 150 ||
      a.notes.length > 3000 ||
      a.phone.length > 60 ||
      a.business.length > 200 ||
      a.projectName.length > 120 ||
      a.date.length > 40 ||
      JSON.stringify(a.address).length > 2000
    )
      throw new Error('Check your contact and delivery details.');
    if (!a.address.line1.trim() || !a.address.city.trim() || !a.address.postalCode.trim())
      throw new Error('Add the delivery address.');
    const old = await ctx.db
      .query('commerceProjects')
      .withIndex('by_token', (q) => q.eq('token', a.token))
      .unique();
    if (old) {
      if (old.email !== email) throw new Error('Refresh the page and try again.');
      return { id: old._id, reference: String(old._id).slice(-8).toUpperCase() };
    }
    const recent = await ctx.db
      .query('commerceProjects')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .take(3);
    if (recent.length === 3 && recent[2].createdAt > Date.now() - 3600000)
      throw new Error('You have sent several requests. Please wait an hour before sending another.');
    const trade = !!me && (isVerified(me.profile) || (await isAdmin(ctx)));
    const priced = await priceSelection(ctx, a.items, trade);
    const delivery = deliveryCents(priced.subtotal);
    totalLines(priced.lines, delivery, 0);
    const timing = { asap: 'As soon as ready', date: `Scheduled${a.date ? ` for ${a.date}` : ''}`, split: 'Ship as available' }[a.timing];
    const receiving = { white: 'White glove', threshold: 'Threshold', dock: 'Commercial dock' }[a.receiving];
    const areas = [...new Set(priced.zones)].map((z) => `${z}: ${priced.lines.filter((_, i) => priced.zones[i] === z).map((l) => `${l.quantity} × ${l.name}`).join(', ')}`);
    const notes = [
      `Project: ${a.projectName || 'Untitled'}`,
      `Pricing: ${trade ? `verified trade${priced.tierBps ? ` with ${priced.tierBps / 100}% project pricing` : ''}` : 'retail (no verified trade account)'}`,
      `Delivery: ${timing} · ${receiving} · flat $${(delivery / 100).toFixed(2)}`,
      ...areas,
      a.notes.trim() ? `Notes: ${a.notes.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 3000);
    const now = Date.now();
    const id = await ctx.db.insert('commerceProjects', {
      token: a.token,
      channel: 'house',
      name: a.name.trim(),
      email,
      phone: a.phone,
      business: a.business,
      address: a.address,
      notes,
      requested: priced.lines,
      lines: priced.lines,
      delivery,
      tax: 0,
      revision: 1,
      status: 'requested',
      customerEmailStatus: 'queued',
      ownerEmailStatus: 'queued',
      createdAt: now,
      updatedAt: now,
    });
    // Partner commission is earned on retail-priced requests only.
    const attr = trade ? null : await resolveAttribution(ctx, a.refCode, a.visitorId, { userId: me?.userId, email });
    await ctx.db.insert('holmQuoteRequests', {
      userId: me?.userId,
      ...(attr ? { partnerId: attr.partnerId, refCode: attr.refCode, channel: attr.channel, partnerState: 'awaiting_payment' as const } : {}),
      commerceProjectId: id,
      projectName: a.projectName || 'Untitled',
      priceMode: trade ? 'trade' : 'retail',
      retailSubtotal: priced.retailSubtotal,
      subtotal: priced.subtotal,
      projectDiscount: priced.projectDiscount,
      tierBps: priced.tierBps,
      deliveryCents: delivery,
      createdAt: now,
    });
    for (const audience of ['owner', 'customer'] as const)
      await ctx.scheduler.runAfter(0, internal.commerceEmail.deliver, { id, audience, attempt: 0 });
    return { id, reference: String(id).slice(-8).toUpperCase() };
  },
});

export const myQuoteRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query('holmQuoteRequests')
      .withIndex('by_user', (q) => q.eq('userId', me.userId))
      .order('desc')
      .take(50);
    return Promise.all(
      rows.map(async (r) => {
        const p = await ctx.db.get(r.commerceProjectId);
        return {
          reference: String(r.commerceProjectId).slice(-8).toUpperCase(),
          projectName: r.projectName,
          status: p?.status ?? 'requested',
          subtotal: r.subtotal,
          projectDiscount: r.projectDiscount,
          invoiceUrl: p?.invoiceUrl ?? null,
          createdAt: r.createdAt,
        };
      })
    );
  },
});

// ---------- client quotes ----------
function slug() {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(22));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export const createClientQuote = mutation({
  args: {
    show: clientShow,
    markupBps: v.number(),
    studioName: v.optional(v.string()),
    replyEmail: v.string(),
    clientName: v.string(),
    title: v.string(),
    note: v.string(),
    space: v.string(),
    deliveryCents: v.optional(v.number()),
    depositBps: v.optional(v.number()), // ignored: every order is paid in full before delivery
    leadTime: v.string(),
    validDays: v.number(),
    items: v.array(quoteItem),
  },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (!isVerified(me.profile) && !(await isAdmin(ctx)))
      throw new Error('Client quotes are available to verified trade accounts.');
    if (!a.clientName.trim() || a.clientName.length > 150) throw new Error('Add who this quote is for.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.replyEmail)) throw new Error('Check the approval email address.');
    if (!Number.isInteger(a.markupBps) || a.markupBps < 0 || a.markupBps > 20000) throw new Error('Choose a markup between 0% and 200%.');
    if (![14, 30, 60].includes(a.validDays)) throw new Error('Choose how long the quote is valid.');
    if (a.deliveryCents !== undefined && (!Number.isSafeInteger(a.deliveryCents) || a.deliveryCents < 0 || a.deliveryCents > 100_000_000))
      throw new Error('Check the delivery amount.');
    if (a.title.length > 150 || a.note.length > 2000 || (a.studioName?.length ?? 0) > 120 || a.leadTime.length > 80)
      throw new Error('Please shorten the quote details.');
    const priced = await priceSelection(ctx, a.items, true);
    const lines = await Promise.all(
      priced.lines.map(async (l, i) => {
        const listing = await ctx.db
          .query('commerceListings')
          .withIndex('by_product_channel', (q) => q.eq('productId', l.productId).eq('channel', 'house'))
          .unique();
        const p = listing ? await pricedListing(ctx, listing) : null;
        const variant = p?.variants.find((x) => x.id === l.variantId);
        const retail = variant?.retail ?? l.unitPrice;
        return {
          productId: l.productId,
          variantId: l.variantId,
          name: l.name,
          image: variant?.image || listing?.snapshot.images[0],
          zone: priced.zones[i].slice(0, 80),
          quantity: l.quantity,
          unitSellCents: clientSellCents(retail, l.unitPrice, a.show, a.markupBps),
        };
      })
    );
    const now = Date.now();
    const count = await ctx.db.query('holmClientQuotes').withIndex('by_owner', (q) => q.eq('ownerId', me.userId)).collect();
    const s = slug();
    await ctx.db.insert('holmClientQuotes', {
      slug: s,
      number: `Q-${1000 + count.length + 1}`,
      ownerId: me.userId,
      status: 'sent',
      show: a.show,
      markupBps: a.markupBps,
      studioName: a.studioName?.trim() || undefined,
      replyEmail: a.replyEmail.trim().toLowerCase(),
      clientName: a.clientName.trim(),
      title: a.title.trim() || 'Your project',
      note: a.note.trim(),
      space: a.space.slice(0, 40),
      lines,
      deliveryCents: a.deliveryCents,
      depositBps: 10000,
      leadTime: a.leadTime.trim() || '8 to 10 weeks',
      validUntil: now + a.validDays * 86400000,
      createdAt: now,
      updatedAt: now,
    });
    return s;
  },
});

/** What the client sees: sell prices only, never trade cost or the designer's account. */
export const clientQuote = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug: s }) => {
    if (!/^[A-Za-z0-9]{22}$/.test(s)) return null;
    const q = await ctx.db.query('holmClientQuotes').withIndex('by_slug', (x) => x.eq('slug', s)).unique();
    if (!q) return null;
    return {
      number: q.number,
      status: q.status,
      studioName: q.studioName ?? null,
      clientName: q.clientName,
      title: q.title,
      note: q.note,
      space: q.space,
      lines: q.lines.map((l) => ({ name: l.name, image: l.image ?? null, zone: l.zone, quantity: l.quantity, unitSellCents: l.unitSellCents })),
      deliveryCents: q.deliveryCents ?? null,
      depositBps: q.depositBps,
      leadTime: q.leadTime,
      validUntil: q.validUntil,
      createdAt: q.createdAt,
      approval: q.approval ?? null,
      changeRequest: q.changeRequest ? { at: q.changeRequest.at } : null,
    };
  },
});

async function quoteBySlug(ctx: MutationCtx, s: string) {
  if (!/^[A-Za-z0-9]{22}$/.test(s)) throw new Error('This quote link is not complete.');
  const q = await ctx.db.query('holmClientQuotes').withIndex('by_slug', (x) => x.eq('slug', s)).unique();
  if (!q) throw new Error('This quote link is not complete.');
  if (Date.now() > q.validUntil) throw new Error('This quote has expired. Ask your designer for a new link.');
  return q;
}

export const markViewed = mutation({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    const q = await quoteBySlug(ctx, a.slug).catch(() => null);
    if (q && !q.viewedAt) await ctx.db.patch(q._id, { viewedAt: Date.now(), ...(q.status === 'sent' ? { status: 'viewed' as const } : {}) });
  },
});

export const approveClientQuote = mutation({
  args: { slug: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    const q = await quoteBySlug(ctx, a.slug);
    const name = a.name.trim();
    if (!name || name.length > 150) throw new Error('Type your full name to approve.');
    if (q.approval) return;
    const now = Date.now();
    await ctx.db.patch(q._id, { status: 'approved', approval: { name, at: now }, updatedAt: now });
    const total = q.lines.reduce((t, l) => t + l.unitSellCents * l.quantity, 0) + (q.deliveryCents ?? 0);
    await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
      key: `client-quote-approved:${q._id}`,
      to: q.replyEmail,
      subject: `Approved: ${q.title} (${q.number})`,
      text: `${name} approved quote ${q.number} for ${q.title}.\n\nTotal: $${(total / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}\nPayment in full is due before delivery.\n\nOpen your House of Louie Mae tray to request the order at trade pricing: https://louiemae.com/trade`,
    });
  },
});

export const requestClientChanges = mutation({
  args: { slug: v.string(), message: v.string() },
  handler: async (ctx, a) => {
    const q = await quoteBySlug(ctx, a.slug);
    if (q.approval) throw new Error('This quote is already approved. Contact your designer for changes.');
    const message = a.message.trim();
    if (!message || message.length > 2000) throw new Error('Tell your designer what to change.');
    const now = Date.now();
    await ctx.db.patch(q._id, { status: 'changes_requested', changeRequest: { message, at: now }, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
      key: `client-quote-changes:${q._id}:${now}`,
      to: q.replyEmail,
      subject: `Changes requested: ${q.title} (${q.number})`,
      text: `${q.clientName} asked for changes to quote ${q.number}:\n\n${message}`,
    });
  },
});

export const myClientQuotes = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return [];
    const rows = await ctx.db.query('holmClientQuotes').withIndex('by_owner', (q) => q.eq('ownerId', me.userId)).order('desc').take(50);
    return rows.map((q) => ({ slug: q.slug, number: q.number, title: q.title, clientName: q.clientName, status: q.status, approval: q.approval ?? null, updatedAt: q.updatedAt }));
  },
});
