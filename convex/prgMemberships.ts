// Creator and trade memberships with versioned terms (spec S24, v2 §14, §26). Creator flow:
// email verified → profile → terms → automated basic checks → active or review. Trade flow uses
// the existing application review; referral activation is a separate step in the same account.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireUser, viewer } from './holmAccess';
import { requireCjAdminIdentity } from './cjAdminAccess';
import { audit } from './sysCore';
import { beneficiaryOf, ensureBeneficiary, membership, requireOrgRole } from './prgCore';
import { requireFlag } from '../lib/flags';
import { CommerceError } from '../lib/errors';
import { abuseFlags, profileProblems } from '../lib/enrollment';

type Ctx = QueryCtx | MutationCtx;

/** The published terms version for a program (creator, trade, referral, privacy). */
export async function currentTerms(ctx: Ctx, program: 'creator' | 'trade' | 'referral' | 'privacy') {
  const rows = await ctx.db.query('prgTermsVersions').withIndex('by_program_version', (q) => q.eq('program', program)).order('desc').take(20);
  return rows.find((r) => r.status === 'published' && r.effectiveFrom <= Date.now()) ?? null;
}

async function accept(ctx: MutationCtx, userId: Id<'users'>, termsVersionId: Id<'prgTermsVersions'>, program: 'creator' | 'trade' | 'referral') {
  const current = await currentTerms(ctx, program);
  if (!current || current._id !== termsVersionId) throw new CommerceError('INVALID_INPUT', 'These terms have been updated. Please review the current version.', 'These terms have been updated. Please review the current version.');
  return ctx.db.insert('prgTermsAcceptances', { userId, termsVersionId, acceptedAt: Date.now() });
}

/** Starts (or resumes) creator enrollment. A duplicate start returns the existing state without revealing other accounts. */
export const creatorStart = mutation({
  args: {},
  handler: async (ctx) => {
    requireFlag('CREATOR_ENROLLMENT_V2_ENABLED');
    const me = await requireUser(ctx);
    const existing = await membership(ctx, me.userId, 'creator');
    if (existing) return { state: existing.state };
    const user = await ctx.db.get(me.userId);
    const verified = typeof user?.emailVerificationTime === 'number' || !!user?.email; // OAuth sign-ins verify the address
    const now = Date.now();
    await ctx.db.insert('prgMemberships', { program: 'creator', userId: me.userId, state: verified ? 'profile' : 'email_unverified', createdAt: now, updatedAt: now });
    return { state: verified ? 'profile' : 'email_unverified' };
  },
});

export const creatorProfile = mutation({
  args: { displayName: v.string(), urls: v.array(v.string()), audience: v.optional(v.string()) },
  handler: async (ctx, a) => {
    requireFlag('CREATOR_ENROLLMENT_V2_ENABLED');
    const me = await requireUser(ctx);
    const m = await membership(ctx, me.userId, 'creator');
    if (!m || !['profile', 'terms', 'review'].includes(m.state)) throw new CommerceError('INVALID_INPUT', 'Start enrollment first.');
    const problems = profileProblems(a);
    if (problems.length) throw new CommerceError('INVALID_INPUT', problems.join(' '), problems[0]);
    await ctx.db.patch(m._id, { profile: { displayName: a.displayName.trim(), urls: a.urls.map((u) => u.trim()), ...(a.audience ? { audience: a.audience.slice(0, 200) } : {}) }, state: m.state === 'review' ? 'review' : 'terms', updatedAt: Date.now() });
    return { state: m.state === 'review' ? 'review' : 'terms' };
  },
});

