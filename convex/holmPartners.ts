import { v } from 'convex/values';
import { query, mutation, internalMutation } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { isPartner, isVerified, profileOf, requireUser, viewer } from './holmAccess';
import { partnerTier } from './holmTables';
import { HOLM_PARTNERS, HOLM_RATES, HOLM_TIER_ORDER, REF_CODE, TIER_NAMES, holmChannel, lineCommissions, quarterOf, tierForSales, tierProgress, tierRank, type HolmTier } from '../lib/holmPartners';
import { houseUnitCosts } from './holm';
import { projectCredit } from '../lib/commerce';
import { payoutsEnabled, unpaidCleared } from './holmPayouts';

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

// ---------- tiers (spec section 5.2) ----------

/**
 * A partner's attributed paid sales over the last 12 months, after refunds: the order value of
 * every storefront order and paid House quote through their links. Void orders count nothing.
 */
export async function salesLast12Months(ctx: QueryCtx, partnerId: Id<'users'>, now = Date.now()) {
  const rows = await ctx.db
    .query('holmCommissions')
    .withIndex('by_partner', (q) => q.eq('partnerId', partnerId).gte('createdAt', now - 365 * DAY))
    .take(5000);
  let cents = 0;
  for (const c of rows) {
    if (c.status === 'void' || c.source === 'adjustment') continue;
    const original = c.originalCents ?? c.amountCents;
    const kept = original > 0 ? Math.max(0, original - (c.reversedCents ?? 0)) / original : 1;
    cents += Math.round(c.baseCents * kept);
  }
  return cents;
}

const overrideActive = (p: Doc<'holmProfiles'>, now: number) => !!p.tierOverride && (p.tierOverride.until === undefined || p.tierOverride.until > now);

/**
 * Nightly: a partner moves up as soon as their 12-month sales cross a threshold. Moving down is
 * checked once a quarter, one tier at a time. A tier the team set by hand is left alone until its
 * end date. Orders already paid keep the tier they were paid at.
 */
export const updateTiers = internalMutation({
  args: { cursor: v.optional(v.string()), now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    // One page of partners per run, and one small job per partner, so no single transaction
    // reads more than one partner's 12 months of orders. Every page uses the same moment.
    const now = a.now ?? Date.now();
    const page = await ctx.db
      .query('holmProfiles')
      .withIndex('by_partner_status', (q) => q.eq('partnerStatus', 'active'))
      .paginate({ cursor: a.cursor ?? null, numItems: 50 });
    for (const p of page.page) await ctx.scheduler.runAfter(0, internal.holmPartners.updatePartnerTier, { profileId: p._id, now });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.holmPartners.updateTiers, { cursor: page.continueCursor, now });
  },
});

