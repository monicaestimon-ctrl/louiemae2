import { v } from 'convex/values';
import { query, mutation, internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { isPartner, isVerified, profileOf, requireUser, viewer } from './holmAccess';
import { partnerTier } from './holmTables';
import { HOLM_PARTNERS, commissionCents, holmChannel } from '../lib/holmPartners';

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
    return code;
  },
});

/**
 * A visit through a partner link, tagged with where it was opened from (story, pin, post, pdf,
 * link, share or qr) and, for a board link, the board. Deduplicated per visitor and partner each
 * day; the first visit opens the 30-day attribution window.
 */
export async function insertClick(
  ctx: MutationCtx,
  a: { refCode: string; channel: string; target: string; visitorId: string; board?: string }
) {
  if (!/^[A-Z0-9]{4,16}$/.test(a.refCode) || !/^[\w-]{16,64}$/.test(a.visitorId)) return;
  const partner = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', a.refCode)).first();
  if (!partner || !isPartner(partner)) return;
  const recent = await ctx.db
    .query('holmClicks')
    .withIndex('by_visitor_partner', (q) => q.eq('visitorId', a.visitorId).eq('partnerId', partner.userId).gte('at', Date.now() - DAY))
    .first();
  if (recent) return;
  await ctx.db.insert('holmClicks', {
    partnerId: partner.userId,
    refCode: a.refCode,
    channel: holmChannel(a.channel),
    target: a.target.slice(0, 120),
    visitorId: a.visitorId,
    ...(a.board ? { board: a.board } : {}),
    at: Date.now(),
  });
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
  if (!refCode || !visitorId || !/^[A-Z0-9]{4,16}$/.test(refCode)) return null;
  const partner = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', refCode)).first();
  if (!partner || !isPartner(partner) || partner.userId === buyer.userId) return null;
  const partnerUser = await ctx.db.get(partner.userId);
  if (typeof partnerUser?.email === 'string' && partnerUser.email.toLowerCase() === buyer.email) return null;
  const click = await ctx.db
    .query('holmClicks')
    .withIndex('by_visitor_partner', (q) =>
      q.eq('visitorId', visitorId).eq('partnerId', partner.userId).gte('at', Date.now() - HOLM_PARTNERS.attributionDays * DAY)
    )
    .order('desc')
    .first();
  if (!click) return null;
  return { partnerId: partner.userId, refCode, channel: click.channel, board: click.board };
}

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
      w9Status: p.w9Status ?? 'none',
      clicks30: clicks.length,
      byChannel,
      quotes: quotes.length,
      pendingCents: sum(commissions, 'pending'),
      clearedCents: sum(commissions, 'cleared'),
      paidCents: sum(commissions, 'paid'),
      creditCents: credits.reduce((t, c) => t + c.amountCents, 0),
      commissions: commissions.slice(0, 20).map((c) => ({ amountCents: c.amountCents, status: c.status, clearsAt: c.clearsAt, createdAt: c.createdAt })),
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
    await requireCjAdminIdentity(ctx);
    const p = await profileOf(ctx, a.userId);
    if (!p || !isPartner(p)) throw new Error('Partner not found.');
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
    if (!amount) throw new Error('Nothing has cleared for this partner yet.');
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
      const partner = await profileOf(ctx, r.partnerId);
      const rate = HOLM_PARTNERS.tiers[partner?.partnerTier ?? 'base'];
      const base = project.lines.reduce((t, l) => t + l.unitPrice * l.quantity, 0);
      const amount = commissionCents(base, rate);
      if (amount > 0)
        await ctx.db.insert('holmCommissions', {
          partnerId: r.partnerId,
          quoteRequestId: r._id,
          commerceProjectId: r.commerceProjectId,
          baseCents: base,
          rateBps: Math.min(rate, HOLM_PARTNERS.ceilingBps),
          amountCents: amount,
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
    for (const c of commissions) if (c.status !== 'void') earned.set(c.quoteRequestId, (earned.get(c.quoteRequestId) ?? 0) + c.amountCents);
    return Promise.all(
      boards.map(async (b) => {
        const clicks = await ctx.db.query('holmClicks').withIndex('by_board', (q) => q.eq('board', b.slug)).take(5000);
        const byChannel: Record<string, number> = {};
        for (const c of clicks) if (c.partnerId === me.userId) byChannel[c.channel] = (byChannel[c.channel] ?? 0) + 1;
        const orders = quotes.filter((q) => q.board === b.slug);
        return {
          slug: b.slug,
          title: b.title,
          mode: b.mode,
          views: b.views ?? 0,
          byChannel,
          orders: orders.length,
          commissionCents: orders.reduce((t, q) => t + (earned.get(q._id) ?? 0), 0),
          updatedAt: b.updatedAt ?? b.createdAt,
        };
      })
    );
  },
});
