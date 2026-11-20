// @vitest-environment node
/// <reference types="vite/client" />
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { shouldAllowUnsignedStripeWebhook } from '../lib/stripeWebhook';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  process.env.CJ_ADMIN_EMAILS = 'owner@louiemae.com';
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CJ_ADMIN_EMAILS;
  delete process.env.PARTNER_PAYOUTS_ENABLED;
  delete process.env.PAYOUT_EXECUTION_ENABLED;
});

// v2 modules: every public function must authenticate (or be deliberately public).
const V2_FILES = ['sysConfig', 'sysNotifyAdmin', 'dlvTelemetry', 'zuoImport', 'catCategories', 'catPricing', 'catPolicies', 'catMedia', 'catStock', 'catPublication', 'dlvEstimates', 'dlvAccess', 'dlvAdmin', 'dlvOperations', 'dlvTax', 'dlvTaxActions', 'dlvTaxExemptions', 'dlvTradeCalculator', 'ordFulfillment', 'ordReceipts', 'ordQuotes', 'ordReturns', 'ediZuo', 'prgMemberships', 'prgLinks', 'prgAttribution', 'prgTiers', 'ldgCommissions', 'ldgPayouts', 'ldgCredits', 'v2Admin', 'sysAlerts'];
const AUTH = /ownsOrder\(|requireDeliveryRole|authorizeEstimate|owns\(|handler:\s*access|requireCjAdminIdentity|verifyCjAdminIdentity|requireUser\(|viewer\(|requireFlag\(|flag\('/;
// Deliberately public: read-only, customer-safe projections or flag-gated anonymous actions.
const PUBLIC = new Set(['dlvEstimates.enabled', 'dlvTaxActions.estimate', 'dlvTaxActions.requestQuote', 'dlvEstimates.get', 'catMedia.resolveSlug', 'prgLinks.resolve', 'v2Admin.publicFlags', 'v2Admin.programTermsView']);

describe('security (S38, SEC01)', () => {
  it('every exported public v2 function authenticates or is on the reviewed public list', () => {
    const problems: string[] = [];
    for (const file of V2_FILES) {
      const src = fs.readFileSync(path.join(process.cwd(), 'convex', `${file}.ts`), 'utf8');
      const re = /export const (\w+) = (mutation|query|action)\(\{([\s\S]*?)\n\}\);/g;
      for (const m of src.matchAll(re)) {
        const name = `${file}.${m[1]}`;
        if (PUBLIC.has(name)) continue;
        if (!AUTH.test(m[3])) problems.push(name);
      }
    }
    expect(problems).toEqual([]);
  });

  it('admin consoles and ledgers refuse signed-out and non-admin callers', async () => {
    const t = convexTest(schema, modules);
    const uid = await t.run((ctx) => ctx.db.insert('users', { email: 'partner@x.com' }));
    const user = t.withIdentity({ subject: `${uid}|s`, email: 'partner@x.com' });
    for (const call of [
      () => user.query(api.v2Admin.reviewQueue, {}),
      () => user.query(api.v2Admin.openHolds, {}),
      () => user.query(api.v2Admin.beneficiaries, {}),
      () => user.query(api.sysAlerts.health, {}),
      () => user.query(api.ldgPayouts.adminRuns, {}),
      () => user.query(api.sysConfig.list, {}),
      () => user.query(api.dlvAdmin.coverage, {}),
      () => user.query(api.dlvTax.reportingQueue, {}),
      () => user.query(api.sysNotifyAdmin.reviewQueue, {status:'failed',paginationOpts:{numItems:20,cursor:null}}),
      () => user.query(api.dlvTaxExemptions.list, {}),
      () => user.query(api.dlvOperations.queue, {paginationOpts:{numItems:20,cursor:null}}),
      () => t.query(api.ldgCommissions.myEarnings, {}),
    ])
      await expect(call()).rejects.toThrow();
  });

  it('a partner sees only their own earnings', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const a = await ctx.db.insert('users', { email: 'a@x.com' });
      const b = await ctx.db.insert('users', { email: 'b@x.com' });
      const benB = await ctx.db.insert('prgBeneficiaries', { kind: 'person', userId: b, displayName: 'B', payoutReadiness: 'not_started', taxReadiness: 'none', tierKey: 'base', status: 'active', createdAt: 0, updatedAt: 0 });
      await ctx.db.insert('ldgObligations', { beneficiaryId: benB, source: 'retail_order', rateBps: 1000, basisMinor: 10_000, earnedMinor: 1_000, reversedMinor: 0, heldMinor: 0, refundedBasisMinor: 0, state: 'cleared', clearsAt: 0, currency: 'USD', createdAt: 0, updatedAt: 0 });
      return { a };
    });
    const asA = t.withIdentity({ subject: `${ids.a}|s`, email: 'a@x.com' });
    expect(await asA.query(api.ldgCommissions.myEarnings, {})).toBeNull();
  });

  it('never accepts unsigned webhooks with live keys', () => {
    expect(shouldAllowUnsignedStripeWebhook({ STRIPE_ALLOW_UNSIGNED_WEBHOOKS: 'true', NODE_ENV: 'test' })).toBe(true);
    expect(shouldAllowUnsignedStripeWebhook({ STRIPE_ALLOW_UNSIGNED_WEBHOOKS: 'true', NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_live_abc' })).toBe(false);
    expect(shouldAllowUnsignedStripeWebhook({ STRIPE_ALLOW_UNSIGNED_WEBHOOKS: 'true', NODE_ENV: 'production' })).toBe(false);
  });
});

describe('monitoring (S39)', () => {
  it('alerts on a webhook backlog, both payout routes on, and paid-order exceptions — once per key', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('sysPaymentEvents', { provider: 'stripe', eventId: 'evt_old', type: 'checkout.session.completed', livemode: false, payloadHash: 'h', payload: {}, receivedAt: Date.now() - 20 * 60_000, status: 'received', attempts: 0 });
      await ctx.db.insert('ordPaidExceptions', { reason: 'intent_expired', evidence: {}, status: 'open', createdAt: Date.now() });
    });
    process.env.PARTNER_PAYOUTS_ENABLED = 'true';
    process.env.PAYOUT_EXECUTION_ENABLED = 'true';
    expect(await t.mutation(internal.sysAlerts.check, {})).toBe(3);
    await t.mutation(internal.sysAlerts.check, {});
    const alerts = await t.run((ctx) => ctx.db.query('sysReviewItems').collect());
    expect(alerts.map((a) => a.entityId).sort()).toEqual(['paid_exceptions_open', 'payout_route_conflict', 'webhook_backlog']);
    const mails = await t.run((ctx) => ctx.db.query('sysNotifications').collect());
    expect(mails).toHaveLength(3);
  });
});