/** The nightly tier rules for one partner (see updateTiers). */
export const updatePartnerTier = internalMutation({
  args: { profileId: v.id('holmProfiles'), now: v.number() },
  handler: async (ctx, { profileId, now }) => {
    const p = await ctx.db.get(profileId);
    if (!p || !isPartner(p)) return;
    // Kept on the profile for the admin list, which shows every partner at once.
    const sales = await salesLast12Months(ctx, p.userId, now);
    // Leaves updatedAt alone: the nightly pages walk partners in updatedAt order.
    const patch: Partial<Doc<'holmProfiles'>> = p.sales12Cents === sales ? {} : { sales12Cents: sales };
    if (overrideActive(p, now)) {
      if (Object.keys(patch).length) await ctx.db.patch(p._id, patch);
      return;
    }
    const current = p.partnerTier ?? 'base';
    if (p.tierOverride) patch.tierOverride = undefined; // ended: automatic tiers resume
    const earned = tierForSales(sales);
    let next = current;
    if (tierRank(earned) > tierRank(current)) next = earned;
    else if (quarterOf(now) !== quarterOf(p.tierDownCheckedAt ?? 0)) {
      patch.tierDownCheckedAt = now;
      if (tierRank(earned) < tierRank(current)) next = HOLM_TIER_ORDER[tierRank(current) - 1];
    }
    if (next !== current) {
      patch.partnerTier = next;
      const up = tierRank(next) > tierRank(current);
      await ctx.db.insert('holmTierChanges', {
        partnerId: p.userId,
        tier: next,
        from: current,
        at: now,
        reason: `${up ? 'moved up' : 'quarterly review'}: $${Math.round(sales / 100).toLocaleString('en-US')} in sales over 12 months`,
      });
      const user = await ctx.db.get(p.userId);
      if (up && typeof user?.email === 'string')
        await ctx.scheduler.runAfter(0, internal.holmEmail.send, {
          key: `tier:${p.userId}:${next}:${now}`,
          to: user.email,
          subject: `You've reached ${TIER_NAMES[next]} in the Louie Mae partner program`,
          text: `Your sales through your links passed $${Math.round(sales / 100).toLocaleString('en-US')} over the last 12 months, so you're now ${TIER_NAMES[next]}: ${(HOLM_RATES[next].furniture / 100)}% on furniture, ${(HOLM_RATES[next].decor / 100)}% on home décor and ${(HOLM_RATES[next].clothing / 100)}% on clothing, on orders paid from today.\n\nPartner terms: https://www.louiemae.com/trade#partner-terms`,
        });
    }
    if (Object.keys(patch).length) await ctx.db.patch(p._id, patch);
  },
});

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
    // Completed payouts only: a failed or unfinished Stripe transfer isn't money the partner has.
    const payouts = await ctx.db
      .query('holmPayouts')
      .withIndex('by_partner', (q) => q.eq('partnerId', me.userId))
      .order('desc')
      .filter((q) => q.and(q.neq(q.field('status'), 'failed'), q.neq(q.field('status'), 'processing')))
      .take(24);
    const tier = p.partnerTier ?? 'base';
    const sales12Cents = await salesLast12Months(ctx, me.userId);
    return {
      refCode: p.refCode!,
      tier,
      sales12Cents,
      // While the team holds a tier, sales don't move it.
      tierProgress: overrideActive(p, Date.now()) ? null : tierProgress(tier, sales12Cents).line,
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
      payouts: payouts.map((x) => ({ amountCents: x.amountCents, reference: x.method === 'stripe' ? 'Stripe transfer' : x.reference, paidAt: x.paidAt, status: x.status ?? 'paid' })),
      // Automatic payouts: whether they're switched on, and this partner's Stripe setup.
      payoutSetup: {
        enabled: payoutsEnabled(),
        connected: !!p.stripeAccountId,
        ready: !!p.payoutsReady,
        due: (p.payoutsDue ?? []).length,
      },
      payoutMinCents: HOLM_PARTNERS.payoutMinCents,
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
          sales12Cents: p.sales12Cents ?? 0, // as of the last nightly update
          nextTier: tierProgress(p.partnerTier ?? 'base', p.sales12Cents ?? 0).line,
          payouts: { connected: !!p.stripeAccountId, ready: !!p.payoutsReady, due: (p.payoutsDue ?? []).length },
          // Cleared and not already in a payout: paid on the 15th if $50 or more.
          unpaidCents: (await unpaidCleared(ctx, p.userId)).reduce((t, r) => t + r.amountCents, 0),
          w9Approved: p.w9Status === 'approved',
          autoPayouts: payoutsEnabled(),
          override: p.tierOverride && overrideActive(p, Date.now()) ? { reason: p.tierOverride.reason, until: p.tierOverride.until ?? null } : null,
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

/**
 * Team changes to a partner: a tier set by hand (with a reason and an optional end date; until
 * then the nightly update leaves the tier alone), ending that hold, or the W-9 approval.
 */
export const adminSetPartner = mutation({
  args: {
    userId: v.id('users'),
    tier: v.optional(partnerTier),
    reason: v.optional(v.string()),
    until: v.optional(v.number()),
    clearOverride: v.optional(v.boolean()),
    w9Approved: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const p = await profileOf(ctx, a.userId);
    if (!p || !isPartner(p)) throw new Error('Partner not found.');
    const now = Date.now();
    const from = p.partnerTier ?? 'base';
    let override: Doc<'holmProfiles'>['tierOverride'] | null = null;
    if (a.tier) {
      const reason = (a.reason ?? '').trim().slice(0, 200);
      if (!reason) throw new Error('Add a reason for setting the tier by hand.');
      if (a.until !== undefined && !(a.until > now)) throw new Error('The end date must be in the future.');
      override = { reason, by: admin.email, at: now, ...(a.until !== undefined ? { until: a.until } : {}) };
      if (a.tier !== from) await ctx.db.insert('holmTierChanges', { partnerId: a.userId, tier: a.tier, from, at: now, reason: `set by the team: ${reason}`, by: admin.email });
    }
    await ctx.db.patch(p._id, {
      ...(a.tier ? { partnerTier: a.tier, tierOverride: override! } : {}),
      ...(a.clearOverride && !a.tier ? { tierOverride: undefined } : {}),
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
    // Not anything an automatic Stripe payout is already sending.
    const cleared = await unpaidCleared(ctx, a.userId);
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
        text: `We sent $${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} in partner commission (reference ${reference}).\n\nPartner terms: https://www.louiemae.com/trade#partner-terms`,
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
      const costs = await houseUnitCosts(ctx, project.lines, 'house', project.paidAt);
      // Commission is worked out after store credit, shared across the lines by value.
      const merch = project.lines.reduce((t, l) => t + l.unitPrice * l.quantity, 0);
      const keep = merch > 0 ? 1 - projectCredit(project) / merch : 1;
      const all = project.lines.map((l, i) => ({
        key: `${i}:${l.productId}:${l.variantId}`,
        excluded: costs.excluded.has(l.productId),
        type: costs.types.get(l.productId) ?? ('furniture' as const),
        unitCents: Math.round(l.unitPrice * keep),
        quantity: l.quantity,
        unitCostCents: costs.get(`${l.productId}:${l.variantId}`) ?? null,
      }));
      // Excluded products earn nothing; their value still counts toward the card fee.
      const excludedCents = all.filter((l) => l.excluded).reduce((t, l) => t + l.unitCents * l.quantity, 0);
      const result = lineCommissions(all.filter((l) => !l.excluded), tier, (project.delivery ?? 0) + (project.tax ?? 0), excludedCents);
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
      await ctx.db.insert('holmCredits', { userId: ref.referrerId, amountCents: HOLM_PARTNERS.referralCreditCents, kind: 'earned', reason: 'Business referral', at: now });
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
      // (and refunds or disputes after payout come back as adjustments on the same board)
      else if (c.board && (c.source === 'storefront_order' || c.source === 'adjustment')) {
        earned.set('board:' + c.board, (earned.get('board:' + c.board) ?? 0) + c.amountCents);
        if (c.source === 'storefront_order') boardOrders.set(c.board, (boardOrders.get(c.board) ?? 0) + 1);
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
      // after store credit, shared across the items by value
      unitCents: Math.round(item.price * 100 * (checkout.subtotal > 0 ? 1 - Math.min(checkout.creditCents ?? 0, checkout.subtotal) / checkout.subtotal : 1)),
      quantity: item.quantity,
    }));
    const known = lines.filter((l): l is typeof l & { productId: Id<'commerceProducts'> } => l.productId !== null);
    const costs = await houseUnitCosts(ctx, known, 'retail');
    // Excluded products earn nothing; their value still counts toward the card fee.
    const isExcluded = (l: (typeof lines)[number]) => !!l.productId && costs.excluded.has(l.productId);
    const excludedCents = lines.filter(isExcluded).reduce((t, l) => t + l.unitCents * l.quantity, 0);
    const result = lineCommissions(
      lines.filter((l) => !isExcluded(l)).map((l) => ({
        key: l.key,
        type: (l.productId && costs.types.get(l.productId)) || 'furniture',
        unitCents: l.unitCents,
        quantity: l.quantity,
        unitCostCents: (l.productId && costs.get(`${l.productId}:${l.variantId}`)) ?? null,
      })),
      tier,
      a.deliveryCents + a.taxCents,
      excludedCents
    );
    if (result.amountCents <= 0) return null;
    const id = await ctx.db.insert('holmCommissions', {
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
    // A refund or dispute that reached us before this order's payment event.
    if (a.paymentIntentId) {
      const early = await ctx.db.query('holmPaymentStates').withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId!)).first();
      const row = early && (await ctx.db.get(id));
      if (early && row) await applyPaymentState(ctx, row, { refundedCents: early.refundedCents, chargeCents: early.chargeCents, disputed: early.disputed });
    }
    return id;
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
    const now = Date.now();
    const saved = await ctx.db.query('holmPaymentStates').withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId)).first();
    const state: PaymentState = {
      // Stripe reports the running refund total, so the larger figure is the latest.
      refundedCents: a.kind === 'refund' ? Math.max(saved?.refundedCents ?? 0, a.refundedCents ?? 0) : (saved?.refundedCents ?? 0),
      chargeCents: a.kind === 'refund' && a.chargeCents ? a.chargeCents : (saved?.chargeCents ?? 0),
      disputed: a.kind === 'dispute' ? true : a.kind === 'dispute_won' ? false : (saved?.disputed ?? false),
    };
    if (saved) await ctx.db.patch(saved._id, { ...state, updatedAt: now });
    else await ctx.db.insert('holmPaymentStates', { paymentIntentId: a.paymentIntentId, ...state, updatedAt: now });
    const rows = await ctx.db.query('holmCommissions').withIndex('by_payment', (q) => q.eq('paymentIntentId', a.paymentIntentId)).take(10);
    for (const c of rows) if (c.source === 'storefront_order') await applyPaymentState(ctx, c, state);
  },
});

