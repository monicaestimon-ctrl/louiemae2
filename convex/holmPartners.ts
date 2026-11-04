import { v } from 'convex/values';
import { query, mutation, internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { isPartner, isVerified, profileOf, requireUser, viewer } from './holmAccess';
import { partnerTier } from './holmTables';
import { HOLM_PARTNERS, HOLM_RATES, REF_CODE, holmChannel, lineCommissions, type HolmTier } from '../lib/holmPartners';
import { houseUnitCosts } from './holm';

const DAY = 86_400_000;

// ---------- joining and links ----------
function makeCode(seed: string) {
  const letters = seed.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'HOUSE';
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const tail = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)), (b) => abc[b % abc.length]).join('');
  return `${letters}${tail}`;
}

export const join = mutation({
  args: { acceptTerms: v.boolean() },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (!a.acceptTerms) throw new Error('Accept the partner terms to join.');
    if (isPartner(me.profile)) return me.profile!.refCode;
    let code = makeCode(me.profile?.businessName || me.profile?.displayName || me.email);
    for (let i = 0; i < 5; i++) {
      const taken = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', code)).first();
      if (!taken) break;
      code = makeCode(me.email);
    }
    const now = Date.now();
    const patch = { partnerStatus: 'active' as const, partnerTier: 'base' as const, refCode: code, updatedAt: now };
    if (me.profile) await ctx.db.patch(me.profile._id, patch);
    else
      await ctx.db.insert('holmProfiles', {
        userId: me.userId,
        displayName: me.email.split('@')[0] || 'Member',
        tradeStatus: 'none',
        createdAt: now,
        ...patch,
      });
    await ctx.db.insert('holmTierChanges', { partnerId: me.userId, tier: 'base', at: now, reason: 'joined' });
    return code;
  },
});

/**
 * A visit through a partner link, tagged with where it was opened from (story, pin, post, pdf,
 * link, share or qr) and, for a board link, the board. Deduplicated per visitor and partner each
 * day; the first visit opens the 30-day attribution window. Returns whether the code belongs to
 * an active partner, so the browser only keeps (and replaces a saved code with) real ones.
 */
export async function insertClick(
  ctx: MutationCtx,
  a: { refCode: string; channel: string; target: string; visitorId: string; board?: string }
): Promise<boolean> {
  if (!REF_CODE.test(a.refCode) || !/^[\w-]{16,64}$/.test(a.visitorId)) return false;
  const partner = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', a.refCode)).first();
  if (!partner || !isPartner(partner)) return false;
  const recent = await ctx.db
    .query('holmClicks')
    .withIndex('by_visitor_partner', (q) => q.eq('visitorId', a.visitorId).eq('partnerId', partner.userId).gte('at', Date.now() - DAY))
    .first();
  if (recent) return true;
  await ctx.db.insert('holmClicks', {
    partnerId: partner.userId,
    refCode: a.refCode,
    channel: holmChannel(a.channel),
    target: a.target.slice(0, 120),
    visitorId: a.visitorId,
    ...(a.board ? { board: a.board } : {}),
    at: Date.now(),
  });
  return true;
}

export const recordClick = mutation({
  args: { refCode: v.string(), channel: v.string(), target: v.string(), visitorId: v.string() },
  handler: async (ctx, a) => insertClick(ctx, a),
});

/**
 * Resolves attribution for a quote request: a partner link clicked by this visitor in the
 * last 30 days. Self-referral never counts.
 */
