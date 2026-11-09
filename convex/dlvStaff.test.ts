// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
import { commerceErrorData } from '../lib/errors';
import { deliveryStaffRoles } from '../lib/delivery/staffRoles';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
afterEach(() => vi.unstubAllEnvs());
async function setup(role: string) {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) => ctx.db.insert('users', { email: 'staff@example.com' }));
  vi.stubEnv('CJ_ADMIN_EMAILS', 'staff@example.com');
  vi.stubEnv('DELIVERY_ADMIN_ROLES', JSON.stringify({ 'staff@example.com': [role] }));
  return { t, staff: t.withIdentity({ subject: `${id}|fixture`, email: 'staff@example.com' }) };
}
const forbidden = async (work: Promise<unknown>) => {
  expect(commerceErrorData(await work.catch((e) => e))?.code).toBe('FORBIDDEN');
};
describe('delivery staff authorization', () => {
  it('does not let support regain owner privileges through legacy or general admin APIs', async () => {
    const { staff } = await setup('support');
    expect(await staff.query(api.cjAdminAccess.session, {})).toEqual({
      owner: false,
      delivery: true,
    });
    expect(await staff.query(api.dlvAccess.supportQueue, {})).toEqual([]);
    for (const call of [
      () => staff.query(api.v2Admin.reviewQueue, {}),
      () => staff.query(api.v2Admin.beneficiaries, {}),
      () => staff.query(api.sysAlerts.health, {}),
      () => staff.query(api.sysConfig.list, {}),
      () => staff.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_zuo' }),
      () => staff.mutation(api.catPricing.recomputeVariants, { variantIds: [] }),
      () => staff.query(api.blogPosts.listAdmin, {}),
      () => staff.query(api.campaigns.list, {}),
      () => staff.query(api.dlvAccess.integrations, {}),
      () => staff.query(api.dlvAdmin.records, { paginationOpts: { cursor: null, numItems: 20 } }),
    ])
      await forbidden(call());
  });
  it('allows operations handoff while reserving economics for finance and publications for approvers', async () => {
    const { staff } = await setup('operations');
    expect(
      await staff.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_zuo' })
    ).toEqual([]);
    expect(await staff.query(api.sysConfig.list, {})).toHaveProperty('records');
    await forbidden(staff.mutation(api.catPricing.recomputeVariants, { variantIds: [] }));
    await forbidden(staff.query(api.sysAlerts.health, {}));
    vi.stubEnv('DELIVERY_ADMIN_ROLES', JSON.stringify({ 'staff@example.com': ['finance'] }));
    await expect(
      staff.mutation(api.catPricing.recomputeVariants, { variantIds: [] })
    ).resolves.toBeNull();
    expect(await staff.query(api.dlvAccess.permissions, {})).toMatchObject({
      finance: true,
      approver: false,
      owner: false,
    });
    await forbidden(staff.query(api.v2Admin.reviewQueue, {}));
    await forbidden(staff.mutation(api.catPolicies.savePolicy, { supplierCode: 'fixture', kind: 'map', summary: 'Fixture evidence', evidenceRefs: ['fixture'], scope: { all: true }, status: 'documented' }));
    vi.stubEnv('DELIVERY_ADMIN_ROLES', JSON.stringify({ 'staff@example.com': ['approver'] }));
    expect(await staff.query(api.dlvAccess.permissions, {})).toMatchObject({
      finance: true,
      approver: true,
      owner: false,
    });
  });
  it('gives engineers configuration presence without customer data, and owners retain full access', async () => {
    const { staff } = await setup('engineering');
    vi.stubEnv('DELIVERY_REQUEST_SECRET', 'fixture-never-return');
    const readiness = await staff.query(api.dlvAccess.integrations, {});
    expect(readiness.gatewayConfigured).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain('fixture-never-return');
    await forbidden(staff.query(api.dlvAccess.supportQueue, {}));
    await forbidden(staff.query(api.ordFulfillment.dealerQueue, { route: 'manual_dealer_zuo' }));
    vi.stubEnv('DELIVERY_ADMIN_ROLES', JSON.stringify({ 'staff@example.com': ['owner'] }));
    expect(await staff.query(api.cjAdminAccess.session, {})).toEqual({
      owner: true,
      delivery: true,
    });
    expect(await staff.query(api.v2Admin.reviewQueue, {})).toEqual([]);
  });
  it('fails closed for malformed, missing-entry, duplicate and unknown-role maps', async () => {
    const { staff, t } = await setup('support');
    expect(await t.query(api.cjAdminAccess.session, {})).toEqual({ owner: false, delivery: false });
    for (const raw of [
      '',
      'null',
      '[]',
      '{',
      '{"staff@example.com":["superuser"]}',
      '{"Staff@example.com":["owner"],"staff@example.com":["support"]}',
    ]) {
      vi.stubEnv('DELIVERY_ADMIN_ROLES', raw);
      await forbidden(staff.query(api.dlvAccess.supportQueue, {}));
      expect(await staff.query(api.cjAdminAccess.session, {})).toEqual({
        owner: false,
        delivery: false,
      });
    }
    vi.stubEnv('DELIVERY_ADMIN_ROLES', '{}');
    await forbidden(staff.query(api.dlvAccess.supportQueue, {}));
    await forbidden(staff.query(api.v2Admin.reviewQueue, {}));
    expect(deliveryStaffRoles(undefined, 'staff@example.com')).toEqual(['owner']);
    expect(deliveryStaffRoles('{" STAFF@EXAMPLE.COM ":["support"]}', 'staff@example.com')).toEqual([
      'support',
    ]);
  });
});
