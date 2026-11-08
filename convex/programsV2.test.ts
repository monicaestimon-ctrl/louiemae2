// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { snapshotForIntent } from './prgAttribution';
import { recompute } from './prgTiers';
import { isCommerceError } from '../lib/errors';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ADMIN = 'owner@louiemae.com';
const FLAGS = ['CREATOR_ENROLLMENT_V2_ENABLED', 'RETAIL_LINK_GENERATION_V2_ENABLED', 'ATTRIBUTION_V2_ENABLED', 'HOLM_TRADE_ONLY_ENABLED'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  process.env.CJ_ADMIN_EMAILS = ADMIN;
  for (const f of FLAGS) process.env[f] = 'true';
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CJ_ADMIN_EMAILS;
  for (const f of FLAGS) delete process.env[f];
});

async function setup() {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) => ctx.db.insert('users', { email: ADMIN }));
  const admin = t.withIdentity({ subject: `${adminId}|s`, email: ADMIN });
  await t.mutation(internal.sysConfig.seed, {});
  const creatorTerms = await admin.mutation(api.prgMemberships.publishTerms, { program: 'creator', title: 'Creator Program terms', bodyHash: 'c1' });
  const referralTerms = await admin.mutation(api.prgMemberships.publishTerms, { program: 'referral', title: 'Retail referral terms', bodyHash: 'r1' });
  const user = async (email: string) => {
    const id = await t.run((ctx) => ctx.db.insert('users', { email, emailVerificationTime: 1 }));
    return { id, as: t.withIdentity({ subject: `${id}|s`, email }) };
  };
  return { t, admin, creatorTerms, referralTerms, user };
}

async function approveConfig(s: Awaited<ReturnType<typeof setup>>, key: string, value?: unknown) {
  if (value !== undefined) await s.admin.mutation(api.sysConfig.propose, { kind: key === 'attribution' ? 'attributionPolicy' : key === 'tier-policy' ? 'tierPolicy' : 'commissionSchedule', key, value, note: 'test' });
  const { records } = await s.admin.query(api.sysConfig.list, { status: 'proposed' });
  const rec = records.filter((r) => r.key === key).sort((a, b) => b.version - a.version)[0];
  await s.admin.mutation(api.sysConfig.approve, { id: rec._id });
}

async function enrollCreator(s: Awaited<ReturnType<typeof setup>>, as: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['user']>>['as']) {
  await as.mutation(api.prgMemberships.creatorStart, {});
  await as.mutation(api.prgMemberships.creatorProfile, { displayName: 'Ava Home', urls: ['https://instagram.com/avahome'] });
  return as.mutation(api.prgMemberships.creatorAcceptTerms, { creatorTermsId: s.creatorTerms, referralTermsId: s.referralTerms });
}

describe('one identity, two memberships (S24, ACC01)', () => {
  it('shares one beneficiary and tier between creator and trade referrals, with no second account', async () => {
    const s = await setup();
    const u = await s.user('ava@studio.com');
    const r = await enrollCreator(s, u.as);
    expect(r.state).toBe('active');
    // trade application approved through the existing review
    await u.as.mutation(api.holm.applyTrade, { businessType: 'design', businessName: 'Ava Studio LLC', state: 'CA', ein: '12-3456789', website: 'https://ava.studio', credential: 'ASID 123', taxRequested: false });
    const app = (await s.t.run((ctx) => ctx.db.query('holmTradeApplications').first()))!;
    await s.admin.mutation(api.holm.reviewApplication, { id: app._id, decision: 'approved' });
    await u.as.mutation(api.prgMemberships.activateTradeReferrals, { referralTermsId: s.referralTerms });
    const programs = await u.as.query(api.prgMemberships.myPrograms, {});
    expect(programs).toMatchObject({ creator: { state: 'active' }, trade: { state: 'approved', referralActivated: true }, beneficiary: { tier: 'base' } });
    expect(await s.t.run((ctx) => ctx.db.query('prgBeneficiaries').collect())).toHaveLength(1);
    const orgs = await u.as.query(api.prgMemberships.myOrganizations, {});
    expect(orgs[0]).toMatchObject({ name: 'Ava Studio LLC', role: 'owner' });
    const profile = await s.t.run((ctx) => ctx.db.query('holmProfiles').filter((q) => q.eq(q.field('userId'), u.id)).first());
    expect(profile).toMatchObject({ partnerStatus: 'active', tradeStatus: 'approved', refCode: r.refCode });
    // a duplicate start resolves to the existing membership
    expect(await u.as.mutation(api.prgMemberships.creatorStart, {})).toEqual({ state: 'active' });
  });

  it('sends suspicious enrollments to review, versioned terms are required, and the legacy join is closed', async () => {
    const s = await setup();
    const u = await s.user('x@mailinator.com');
    await u.as.mutation(api.prgMemberships.creatorStart, {});
    await u.as.mutation(api.prgMemberships.creatorProfile, { displayName: 'X', urls: ['https://bit.ly/x'] }).catch(() => undefined);
    await u.as.mutation(api.prgMemberships.creatorProfile, { displayName: 'Xavier', urls: ['https://bit.ly/x'] });
    await expect(u.as.mutation(api.prgMemberships.creatorAcceptTerms, { creatorTermsId: s.referralTerms, referralTermsId: s.referralTerms })).rejects.toThrow();
    expect((await u.as.mutation(api.prgMemberships.creatorAcceptTerms, { creatorTermsId: s.creatorTerms, referralTermsId: s.referralTerms })).state).toBe('review');
    await s.admin.mutation(api.prgMemberships.reviewCreator, { userId: u.id, approve: true, note: 'checked' });
    expect((await u.as.query(api.prgMemberships.myPrograms, {}))!.creator!.state).toBe('active');
    await expect(u.as.mutation(api.holmPartners.join, { acceptTerms: true })).rejects.toSatisfy((e) => isCommerceError(e, 'FEATURE_DISABLED'));
  });
});