export async function resolveAttribution(
  ctx: MutationCtx,
  refCode: string | undefined,
  visitorId: string | undefined,
  buyer: { userId?: Id<'users'>; email: string }
) {
  // A signed-in buyer on another device: the partner visit their account remembers.
  const own = buyer.userId ? await profileOf(ctx, buyer.userId) : null;
  if (!refCode && own?.refVisitCode && own.refVisitorId) refCode = own.refVisitCode;
  if (!visitorId && own?.refVisitorId) visitorId = own.refVisitorId;
  if (!refCode || !visitorId || !REF_CODE.test(refCode)) return null;
  const partner = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', refCode)).first();
  if (!partner || !isPartner(partner) || partner.userId === buyer.userId) return null;
  const partnerUser = await ctx.db.get(partner.userId);
  if (typeof partnerUser?.email === 'string' && partnerUser.email.toLowerCase() === buyer.email) return null;
  const since = Date.now() - HOLM_PARTNERS.attributionDays * DAY;
  const clickFrom = (vid: string) =>
    ctx.db
      .query('holmClicks')
      .withIndex('by_visitor_partner', (q) => q.eq('visitorId', vid).eq('partnerId', partner.userId).gte('at', since))
      .order('desc')
      .first();
  // This browser's visit, or for a signed-in buyer the visit their account remembers from another device.
  let click = await clickFrom(visitorId);
  if (!click && own?.refVisitorId && own.refVisitorId !== visitorId) click = await clickFrom(own.refVisitorId);
  if (!click) return null;
  return { partnerId: partner.userId, refCode, channel: click.channel, board: click.board };
}

/**
 * A signed-in member arrived through a partner link on this browser: remember the browser on
 * their account, so an order they place on another device within the window is still credited.
 * Only a browser with a real partner-link visit in the window is kept.
 */
export const linkVisit = mutation({
  args: { visitorId: v.string(), refCode: v.string() },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (!me.profile || !/^[\w-]{16,64}$/.test(a.visitorId) || !REF_CODE.test(a.refCode)) return;
    if (me.profile.refVisitorId === a.visitorId && me.profile.refVisitCode === a.refCode) return;
    const partner = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', a.refCode)).first();
    if (!partner || !isPartner(partner) || partner.userId === me.userId) return;
    const since = Date.now() - HOLM_PARTNERS.attributionDays * DAY;
    const click = await ctx.db
      .query('holmClicks')
      .withIndex('by_visitor_partner', (q) => q.eq('visitorId', a.visitorId).eq('partnerId', partner.userId).gte('at', since))
      .first();
    if (!click) return;
    await ctx.db.patch(me.profile._id, { refVisitorId: a.visitorId, refVisitCode: a.refCode, updatedAt: Date.now() });
  },
});

/** Business referral: the account that referred a new account, recorded once at sign-up. */
export async function recordReferral(ctx: MutationCtx, referredUserId: Id<'users'>, refCode: string | undefined) {
  if (!refCode || !/^[A-Z0-9]{4,16}$/.test(refCode)) return;
  const partner = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', refCode)).first();
  if (!partner || !isPartner(partner) || partner.userId === referredUserId) return;
  const existing = await ctx.db.query('holmReferrals').withIndex('by_referred', (q) => q.eq('referredUserId', referredUserId)).first();
  if (existing) return;
  await ctx.db.insert('holmReferrals', {
    referrerId: partner.userId,
    referredUserId,
    status: 'signed_up',
    creditCents: 0,
    createdAt: Date.now(),
  });
}

export async function markReferralVerified(ctx: MutationCtx, userId: Id<'users'>) {
  const ref = await ctx.db.query('holmReferrals').withIndex('by_referred', (q) => q.eq('referredUserId', userId)).first();
  if (ref?.status === 'signed_up') await ctx.db.patch(ref._id, { status: 'verified' });
}

/**
 * The tier a partner held at a moment (for commission, the moment the order was paid): the
 * latest change at or before it; before the first recorded change, the tier that change moved
 * from; with no history at all, their current tier.
 */
export async function partnerTierAt(ctx: MutationCtx, partnerId: Id<'users'>, at: number, current: HolmTier): Promise<HolmTier> {
  const latest = await ctx.db
    .query('holmTierChanges')
    .withIndex('by_partner', (q) => q.eq('partnerId', partnerId).lte('at', at))
    .order('desc')
    .first();
  if (latest) return latest.tier;
  const first = await ctx.db.query('holmTierChanges').withIndex('by_partner', (q) => q.eq('partnerId', partnerId)).first();
  return first ? first.from ?? 'base' : current;
}