type PaymentState = { refundedCents: number; chargeCents: number; disputed: boolean };

/** Brings a storefront commission in line with its payment's refunds and disputes. Safe to repeat. */
async function applyPaymentState(ctx: MutationCtx, c: Doc<'holmCommissions'>, state: PaymentState) {
  const now = Date.now();
  const original = c.originalCents ?? c.amountCents;
  const kept = state.disputed
    ? 0
    : state.chargeCents > 0
      ? Math.round(original * Math.max(0, 1 - state.refundedCents / state.chargeCents))
      : original;
  const target = original - kept; // total that should be taken back
  const delta = target - (c.reversedCents ?? 0);
  const fields = { reversedCents: target, ...state };
  if (delta === 0) return ctx.db.patch(c._id, fields);
  if (c.status === 'paid') {
    await ctx.db.insert('holmCommissions', {
      partnerId: c.partnerId,
      source: 'adjustment',
      adjustsId: c._id,
      ...(c.board ? { board: c.board } : {}),
      baseCents: 0,
      rateBps: 0,
      amountCents: -delta,
      status: 'cleared',
      clearsAt: now,
      createdAt: now,
      note: delta < 0 ? 'Dispute won after payout' : state.disputed ? 'Payment disputed after payout' : 'Refunded after payout',
    });
    return ctx.db.patch(c._id, fields);
  }
  const amount = Math.max(0, c.amountCents - delta);
  const status = amount === 0 ? ('void' as const) : c.status === 'void' ? (now >= c.clearsAt ? ('cleared' as const) : ('pending' as const)) : c.status;
  return ctx.db.patch(c._id, { ...fields, amountCents: amount, status });
}