describe('trade-only HOLM (S25, ACC02)', () => {
  it('denies non-trade quote requests without leaking pricing', async () => {
    const s = await setup();
    const u = await s.user('retail@x.com');
    await expect(
      u.as.mutation(api.holm.requestQuote, {
        token: 'tok-abcdefghijklmnopqrstu',
        projectName: 'Home',
        name: 'Retail Buyer',
        email: 'retail@x.com',
        phone: '',
        business: '',
        address: { line1: '1 Main', city: 'X', state: 'CA', postalCode: '95206', country: 'US' },
        timing: 'asap',
        date: '',
        receiving: 'threshold',
        notes: '',
        website: '',
        items: [],
      })
    ).rejects.toSatisfy((e) => isCommerceError(e, 'TRADE_APPROVAL_REQUIRED'));
    expect(await s.t.run((ctx) => ctx.db.query('commerceProjects').collect())).toHaveLength(0);
  });
});

async function linkFixture(s: Awaited<ReturnType<typeof setup>>) {
  return s.t.run(async (ctx) => {
    const draft = { name: 'Beckett bench', description: '', category: 'bench', images: [], referenceImages: [], sourceUrl: '', supplierName: '', supplierContact: '', facts: '', packaging: '', currency: 'USD', usdRate: 1, variants: [], conflicts: [], factsApproved: true, imagesApproved: true, referencePermission: true };
    const retailId = await ctx.db.insert('commerceProducts', { provider: 'ashcroft', sourceKey: 'ashcroft:bench', draft, revision: 1, updatedAt: 1 });
    const houseId = await ctx.db.insert('commerceProducts', { provider: 'owner_managed', sourceKey: 'om:bench', draft, revision: 1, updatedAt: 1 });
    const snapshot = { name: 'Beckett bench', description: '', category: 'bench', images: [], facts: '', variants: [{ id: 'v1', name: 'Default Title', minimum: 1, increment: 1, price: 60_000 }] };
    await ctx.db.insert('commerceListings', { productId: retailId, channel: 'retail', published: true, revision: 1, updatedAt: 1, snapshot });
    await ctx.db.insert('commerceListings', { productId: houseId, channel: 'house', published: true, revision: 1, updatedAt: 1, snapshot: { ...snapshot, variants: [{ ...snapshot.variants[0], id: 'h1' }] } });
    const supplierId = await ctx.db.insert('catSuppliers', { code: 'ashcroft', name: 'Ashcroft', publicAttributionAllowed: false, fulfillmentRoute: 'manual_dealer_ashcroft', freshnessKey: 'freshness-default', createdAt: 1 });
    const variantId = await ctx.db.insert('catVariants', { productId: retailId, supplierId, supplierSku: 'BEN1', packId: '1', optionKey: 'v1', supplierVariantName: 'x', louieMaeVariantName: 'x', piecesPerPack: 1, orderMinimumPacks: 1, orderIncrementPacks: 1, availability: 'in_stock', fulfillmentRoute: 'manual_dealer_ashcroft', holds: [], referralEligible: true, legacyVariantId: 'v1', createdAt: 1, updatedAt: 1 });
    await ctx.db.insert('catProductMeta', { productId: retailId, commissionCategory: 'furniture', navCategory: 'bench', louieMaeName: 'Beckett bench', slug: 'beckett', slugHistory: [], supplierName: 'x', holds: [], stage: 'published', createdAt: 1, updatedAt: 1 });
    return { retailId, houseId, variantId };
  });
}