// ---------- the Partner Hub ----------
const sum = (rows: Doc<'holmCommissions'>[], status: Doc<'holmCommissions'>['status']) =>
  rows.filter((r) => r.status === status).reduce((t, r) => t + r.amountCents, 0);

export const hub = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me || !isPartner(me.profile)) return null;
    const p = me.profile!;
    const since = Date.now() - 30 * DAY;
    const clicks = await ctx.db
      .query('holmClicks')
      .withIndex('by_partner', (q) => q.eq('partnerId', me.userId).gte('at', since))
      .take(5000);
    const byChannel: Record<string, number> = {};
    for (const c of clicks) byChannel[c.channel] = (byChannel[c.channel] ?? 0) + 1;
    const quotes = await ctx.db.query('holmQuoteRequests').withIndex('by_partner', (q) => q.eq('partnerId', me.userId)).order('desc').take(200);
    const commissions = await ctx.db.query('holmCommissions').withIndex('by_partner', (q) => q.eq('partnerId', me.userId)).order('desc').take(500);
    const referrals = await ctx.db.query('holmReferrals').withIndex('by_referrer', (q) => q.eq('referrerId', me.userId)).order('desc').take(100);
    const credits = await ctx.db.query('holmCredits').withIndex('by_user', (q) => q.eq('userId', me.userId)).take(500);
    const payouts = await ctx.db.query('holmPayouts').withIndex('by_partner', (q) => q.eq('partnerId', me.userId)).order('desc').take(24);
    const tier = p.partnerTier ?? 'base';
    return {
      refCode: p.refCode!,
      tier,
      rateBps: HOLM_PARTNERS.tiers[tier],
      rates: HOLM_RATES[tier],
      w9Status: p.w9Status ?? 'none',
      clicks30: clicks.length,
      byChannel,
      quotes: quotes.length,
      orders: commissions.filter((c) => c.status !== 'void' && c.source !== 'adjustment').length,
      pendingCents: sum(commissions, 'pending'),
      clearedCents: sum(commissions, 'cleared'),
      paidCents: sum(commissions, 'paid'),
      creditCents: credits.reduce((t, c) => t + c.amountCents, 0),
      // The orders list: no buyer names or emails, only what the partner needs to follow their earnings.
      commissions: commissions.slice(0, 50).map((c) => ({
        source: c.source ?? ('house_quote' as const),
        baseCents: c.baseCents,
        amountCents: c.amountCents,
        status: c.status,
        clearsAt: c.clearsAt,
        createdAt: c.createdAt,
        channel: c.channel ?? null,
        board: c.board ?? null,
        note: c.note ?? null,
        lines: (c.lines ?? []).map((l) => ({ type: l.type, baseCents: l.baseCents, rateBps: l.rateBps, amountCents: l.amountCents, capped: l.capped })),
      })),
      referrals: await Promise.all(
        referrals.map(async (r) => {
          const prof = await profileOf(ctx, r.referredUserId);
          return { name: prof?.businessName || prof?.displayName || 'New account', status: r.status, creditCents: r.creditCents, createdAt: r.createdAt };
        })
      ),
      payouts: payouts.map((x) => ({ amountCents: x.amountCents, reference: x.reference, paidAt: x.paidAt })),
    };
  },
});

export const w9UploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    if (!isPartner(me.profile)) throw new Error('Join the partner program first.');
    return ctx.storage.generateUploadUrl();
  },
});

export const submitW9 = mutation({
  args: { fileId: v.id('_storage') },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    if (!isPartner(me.profile)) throw new Error('Join the partner program first.');
    await ctx.db.patch(me.profile!._id, { w9FileId: a.fileId, w9Status: 'pending', updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
      key: `w9:${me.userId}:${a.fileId}`,
      to: 'owner',
      subject: `House of Louie Mae — W-9 from ${me.profile!.businessName || me.email}`,
      text: `A partner uploaded a W-9. Review it under Partners at https://louiemae.com/trade#admin`,
    });
  },
});

