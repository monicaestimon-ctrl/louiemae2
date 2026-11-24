// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { convexTest } from 'convex-test';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const secret = 'whsec_local_fixture_only';
beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_local_fixture_only');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
  vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', '');
  vi.stubEnv('STRIPE_ALLOW_UNSIGNED_WEBHOOKS', 'false');
});
afterEach(() => vi.unstubAllEnvs());
const event = () => ({
  id: 'evt_refund_http',
  type: 'refund.failed',
  livemode: false,
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: 're_http',
      payment_intent: 'pi_http',
      charge: 'ch_http',
      status: 'failed',
      metadata: { private: 'must-not-persist' },
    },
  },
});
function signed(value: unknown) {
  const body = JSON.stringify(value),
    time = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${time}.${body}`).digest('hex');
  return { method: 'POST', body, headers: { 'stripe-signature': `t=${time},v1=${signature}` } };
}
it('requires a real valid fixture signature and durably stores only projected refund evidence once', async () => {
  const t = convexTest(schema, modules);
  expect(
    (await t.fetch('/stripe/webhook', { method: 'POST', body: JSON.stringify(event()) })).status
  ).toBe(400);
  const tampered = signed(event());
  tampered.body += ' ';
  expect((await t.fetch('/stripe/webhook', tampered)).status).toBe(400);
  for (let n = 0; n < 2; n++)
    expect((await t.fetch('/stripe/webhook', signed(event()))).status).toBe(200);
  const rows = await t.run((ctx) => ctx.db.query('sysPaymentEvents').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    status: 'processed',
    attempts: 1,
    payload: {
      id: 're_http',
      paymentIntentId: 'pi_http',
      chargeId: 'ch_http',
      status: 'failed',
      created: expect.any(Number),
    },
  });
  expect(rows[0].payload).not.toHaveProperty('metadata');
}, 15000);
it('ignores wrong-mode and connected-account refund events and payment reversals', async () => {
  const t = convexTest(schema, modules);
  for (const type of [
    'refund.updated',
    'refund.failed',
    'charge.refunded',
    'charge.dispute.created',
    'charge.dispute.closed',
  ]) {
    for (const scope of [{ livemode: true }, { account: 'acct_other', livemode: false }])
      expect(
        (await t.fetch('/stripe/webhook', signed({ ...event(), type, ...scope }))).status
      ).toBe(200);
  }
  expect(await t.run((ctx) => ctx.db.query('sysPaymentEvents').collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query('sysReviewItems').collect())).toHaveLength(0);
}, 15000);
