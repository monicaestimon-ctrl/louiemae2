// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { randomBytes } from 'node:crypto';
import schema from './schema';
import { api, internal } from './_generated/api';
import { signRequest } from '../lib/delivery/requestProof';
import { commerceErrorData } from '../lib/errors';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const secret = '1'.repeat(64);
const input = {
  lines: [{ productId: 'fixture', variantId: 'fixture', packs: 1 }],
  channel: 'retail' as const,
  zip: '95206',
  visitorKey: 'fixture',
};
const sign = (body = input, extra = {}) =>
  signRequest(secret, 'estimate', body, {
    issuedAt: Date.now(),
    nonce: randomBytes(24).toString('hex'),
    rateKey: '2'.repeat(64),
    ...extra,
  });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.stubEnv('DELIVERY_REQUEST_SECRET', secret);
  vi.stubEnv('DELIVERY_AUTOMATION_ENABLED', 'false');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('trusted delivery perimeter', { timeout: 20000 }, () => {
  it('rejects unsigned, altered, expired, future and cross-operation proofs without creating state', async () => {
    const t = convexTest(schema, modules);
    for (const proof of [
      undefined,
      await sign({ ...input, zip: '10001' }),
      await sign(input, { issuedAt: Date.now() - 61000 }),
      await sign(input, { issuedAt: Date.now() + 6000 }),
      await signRequest(secret, 'quote', input, {
        issuedAt: Date.now(),
        nonce: randomBytes(24).toString('hex'),
        rateKey: '2'.repeat(64),
      }),
    ]) {
      const error = await t
        .action(api.dlvTaxActions.estimate, { ...input, ...(proof ? { proof } : {}) })
        .catch((e) => e);
      expect(commerceErrorData(error)?.code).toBe('FORBIDDEN');
    }
    expect(await t.run((ctx) => ctx.db.query('dlvRequestLimits').collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('dlvObservations').collect())).toEqual([]);
  });
  it('commits limits even when calculation fails, across changed carts, ZIPs and visitor strings', async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 31; i++) {
      const body = {
        ...input,
        zip: i % 2 ? '10001' : '95206',
        visitorKey: `rotated-${i}`,
        lines: [{ productId: `different-${i}`, variantId: 'fixture', packs: 1 }],
      };
      const error = await t
        .action(api.dlvTaxActions.estimate, { ...body, proof: await sign(body) })
        .catch((e) => e);
      expect(commerceErrorData(error)?.code).toBe(i < 30 ? 'FEATURE_DISABLED' : 'RATE_LIMITED');
    }
    expect(await t.run((ctx) => ctx.db.query('dlvEstimates').collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('dlvObservations').collect())).toHaveLength(30);
    expect(await t.run((ctx) => ctx.db.query('dlvRequestPermits').collect())).toHaveLength(30);
  });
  it('allows a permit only once, fails closed without configuration and purges only expired request metadata', async () => {
    const t = convexTest(schema, modules);
    const proof = await sign();
    const args = { operation: 'estimate' as const, input, proof };
    expect(await t.mutation(internal.dlvPerimeter.consume, args)).toBe('ok');
    expect(await t.mutation(internal.dlvPerimeter.consume, args)).toBe('forbidden');
    vi.stubEnv('DELIVERY_REQUEST_SECRET', '');
    expect(await t.mutation(internal.dlvPerimeter.consume, { ...args, proof: await sign() })).toBe(
      'forbidden'
    );
    await t.run(async (ctx) => {
      await ctx.db.insert('dlvRequestPermits', { nonce: 'expired', expiresAt: Date.now() - 1 });
      await ctx.db.insert('dlvRequestLimits', {
        key: 'expired',
        tokens: 0,
        refilledAt: 0,
        expiresAt: 0,
      });
    });
    await t.mutation(internal.dlvPerimeter.purge, {});
    expect(await t.run((ctx) => ctx.db.query('dlvRequestPermits').collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query('dlvRequestLimits').collect())).toHaveLength(2);
  });
});