// ---------- team ----------
export const adminPartners = query({
  args: {},
  handler: async (ctx) => {
    await requireCjAdminIdentity(ctx);
    const partners = await ctx.db.query('holmProfiles').withIndex('by_partner_status', (q) => q.eq('partnerStatus', 'active')).take(500);
    return Promise.all(
      partners.map(async (p) => {
        const rows = await ctx.db.query('holmCommissions').withIndex('by_partner', (q) => q.eq('partnerId', p.userId)).take(1000);
        const user = await ctx.db.get(p.userId);
        return {
          userId: p.userId,
          name: p.businessName || p.displayName,
          email: typeof user?.email === 'string' ? user.email : '',
          refCode: p.refCode,
          tier: p.partnerTier ?? 'base',
          w9Status: p.w9Status ?? 'none',
          w9Url: p.w9FileId ? await ctx.storage.getUrl(p.w9FileId) : null,
          pendingCents: sum(rows, 'pending'),
          clearedCents: sum(rows, 'cleared'),
          paidCents: sum(rows, 'paid'),
        };
      })
    );
  },
});

export const adminSetPartner = mutation({
  args: { userId: v.id('users'), tier: v.optional(partnerTier), w9Approved: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const p = await profileOf(ctx, a.userId);
    if (!p || !isPartner(p)) throw new Error('Partner not found.');
    const from = p.partnerTier ?? 'base';
    if (a.tier && a.tier !== from)
      await ctx.db.insert('holmTierChanges', { partnerId: a.userId, tier: a.tier, from, at: Date.now(), reason: 'set by the team', by: admin.email });
    await ctx.db.patch(p._id, {
      ...(a.tier ? { partnerTier: a.tier } : {}),
      ...(a.w9Approved !== undefined ? { w9Status: a.w9Approved ? ('approved' as const) : undefined } : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Pays every cleared commission for one partner, recorded against an external reference. */
export const adminRecordPayout = mutation({
  args: { userId: v.id('users'), reference: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const p = await profileOf(ctx, a.userId);
    if (!p || !isPartner(p)) throw new Error('Partner not found.');
    if (p.w9Status !== 'approved') throw new Error('Approve the partner’s W-9 before paying commission.');
    const reference = a.reference.trim().slice(0, 120);
    if (!reference) throw new Error('Add the payment reference.');
    const cleared = await ctx.db
      .query('holmCommissions')
      .withIndex('by_partner_status', (q) => q.eq('partnerId', a.userId).eq('status', 'cleared'))
      .collect();
    const amount = cleared.reduce((t, c) => t + c.amountCents, 0);
    if (amount <= 0) throw new Error('Nothing has cleared for this partner yet.');
    const now = Date.now();
    const payoutId = await ctx.db.insert('holmPayouts', { partnerId: a.userId, amountCents: amount, reference, paidBy: admin.email, paidAt: now });
    for (const c of cleared) await ctx.db.patch(c._id, { status: 'paid', payoutId });
    const user = await ctx.db.get(a.userId);
    if (typeof user?.email === 'string')
      await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
        key: `payout:${payoutId}`,
        to: user.email,
        subject: 'Your House of Louie Mae commission has been paid',
        text: `We sent $${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} in partner commission (reference ${reference}).`,
      });
  },
});

// ---------- reconciliation (hourly) ----------
export const reconcile = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // 1. Retail requests from partner links: commission once the project is paid.
    const waiting = await ctx.db
      .query('holmQuoteRequests')
      .withIndex('by_partner_state', (q) => q.eq('partnerState', 'awaiting_payment'))
      .take(100); // least recently checked first, so unpaid quotes never block newer ones
    // Pricing a paid order reads its products and listings, so a run prices at most this many;
    // the rest stay awaiting payment (and first in line) for the next run.
    let priced = 0;
    for (const r of waiting) {
      const project = await ctx.db.get(r.commerceProjectId);
      if (!project || project.status === 'cancelled' || project.status === 'payment_review') {
        await ctx.db.patch(r._id, { partnerState: 'void' });
        continue;
      }
      if (!project.paidAt || !r.partnerId || r.priceMode !== 'retail') {
        // Unpaid quotes expire after the hold; otherwise they are checked again next pass.
        const expired = now - r.createdAt > HOLM_PARTNERS.quoteHoldDays * DAY;
        await ctx.db.patch(r._id, expired ? { partnerState: 'void' } : { partnerCheckedAt: now });
        continue;
      }
      if (priced >= 25) continue;
      priced++;
      const partner = await profileOf(ctx, r.partnerId);
      const tier = await partnerTierAt(ctx, r.partnerId, project.paidAt, partner?.partnerTier ?? 'base');
      // Each line at its product type's rate, held to 40% of our profit on it.
      const costs = await houseUnitCosts(ctx, project.lines);
      const result = lineCommissions(
        project.lines.map((l, i) => ({
          key: `${i}:${l.productId}:${l.variantId}`,
          type: costs.types.get(l.productId) ?? ('furniture' as const),
          unitCents: l.unitPrice,
          quantity: l.quantity,
          unitCostCents: costs.get(`${l.productId}:${l.variantId}`) ?? null,
        })),
        tier,
        (project.delivery ?? 0) + (project.tax ?? 0)
      );
      if (result.amountCents > 0)
        await ctx.db.insert('holmCommissions', {
          partnerId: r.partnerId,
          source: 'house_quote',
          quoteRequestId: r._id,
          commerceProjectId: r.commerceProjectId,
          ...(r.channel ? { channel: r.channel } : {}),
          ...(r.board ? { board: r.board } : {}),
          baseCents: result.baseCents,
          originalCents: result.amountCents,
          // the rate actually earned across the order; each line keeps its own rate
          rateBps: result.baseCents ? Math.round((result.amountCents * 10000) / result.baseCents) : 0,
          amountCents: result.amountCents,
          tier,
          lines: result.lines,
          status: 'pending',
          clearsAt: project.paidAt + HOLM_PARTNERS.clearingDays * DAY,
          createdAt: now,
        });
      await ctx.db.patch(r._id, { partnerState: 'credited' });
    }
    // 2. Pending commissions clear after the window, unless the payment was reversed.
    const due = await ctx.db
      .query('holmCommissions')
      .withIndex('by_status_clears', (q) => q.eq('status', 'pending').lte('clearsAt', now))
      .take(100);
    for (const c of due) {
      // Storefront refunds and disputes are applied as they happen (storefrontReversal).
      if (!c.commerceProjectId) {
        await ctx.db.patch(c._id, { status: c.amountCents > 0 ? 'cleared' : 'void' });
        continue;
      }
      const project = await ctx.db.get(c.commerceProjectId);
      await ctx.db.patch(c._id, { status: project && project.status !== 'payment_review' && project.status !== 'cancelled' ? 'cleared' : 'void' });
    }
    // 3. Business referrals: $100 credit after the referred business is verified and a first order over $500 is paid.
    // Least recently checked first and in small batches, so one run stays within read limits.
    const verified = await ctx.db
      .query('holmReferrals')
      .withIndex('by_status_checked', (q) => q.eq('status', 'verified'))
      .take(25);
    for (const ref of verified) {
      const prof = await profileOf(ctx, ref.referredUserId);
      if (!isVerified(prof)) {
        await ctx.db.patch(ref._id, { checkedAt: now });
        continue;
      }
      const requests = await ctx.db
        .query('holmQuoteRequests')
        .withIndex('by_user', (q) => q.eq('userId', ref.referredUserId))
        .order('desc')
        .take(20);
      let qualifies = false;
      for (const r of requests) {
        const project = await ctx.db.get(r.commerceProjectId);
        if (project?.paidAt && project.status !== 'payment_review' && project.lines.reduce((t, l) => t + l.unitPrice * l.quantity, 0) >= HOLM_PARTNERS.referralMinOrderCents) {
          qualifies = true;
          break;
        }
      }
      if (!qualifies) {
        await ctx.db.patch(ref._id, { checkedAt: now });
        continue;
      }
      await ctx.db.insert('holmCredits', { userId: ref.referrerId, amountCents: HOLM_PARTNERS.referralCreditCents, reason: 'Business referral', at: now });
      await ctx.db.patch(ref._id, { status: 'credited', creditCents: HOLM_PARTNERS.referralCreditCents });
    }
  },
});

/** Per-board stats for the partner's shared boards: views, link visits by channel, orders and commission. */
export const boardStats = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me || !isPartner(me.profile)) return null;
    const boards = await ctx.db.query('holmSharedBoards').withIndex('by_owner', (q) => q.eq('ownerId', me.userId)).order('desc').take(40);
    const quotes = await ctx.db.query('holmQuoteRequests').withIndex('by_partner', (q) => q.eq('partnerId', me.userId)).order('desc').take(500);
    const commissions = await ctx.db.query('holmCommissions').withIndex('by_partner', (q) => q.eq('partnerId', me.userId)).order('desc').take(1000);
    const earned = new Map<string, number>();
    const boardOrders = new Map<string, number>();
    for (const c of commissions) {
      if (c.status === 'void') continue;
      if (c.quoteRequestId) earned.set(c.quoteRequestId, (earned.get(c.quoteRequestId) ?? 0) + c.amountCents);
      // storefront orders carry the board on the commission itself
      else if (c.board && c.source === 'storefront_order') {
        earned.set('board:' + c.board, (earned.get('board:' + c.board) ?? 0) + c.amountCents);
        boardOrders.set(c.board, (boardOrders.get(c.board) ?? 0) + 1);
      }
    }
    return Promise.all(
      boards.map(async (b) => {
        // Recent clicks only: 40 boards x 500 rows stays well inside a query's read limit.
        const clicks = await ctx.db.query('holmClicks').withIndex('by_board', (q) => q.eq('board', b.slug)).order('desc').take(500);
        const byChannel: Record<string, number> = {};
        for (const c of clicks) if (c.partnerId === me.userId) byChannel[c.channel] = (byChannel[c.channel] ?? 0) + 1;
        const orders = quotes.filter((q) => q.board === b.slug);
        return {
          slug: b.slug,
          title: b.title,
          mode: b.mode,
          views: b.views ?? 0,
          byChannel,
          orders: orders.length + (boardOrders.get(b.slug) ?? 0),
          commissionCents: orders.reduce((t, q) => t + (earned.get(q._id) ?? 0), 0) + (earned.get('board:' + b.slug) ?? 0),
          updatedAt: b.updatedAt ?? b.createdAt,
        };
      })
    );
  },
});