/** Accepts the current creator and referral terms, runs the automated checks, then activates or sends to review. */
export const creatorAcceptTerms = mutation({
  args: { creatorTermsId: v.id('prgTermsVersions'), referralTermsId: v.id('prgTermsVersions') },
  handler: async (ctx, a) => {
    requireFlag('CREATOR_ENROLLMENT_V2_ENABLED');
    const me = await requireUser(ctx);
    const m = await membership(ctx, me.userId, 'creator');
    if (!m || m.state !== 'terms' || !m.profile) throw new CommerceError('INVALID_INPUT', 'Finish your profile first.');
    const acceptanceId = await accept(ctx, me.userId, a.creatorTermsId, 'creator');
    await accept(ctx, me.userId, a.referralTermsId, 'referral');
    const domain = me.email.split('@')[1] ?? '';
    const recent = await ctx.db.query('prgMemberships').withIndex('by_program_state', (q) => q.eq('program', 'creator')).order('desc').take(200);
    let sameDomain = 0;
    for (const r of recent) {
      if (r.createdAt < Date.now() - 86_400_000 || r._id === m._id) continue;
      const u = await ctx.db.get(r.userId);
      if (typeof u?.email === 'string' && u.email.toLowerCase().endsWith(`@${domain}`)) sameDomain++;
    }
    const flags = abuseFlags({ email: me.email, urls: m.profile.urls, duplicatePayoutIdentity: false, recentEnrollmentsFromSameDomain: sameDomain });
    const now = Date.now();
    if (flags.length) {
      await ctx.db.patch(m._id, { state: 'review', termsAcceptanceId: acceptanceId, reviewReasons: flags, updatedAt: now });
      return { state: 'review' };
    }
    const b = await ensureBeneficiary(ctx, me.userId, m.profile.displayName, me.email);
    await ctx.db.patch(m._id, { state: 'active', termsAcceptanceId: acceptanceId, beneficiaryId: b._id, updatedAt: now });
    await audit(ctx, { actor: me.email, action: 'creator.activate', entityTable: 'prgMemberships', entityId: m._id });
    return { state: 'active', refCode: b.refCode };
  },
});

/** An approved trade member turns on retail referrals in the same account (no second account). */
export const activateTradeReferrals = mutation({
  args: { referralTermsId: v.id('prgTermsVersions') },
  handler: async (ctx, a) => {
    requireFlag('CREATOR_ENROLLMENT_V2_ENABLED');
    const me = await requireUser(ctx);
    const trade = await membership(ctx, me.userId, 'trade');
    if (!trade || trade.state !== 'approved') throw new CommerceError('TRADE_APPROVAL_REQUIRED');
    if (trade.referralActivated) return { state: 'active' };
    await accept(ctx, me.userId, a.referralTermsId, 'referral');
    const b = await ensureBeneficiary(ctx, me.userId, me.profile?.businessName || me.profile?.displayName || '', me.email);
    await ctx.db.patch(trade._id, { referralActivated: true, beneficiaryId: b._id, updatedAt: Date.now() });
    await audit(ctx, { actor: me.email, action: 'trade.referrals_activated', entityTable: 'prgMemberships', entityId: trade._id });
    return { state: 'active', refCode: b.refCode };
  },
});

/** The signed-in person's programs: memberships, shared beneficiary tier and what's next. */
export const myPrograms = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return null;
    const creator = await membership(ctx, me.userId, 'creator');
    const trade = await membership(ctx, me.userId, 'trade');
    const b = await beneficiaryOf(ctx, me.userId);
    return {
      creator: creator ? { state: creator.state, reviewReasons: creator.state === 'review' ? ['We review some new accounts by hand; we will email you.'] : [] } : null,
      trade: trade ? { state: trade.state, referralActivated: !!trade.referralActivated } : null,
      beneficiary: b ? { tier: b.tierKey, refCode: b.refCode ?? null, payoutReadiness: b.payoutReadiness, status: b.status } : null,
      creatorTerms: await currentTerms(ctx, 'creator'),
      referralTerms: await currentTerms(ctx, 'referral'),
    };
  },
});

/** Admin decision on a creator held for review. */
export const reviewCreator = mutation({
  args: { userId: v.id('users'), approve: v.boolean(), note: v.string() },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const m = await membership(ctx, a.userId, 'creator');
    if (!m || m.state !== 'review') throw new CommerceError('INVALID_INPUT', 'Not awaiting review');
    if (a.approve) {
      const user = await ctx.db.get(a.userId);
      const b = await ensureBeneficiary(ctx, a.userId, m.profile?.displayName ?? '', typeof user?.email === 'string' ? user.email : '');
      await ctx.db.patch(m._id, { state: 'active', beneficiaryId: b._id, updatedAt: Date.now() });
    } else await ctx.db.patch(m._id, { state: 'closed', updatedAt: Date.now() });
    await audit(ctx, { actor: admin.email, action: a.approve ? 'creator.approve' : 'creator.reject', entityTable: 'prgMemberships', entityId: m._id, reason: a.note });
  },
});

