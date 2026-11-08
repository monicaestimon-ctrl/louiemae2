// One identity, two memberships (spec S05, S24, v2 §14). Helpers shared by enrollment, links,
// attribution, tiers and the ledger. A person has one login; a beneficiary (person or verified
// business) owns one payout identity and one shared retail-referral tier.
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { CommerceError } from '../lib/errors';

type Ctx = QueryCtx | MutationCtx;

export async function membership(ctx: Ctx, userId: Id<'users'>, program: 'creator' | 'trade') {
  return ctx.db.query('prgMemberships').withIndex('by_user_program', (q) => q.eq('userId', userId).eq('program', program)).first();
}

/** The beneficiary a user earns through (their own, or the one their memberships point at). */
export async function beneficiaryOf(ctx: Ctx, userId: Id<'users'>) {
  const own = await ctx.db.query('prgBeneficiaries').withIndex('by_user', (q) => q.eq('userId', userId)).first();
  if (own) return own;
  return ctx.db.query('prgBeneficiaries').withIndex('by_legacy_user', (q) => q.eq('legacyUserId', userId)).first();
}

function makeCode(seed: string) {
  const letters = seed.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'HOUSE';
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return `${letters}${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)), (b) => abc[b % abc.length]).join('')}`;
}

/**
 * Creates (once) the beneficiary for a user and mirrors partner status onto the legacy profile so
 * the existing Hub, links and payouts keep working while v2 rolls out.
 */
export async function ensureBeneficiary(ctx: MutationCtx, userId: Id<'users'>, displayName: string, email: string) {
  const existing = await beneficiaryOf(ctx, userId);
  if (existing) return existing;
  const profile = await ctx.db.query('holmProfiles').withIndex('by_user', (q) => q.eq('userId', userId)).unique();
  let code = profile?.refCode ?? makeCode(displayName || email);
  for (let i = 0; i < 5 && !profile?.refCode; i++) {
    const taken = await ctx.db.query('holmProfiles').withIndex('by_refCode', (q) => q.eq('refCode', code)).first();
    if (!taken) break;
    code = makeCode(email);
  }
  const now = Date.now();
  const tier = profile?.partnerTier ?? 'base';
  const id = await ctx.db.insert('prgBeneficiaries', {
    kind: 'person',
    userId,
    legacyUserId: userId,
    displayName,
    ...(profile?.stripeAccountId ? { payoutAccountRef: profile.stripeAccountId } : {}),
    payoutReadiness: profile?.payoutsReady ? 'ready' : profile?.stripeAccountId ? 'pending' : 'not_started',
    taxReadiness: profile?.w9Status === 'approved' ? 'approved' : profile?.w9Status === 'pending' ? 'pending' : 'none',
    tierKey: tier,
    refCode: code,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  const legacy = { partnerStatus: 'active' as const, partnerTier: tier, refCode: code, updatedAt: now };
  if (profile) await ctx.db.patch(profile._id, legacy);
  else await ctx.db.insert('holmProfiles', { userId, displayName: displayName || email.split('@')[0] || 'Member', tradeStatus: 'none', createdAt: now, ...legacy });
  if (!profile?.partnerStatus) await ctx.db.insert('holmTierChanges', { partnerId: userId, tier, at: now, reason: 'joined' });
  return (await ctx.db.get(id))!;
}

const TRADE_STATE: Record<Doc<'holmProfiles'>['tradeStatus'], string | null> = { none: null, pending: 'review', approved: 'approved', rejected: 'rejected', needs_info: 'needs_info' };

/**
 * Keeps the trade membership (and, on approval, its organization and owner seat) in step with the
 * existing trade application review. Similar business names never merge organizations.
 */
export async function syncTrade(ctx: MutationCtx, userId: Id<'users'>, status: Doc<'holmProfiles'>['tradeStatus'], businessName?: string) {
  const state = TRADE_STATE[status];
  if (!state) return;
  const now = Date.now();
  let m = await membership(ctx, userId, 'trade');
  let organizationId = m?.organizationId;
  if (status === 'approved' && !organizationId && businessName?.trim()) {
    const existing = await ctx.db.query('prgOrganizations').withIndex('by_legacy_owner', (q) => q.eq('legacyOwnerUserId', userId)).first();
    organizationId = existing?._id ?? (await ctx.db.insert('prgOrganizations', { legalName: businessName.trim(), displayName: businessName.trim(), verification: 'verified', verifiedAt: now, legacyOwnerUserId: userId, createdAt: now }));
    if (!existing) await ctx.db.insert('prgOrganizationMembers', { organizationId, userId, role: 'owner', status: 'active', createdAt: now });
  }
  if (m) await ctx.db.patch(m._id, { state, ...(organizationId ? { organizationId } : {}), updatedAt: now });
  else {
    const id = await ctx.db.insert('prgMemberships', { program: 'trade', userId, ...(organizationId ? { organizationId } : {}), state, createdAt: now, updatedAt: now });
    m = await ctx.db.get(id);
  }
  return m;
}

/** Org role check for business buyers: owner, purchasing member or read-only collaborator. */
export async function orgRole(ctx: Ctx, organizationId: Id<'prgOrganizations'>, userId: Id<'users'>) {
  const rows = await ctx.db.query('prgOrganizationMembers').withIndex('by_user', (q) => q.eq('userId', userId).eq('status', 'active')).collect();
  return rows.find((r) => r.organizationId === organizationId)?.role ?? null;
}

export async function requireOrgRole(ctx: Ctx, organizationId: Id<'prgOrganizations'>, userId: Id<'users'>, roles: readonly ('owner' | 'purchasing' | 'readonly')[]) {
  const role = await orgRole(ctx, organizationId, userId);
  if (!role || !roles.includes(role)) throw new CommerceError('FORBIDDEN');
  return role;
}

/** Whether a user may earn referral rewards (active creator, or approved trade with referral terms). */
export async function referralActive(ctx: Ctx, userId: Id<'users'>) {
  const creator = await membership(ctx, userId, 'creator');
  if (creator?.state === 'active') return 'creator' as const;
  const trade = await membership(ctx, userId, 'trade');
  if (trade?.state === 'approved' && trade.referralActivated) return 'trade' as const;
  return null;
}