// ---------- storefront (louiemae.com) orders ----------

/**
 * A louiemae.com checkout was paid. If a partner's link brought this buyer, create one pending
 * commission for the session (a repeated or late webhook changes nothing). Self-referral is
 * checked again now that the buyer's email is known.
 */
export const storefrontCommission = internalMutation({
  args: {
    retailCheckoutId: v.id('retailCheckouts'),
    stripeSessionId: v.string(),
    paymentIntentId: v.optional(v.string()),
    email: v.string(),
    deliveryCents: v.number(),
    taxCents: v.number(),
  },
  handler: async (ctx, a) => {
    const checkout = await ctx.db.get(a.retailCheckoutId);
    // Without the buyer's email, self-referral can't be ruled out.
    if (!checkout?.partner || !a.email.trim()) return null;
    const existing = await ctx.db.query('holmCommissions').withIndex('by_session', (q) => q.eq('stripeSessionId', a.stripeSessionId)).first();
    if (existing) return existing._id;
    const p = checkout.partner;
    const attr = await resolveAttribution(ctx, p.refCode, p.visitorId, { email: a.email.trim().toLowerCase() });
    if (!attr || attr.partnerId !== p.partnerId) return null;
    const now = Date.now();
    const partner = await profileOf(ctx, p.partnerId);
    const tier = await partnerTierAt(ctx, p.partnerId, now, partner?.partnerTier ?? 'base');
    const lines = checkout.items.map((item, i) => ({
      key: `${i}:${item.productId}:${item.variantId}`,
      productId: ctx.db.normalizeId('commerceProducts', item.productId),
      variantId: item.variantId,
      unitCents: Math.round(item.price * 100),
      quantity: item.quantity,
    }));
    const known = lines.filter((l): l is typeof l & { productId: Id<'commerceProducts'> } => l.productId !== null);
    const costs = await houseUnitCosts(ctx, known, 'retail');
    const result = lineCommissions(
      lines.map((l) => ({
        key: l.key,
        type: (l.productId && costs.types.get(l.productId)) || 'furniture',
        unitCents: l.unitCents,
        quantity: l.quantity,
        unitCostCents: (l.productId && costs.get(`${l.productId}:${l.variantId}`)) ?? null,
      })),
      tier,
      a.deliveryCents + a.taxCents
    );
    if (result.amountCents <= 0) return null;
    return ctx.db.insert('holmCommissions', {
      partnerId: p.partnerId,
      source: 'storefront_order',
      retailCheckoutId: checkout._id,
      stripeSessionId: a.stripeSessionId,
      ...(a.paymentIntentId ? { paymentIntentId: a.paymentIntentId } : {}),
      channel: attr.channel,
      ...(attr.board ? { board: attr.board } : {}),
      baseCents: result.baseCents,
      rateBps: result.baseCents ? Math.round((result.amountCents * 10000) / result.baseCents) : 0,
      amountCents: result.amountCents,
      originalCents: result.amountCents,
      reversedCents: 0,
      tier,
      lines: result.lines,
      status: 'pending',
      clearsAt: now + HOLM_PARTNERS.clearingDays * DAY,
      createdAt: now,
    });
  },
});