describe('retail links and attribution (S26, S27, REF01–REF03)', () => {
  it('builds a Louie Mae link from a HOLM variant through its mapping, and refuses unmapped pieces', async () => {
    const s = await setup();
    const fx = await linkFixture(s);
    const u = await s.user('ava@studio.com');
    await enrollCreator(s, u.as);
    await expect(u.as.mutation(api.prgLinks.create, { productId: fx.houseId, variantId: 'h1', channelTag: 'story' })).rejects.toSatisfy((e) => isCommerceError(e, 'REFERRAL_INELIGIBLE'));
    await s.admin.mutation(api.prgLinks.createMapping, { holmProductId: fx.houseId, holmVariantId: 'h1', retailProductId: fx.retailId, retailVariantId: 'v1' });
    const link = await u.as.mutation(api.prgLinks.create, { productId: fx.houseId, variantId: 'h1', channelTag: 'story' });
    expect(link.url).toMatch(/^https:\/\/www\.louiemae\.com\/r\/[a-z0-9]+$/);
    expect(link).toMatchObject({ applicableRateBps: 1000, category: 'furniture', eligibility: 'eligible' });
    const dest = await s.t.query(api.prgLinks.resolve, { linkId: link.linkId });
    expect(dest).toMatchObject({ kind: 'product', productId: fx.retailId, variantId: 'v1', collection: 'furniture' });
    await expect(u.as.mutation(api.prgLinks.create, { path: '//evil.com', channelTag: 'link' })).rejects.toThrow();
  });

  it('credits the last eligible click, blocks self-referral and protects the click-time rate', async () => {
    const s = await setup();
    await approveConfig(s, 'attribution');
    const fx = await linkFixture(s);
    const a = await s.user('a@x.com');
    const b = await s.user('b@x.com');
    await enrollCreator(s, a.as);
    await enrollCreator(s, b.as);
    const linkA = await a.as.mutation(api.prgLinks.create, { productId: fx.retailId, variantId: 'v1', channelTag: 'pin' });
    const linkB = await b.as.mutation(api.prgLinks.create, { productId: fx.retailId, variantId: 'v1', channelTag: 'pin' });
    const visitor = 'visitor-abcdefghijkl';
    const ua = 'Mozilla/5.0';
    await s.t.mutation(api.prgAttribution.recordClick, { linkId: linkA.linkId, visitorKey: visitor, userAgent: ua, consent: 'granted' });
    vi.setSystemTime(Date.now() + 1000);
    await s.t.mutation(api.prgAttribution.recordClick, { linkId: linkB.linkId, visitorKey: visitor, userAgent: ua, consent: 'granted' });
    // bots and denied consent never win
    vi.setSystemTime(Date.now() + 2000);
    expect((await s.t.mutation(api.prgAttribution.recordClick, { linkId: linkA.linkId, visitorKey: visitor, userAgent: 'Slackbot', consent: 'granted' })).eligible).toBe(false);
    const line = { lineKey: 'l1', productId: fx.retailId, variantId: fx.variantId, category: 'furniture' as const };
    const intentId = await s.t.run(async (ctx) => ctx.db.insert('ordCheckoutIntents', { idempotencyKey: 'k', estimateId: await ctx.db.insert('dlvEstimates', { channel: 'retail', destination: { zip: '95206', precision: 'zip' }, service: 'curbside', lines: [], groups: [], status: 'ok', merchandiseMinor: 0, discountMinor: 0, creditMinor: 0, expiresAt: 0, cartHash: '', sourceVersionsHash: '', internal: {}, createdAt: 0 }), cartHash: '', channel: 'retail', buyer: {}, lineSnapshot: [], merchandiseMinor: 0, deliveryMinor: 0, taxMinor: 0, creditMinor: 0, totalMinor: 0, status: 'created', expiresAt: 0, createdAt: 0 }));
    const snapId = await s.t.run((ctx) => snapshotForIntent(ctx, { intentId, visitorKey: visitor, buyer: {}, channel: 'retail', lines: [line] }));
    const snap = await s.t.run((ctx) => ctx.db.get(snapId!));
    const benB = await s.t.run((ctx) => ctx.db.query('prgBeneficiaries').withIndex('by_user', (q) => q.eq('userId', b.id)).first());
    expect(snap!.beneficiaryId).toBe(benB!._id);
    expect(snap!.lines[0]).toMatchObject({ protectedRateBps: 1000, currentRateBps: 1000, appliedRateBps: 1000, eligible: true });
    // the partner buying through their own link gets no attribution
    const self = await s.t.run((ctx) => snapshotForIntent(ctx, { intentId, visitorKey: visitor, buyer: { userId: b.id }, channel: 'retail', lines: [line] }));
    expect(self).toBeNull();
    // a rate reduction after the click: the protected rate is honored; trade checkouts get nothing
    await approveConfig(s, 'commission-schedule', { ceilingBps: 2300, tiers: [{ key: 'base', minMinor: 0, rates: { furniture: 700, decor: 600, clothing: 400 } }, { key: 'active', minMinor: 1_500_000, rates: { furniture: 1200, decor: 900, clothing: 600 } }, { key: 'top', minMinor: 5_000_000, rates: { furniture: 1500, decor: 1000, clothing: 700 } }, { key: 'elite', minMinor: 10_000_000, rates: { furniture: 1800, decor: 1200, clothing: 800 } }] });
    const reduced = await s.t.run(async (ctx) => ctx.db.get((await snapshotForIntent(ctx, { intentId, visitorKey: visitor, buyer: {}, channel: 'retail', lines: [line] }))!));
    expect(reduced!.lines[0]).toMatchObject({ protectedRateBps: 1000, currentRateBps: 700, appliedRateBps: 1000 });
    expect(await s.t.run((ctx) => snapshotForIntent(ctx, { intentId, visitorKey: visitor, buyer: {}, channel: 'trade', lines: [line] }))).toBeNull();
    // after exactly 30 days the click no longer counts
    vi.setSystemTime(Date.now() + 30 * 86_400_000);
    expect(await s.t.run((ctx) => snapshotForIntent(ctx, { intentId, visitorKey: visitor, buyer: {}, channel: 'retail', lines: [line] }))).toBeNull();
  });
});

