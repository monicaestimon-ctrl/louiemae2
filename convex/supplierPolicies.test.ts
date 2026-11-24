// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const policy = { supplierCode: 'zuo', kind: 'media' as const, status: 'documented' as const,
  summary: 'Supplier authorizes product listing images.', evidenceRefs: ['Dealer packet, image usage section'], scope: { skus: ['A', 'B'] } };
beforeEach(() => {
  vi.stubEnv('CJ_ADMIN_EMAILS', 'owner@example.com,ops@example.com');
  vi.stubEnv('DELIVERY_ADMIN_ROLES', JSON.stringify({ 'owner@example.com': ['owner'], 'ops@example.com': ['operations'] }));
});
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t = convexTest(schema, modules);
  const [owner, ops] = await t.run(async ctx => Promise.all([
    ctx.db.insert('users', { email: 'owner@example.com' }), ctx.db.insert('users', { email: 'ops@example.com' }),
  ]));
  return { t, owner: t.withIdentity({ subject: `${owner}|s`, email: 'owner@example.com' }),
    ops: t.withIdentity({ subject: `${ops}|s`, email: 'ops@example.com' }) };
}

it('normalizes evidence and scope and retires the previous version regardless of SKU order', async () => {
  const { t, owner } = await fixture();
  const first = await owner.mutation(api.catPolicies.savePolicy, policy);
  expect(await t.run(ctx => ctx.db.query('catSuppliers').first())).toMatchObject({ publicAttributionAllowed: false });
  const second = await owner.mutation(api.catPolicies.savePolicy, {
    ...policy, supplierCode: ' ZUO ', summary: ' Updated policy ', evidenceRefs: [' letter ', '', 'letter'],
    scope: { all: false, skus: ['B', ' A ', 'A'] }, status: 'denied',
  });
  const active = await owner.query(api.catPolicies.policies, { supplierCode: 'zuo' });
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ _id: second, summary: 'Updated policy', evidenceRefs: ['letter'], scope: { skus: ['A', 'B'] }, status: 'denied' });
  expect((await t.run(ctx => ctx.db.get(first)))?.effectiveTo).toBeTypeOf('number');
  expect(await t.run(ctx => ctx.db.query('sysAuditEvents').collect())).toHaveLength(2);
});

it('rejects empty or ambiguous scopes and documented policies without evidence without writing', async () => {
  const { t, owner } = await fixture();
  for (const scope of [{}, { skus: [' '] }, { all: true, skus: ['A'] }]) {
    await expect(owner.mutation(api.catPolicies.savePolicy, { ...policy, scope })).rejects.toThrow();
  }
  await expect(owner.mutation(api.catPolicies.savePolicy, { ...policy, evidenceRefs: [' '] })).rejects.toThrow(/evidence/);
  await expect(owner.mutation(api.catPolicies.savePolicy, { ...policy, summary: ' ' })).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.query('catSupplierPolicies').collect())).toEqual([]);
});

it('requires an approver to save and staff authorization to read', async () => {
  const { t, owner, ops } = await fixture();
  await expect(t.mutation(api.catPolicies.savePolicy, policy)).rejects.toThrow();
  await expect(ops.mutation(api.catPolicies.savePolicy, policy)).rejects.toThrow();
  await owner.mutation(api.catPolicies.savePolicy, { ...policy, scope: { all: true } });
  expect(await ops.query(api.catPolicies.policies, { supplierCode: 'zuo' })).toHaveLength(1);
  await expect(t.query(api.catPolicies.policies, { supplierCode: 'zuo' })).rejects.toThrow();
  expect(await owner.query(api.catPolicies.policies, { supplierCode: 'ashcroft' })).toEqual([]);
});