/**
 * A storefront payment was refunded (fully or partly), disputed, or a dispute was won. The
 * commission follows: a refund takes back its share, a dispute takes it all, a won dispute gives
 * back what the dispute took. Before payout the amount changes; after payout an adjustment
 * (negative or positive) goes on the partner's next payout. Stripe reports the total refunded so
 * far, so replays and repeated events are applied once.
 */
export const storefrontReversal = internalMutation({
  args: {
    paymentIntentId: v.string(),
    kind: v.union(v.literal('refund'), v.literal('dispute'), v.literal('dispute_won')),
    refundedCents: v.optional(v.number()),
    chargeCents: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query('holmCommissions').withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId)).take(10);
    const now = Date.now();
    for (const c of rows) {
      if (c.source !== 'storefront_order') continue;
      const refundedCents = a.kind === 'refund' ? Math.max(c.refundedCents ?? 0, a.refundedCents ?? 0) : (c.refundedCents ?? 0);
      const chargeCents = a.kind === 'refund' && a.chargeCents ? a.chargeCents : (c.chargeCents ?? 0);
      const disputed = a.kind === 'dispute' ? true : a.kind === 'dispute_won' ? false : (c.disputed ?? false);
      const original = c.originalCents ?? c.amountCents;
      const kept = disputed ? 0 : chargeCents > 0 ? Math.round(original * Math.max(0, 1 - refundedCents / chargeCents)) : original;
      const target = original - kept; // total that should be taken back
      const delta = target - (c.reversedCents ?? 0);
      const state = { reversedCents: target, refundedCents, chargeCents, disputed };
      if (delta === 0) {
        await ctx.db.patch(c._id, state);
        continue;
      }
      if (c.status === 'paid') {
        await ctx.db.insert('holmCommissions', {
          partnerId: c.partnerId,
          source: 'adjustment',
          adjustsId: c._id,
          baseCents: 0,
          rateBps: 0,
          amountCents: -delta,
          status: 'cleared',
          clearsAt: now,
          createdAt: now,
          note: delta < 0 ? 'Dispute won after payout' : a.kind === 'dispute' ? 'Payment disputed after payout' : 'Refunded after payout',
        });
        await ctx.db.patch(c._id, state);
      } else {
        const amount = Math.max(0, c.amountCents - delta);
        const status = amount === 0 ? ('void' as const) : c.status === 'void' ? (now >= c.clearsAt ? ('cleared' as const) : ('pending' as const)) : c.status;
        await ctx.db.patch(c._id, { ...state, amountCents: amount, status });
      }
    }
  },
});