describe('tiers v2 (S28, REF04)', () => {
  it('waits for the tier policy decision, then computes tiers from obligations without rewriting earned rates', async () => {
    const s = await setup();
    const u = await s.user('ava@studio.com');
    await enrollCreator(s, u.as);
    const ben = (await s.t.run((ctx) => ctx.db.query('prgBeneficiaries').first()))!;
    expect(await s.t.run((ctx) => recompute(ctx, ben._id, 'event', 'w0'))).toBeNull(); // D-06 pending
    await approveConfig(s, 'tier-policy');
    const now = Date.now();
    const earn = (basis: number, rate: number) =>
      s.t.run((ctx) => ctx.db.insert('ldgObligations', { beneficiaryId: ben._id, source: 'retail_order', rateBps: rate, basisMinor: basis, earnedMinor: Math.floor((basis * rate) / 10_000), reversedMinor: 0, heldMinor: 0, refundedBasisMinor: 0, state: 'pending', paidAt: now, clearsAt: now, currency: 'USD', createdAt: now, updatedAt: now }));
    const first = await earn(1_499_999, 1000);
    expect((await s.t.run((ctx) => recompute(ctx, ben._id, 'event', 'w1')))!.tier).toBe('base');
    await earn(1, 1000); // the crossing purchase was paid at the pre-purchase rate
    expect((await s.t.run((ctx) => recompute(ctx, ben._id, 'event', 'w2')))!.tier).toBe('active');
    expect((await s.t.run((ctx) => ctx.db.get(first)))!.rateBps).toBe(1000);
    const profile = await s.t.run((ctx) => ctx.db.query('holmProfiles').filter((q) => q.eq(q.field('userId'), u.id)).first());
    expect(profile!.partnerTier).toBe('active');
    // a refund reduces qualifying sales; the downgrade waits for the next quarter (Nov 3 rule)
    await s.t.run((ctx) => ctx.db.patch(first, { refundedBasisMinor: 1_000_000 }));
    expect((await s.t.run((ctx) => recompute(ctx, ben._id, 'event', 'w3')))!.tier).toBe('active');
    const tier = await u.as.query(api.prgTiers.myTier, {});
    expect(tier).toMatchObject({ tier: 'active', next: 'top' });
  });
});