/** Publishes a new terms version (the body is stored by hash; the text lives in the terms page). */
export const publishTerms = mutation({
  args: { program: v.union(v.literal('creator'), v.literal('trade'), v.literal('referral'), v.literal('privacy')), title: v.string(), bodyHash: v.string(), effectiveFrom: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const admin = await requireCjAdminIdentity(ctx);
    const latest = await ctx.db.query('prgTermsVersions').withIndex('by_program_version', (q) => q.eq('program', a.program)).order('desc').first();
    const id = await ctx.db.insert('prgTermsVersions', { program: a.program, version: (latest?.version ?? 0) + 1, title: a.title, bodyHash: a.bodyHash, effectiveFrom: a.effectiveFrom ?? Date.now(), status: 'published', createdAt: Date.now() });
    if (latest?.status === 'published') await ctx.db.patch(latest._id, { status: 'retired' });
    await audit(ctx, { actor: admin.email, action: 'terms.publish', entityTable: 'prgTermsVersions', entityId: id });
    return id;
  },
});

// ---------------- business team (owner-managed seats) ----------------
export const inviteMember = mutation({
  args: { organizationId: v.id('prgOrganizations'), email: v.string(), role: v.union(v.literal('purchasing'), v.literal('readonly')) },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    await requireOrgRole(ctx, a.organizationId, me.userId, ['owner']);
    const user = await ctx.db.query('users').withIndex('email', (q) => q.eq('email', a.email.trim().toLowerCase())).first();
    // Same message either way: never reveal whether someone else has an account.
    if (!user) return { status: 'invited' };
    const rows = await ctx.db.query('prgOrganizationMembers').withIndex('by_org', (q) => q.eq('organizationId', a.organizationId)).collect();
    if (rows.some((r) => r.userId === user._id && r.status !== 'removed')) return { status: 'invited' };
    await ctx.db.insert('prgOrganizationMembers', { organizationId: a.organizationId, userId: user._id, role: a.role, status: 'invited', invitedBy: me.userId, createdAt: Date.now() });
    await audit(ctx, { actor: me.email, action: 'org.invite', entityTable: 'prgOrganizations', entityId: a.organizationId, after: { role: a.role } });
    return { status: 'invited' };
  },
});

export const acceptInvite = mutation({
  args: { organizationId: v.id('prgOrganizations') },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    const rows = await ctx.db.query('prgOrganizationMembers').withIndex('by_user', (q) => q.eq('userId', me.userId).eq('status', 'invited')).collect();
    const row = rows.find((r) => r.organizationId === a.organizationId);
    if (!row) throw new CommerceError('FORBIDDEN');
    await ctx.db.patch(row._id, { status: 'active' });
  },
});

export const setMemberRole = mutation({
  args: { organizationId: v.id('prgOrganizations'), userId: v.id('users'), role: v.union(v.literal('purchasing'), v.literal('readonly'), v.literal('removed')) },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    await requireOrgRole(ctx, a.organizationId, me.userId, ['owner']);
    if (a.userId === me.userId) throw new CommerceError('INVALID_INPUT', 'Ownership changes go through our team.');
    const rows = await ctx.db.query('prgOrganizationMembers').withIndex('by_org', (q) => q.eq('organizationId', a.organizationId)).collect();
    const row = rows.find((r) => r.userId === a.userId && r.status !== 'removed');
    if (!row || row.role === 'owner') throw new CommerceError('FORBIDDEN');
    await ctx.db.patch(row._id, a.role === 'removed' ? { status: 'removed' } : { role: a.role });
    await audit(ctx, { actor: me.email, action: 'org.role', entityTable: 'prgOrganizations', entityId: a.organizationId, after: { userId: a.userId, role: a.role } });
  },
});

export const myOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewer(ctx);
    if (!me) return [];
    const seats = await ctx.db.query('prgOrganizationMembers').withIndex('by_user', (q) => q.eq('userId', me.userId).eq('status', 'active')).collect();
    return Promise.all(
      seats.map(async (s) => {
        const org = await ctx.db.get(s.organizationId);
        const members = s.role === 'owner' ? await ctx.db.query('prgOrganizationMembers').withIndex('by_org', (q) => q.eq('organizationId', s.organizationId)).collect() : [];
        return { organizationId: s.organizationId, name: org?.displayName ?? '', role: s.role, members: await Promise.all(members.filter((m) => m.status !== 'removed').map(async (m) => ({ userId: m.userId, role: m.role, status: m.status, email: ((await ctx.db.get(m.userId))?.email as string) ?? '' }))) };
      })
    );
  },
});
