// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const email = 'owner@example.com';
beforeEach(() => vi.stubEnv('CJ_ADMIN_EMAILS', email));
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx => ctx.db.insert('users', { email }));
  const admin = t.withIdentity({ subject: `${id}|s`, email });
  await t.mutation(internal.sysConfig.seed, {});
  const rows = await t.run(ctx => ctx.db.query('sysConfig').collect());
  const ladder = rows.find(r => r.kind === 'deliveryLadder')!;
  const carrier = rows.find(r => r.kind === 'carrierRule')!;
  return { t, admin, rows, ladder, carrier };
}
it('releases selected proposals at the same instant and audits each approval', async () => {
  const { t, admin, ladder, carrier } = await setup();
  const result = await admin.mutation(api.sysConfig.approveDeliveryRelease, { ids: [ladder._id, carrier._id], note: 'Reviewed modeled delivery policy' });
  const actual = await t.run(async ctx => ({ rows: await Promise.all([ctx.db.get(ladder._id), ctx.db.get(carrier._id)]), events: await ctx.db.query('sysAuditEvents').collect() }));
  expect(result.approved).toBe(2);
  expect(actual.rows.every(r => r?.status === 'approved' && r.effectiveFrom === result.effectiveFrom)).toBe(true);
  expect(actual.events.filter(e => e.action === 'config.approve')).toHaveLength(2);
});
it('rolls back all approvals if a later carrier record has expired', async () => {
  const { t, admin, ladder, carrier } = await setup();
  await t.run(ctx => ctx.db.patch(carrier._id, { value: { ...carrier.value, rule: { ...carrier.value.rule, effectiveTo: Date.now() - 1 } } }));
  await expect(admin.mutation(api.sysConfig.approveDeliveryRelease, { ids: [ladder._id, carrier._id], note: 'Review' })).rejects.toThrow();
  expect(await t.run(async ctx => (await ctx.db.get(ladder._id))?.status)).toBe('proposed');
  expect(await t.run(ctx => ctx.db.query('sysAuditEvents').collect())).toHaveLength(0);
  await expect(admin.mutation(api.sysConfig.approve, { id: carrier._id })).rejects.toThrow();
});
it('rejects stale versions, duplicates, unrelated settings, and future schedules', async () => {
  const { t, admin, rows, ladder } = await setup();
  for (const ids of [[], [ladder._id, ladder._id], [rows.find(r => r.kind === 'payoutSchedule')!._id]])
    await expect(admin.mutation(api.sysConfig.approveDeliveryRelease, { ids, note: 'Review' })).rejects.toThrow();
  await t.run(ctx => ctx.db.patch(ladder._id, { effectiveFrom: Date.now() + 100000 }));
  await expect(admin.mutation(api.sysConfig.approveDeliveryRelease, { ids: [ladder._id], note: 'Review' })).rejects.toThrow();
  await t.run(ctx => ctx.db.patch(ladder._id, { effectiveFrom: 0 }));
  await admin.mutation(api.sysConfig.propose, { kind: ladder.kind, key: ladder.key, value: ladder.value, note: 'Newer revision' });
  await expect(admin.mutation(api.sysConfig.approveDeliveryRelease, { ids: [ladder._id], note: 'Review' })).rejects.toThrow();
});
it('enforces approver role and retains original policy on denied access', async () => {
  const { t, admin, ladder } = await setup();
  await expect(t.mutation(api.sysConfig.approveDeliveryRelease, { ids: [ladder._id], note: 'Review' })).rejects.toThrow();
  vi.stubEnv('DELIVERY_ADMIN_ROLES', JSON.stringify({ [email]: ['operations'] }));
  await expect(admin.mutation(api.sysConfig.approveDeliveryRelease, { ids: [ladder._id], note: 'Review' })).rejects.toThrow();
  expect(await t.run(async ctx => (await ctx.db.get(ladder._id))?.status)).toBe('proposed');
});
it('keeps the current carrier approved when replacement evidence starts in the future', async () => {
  const { t, admin, ladder, carrier } = await setup();
  await admin.mutation(api.sysConfig.approve, { id: carrier._id });
  const next = await admin.mutation(api.sysConfig.propose, {
    kind: carrier.kind, key: carrier.key, note: 'Future evidence',
    value: { ...carrier.value, rule: { ...carrier.value.rule, effectiveFrom: Date.now() + 100000 } },
  });
  await expect(admin.mutation(api.sysConfig.approveDeliveryRelease, { ids: [ladder._id, next], note: 'Review' })).rejects.toThrow('Carrier evidence must already be effective');
  const original = await t.run(ctx => ctx.db.get(carrier._id));
  expect(original?.status).toBe('approved');
  expect(original?.effectiveTo).toBeUndefined();
  expect(await t.run(async ctx => (await ctx.db.get(ladder._id))?.status)).toBe('proposed');
  expect((await t.run(ctx => ctx.db.query('sysAuditEvents').collect())).filter(e => e.action === 'config.approve')).toHaveLength(1);
});
it('retains an existing approved version when a release cannot complete', async () => {
  const { t, admin, ladder, carrier } = await setup();
  await admin.mutation(api.sysConfig.approve, { id: ladder._id });
  const next = await admin.mutation(api.sysConfig.propose, { kind: ladder.kind, key: ladder.key, value: ladder.value, note: 'Replacement' });
  await t.run(ctx => ctx.db.patch(carrier._id, { value: { ...carrier.value, rule: { ...carrier.value.rule, effectiveTo: Date.now() - 1 } } }));
  await expect(admin.mutation(api.sysConfig.approveDeliveryRelease, { ids: [next, carrier._id], note: 'Review' })).rejects.toThrow();
  const original = await t.run(ctx => ctx.db.get(ladder._id));
  expect(original?.status).toBe('approved');
  expect(original?.effectiveTo).toBeUndefined();
});

it('individual approval cannot retire a newer approved carrier by approving an old proposal', async () => {
  const { t, admin, carrier } = await setup();
  const next = await admin.mutation(api.sysConfig.propose, {
    kind: carrier.kind, key: carrier.key, value: carrier.value, note: 'Current reviewed rates',
  });
  await admin.mutation(api.sysConfig.approve, { id: next });
  const before = await t.run(ctx => ctx.db.get(next));
  const auditBefore = await t.run(ctx => ctx.db.query('sysAuditEvents').collect());
  await expect(admin.mutation(api.sysConfig.approve, { id: carrier._id })).rejects.toThrow('A newer setting exists');
  expect(await t.run(ctx => ctx.db.get(next))).toEqual(before);
  expect(await t.run(async ctx => (await ctx.db.get(carrier._id))?.status)).toBe('proposed');
  expect(await t.run(ctx => ctx.db.query('sysAuditEvents').collect())).toEqual(auditBefore);
});

it('individual approval rejects a superseded proposal even while its replacement is pending', async () => {
  const { t, admin, ladder } = await setup();
  const next = await admin.mutation(api.sysConfig.propose, {
    kind: ladder.kind, key: ladder.key, value: ladder.value, note: 'Replacement pending review',
  });
  await expect(admin.mutation(api.sysConfig.approve, { id: ladder._id })).rejects.toThrow('A newer setting exists');
  expect(await t.run(async ctx => (await ctx.db.get(next))?.status)).toBe('proposed');
  await admin.mutation(api.sysConfig.approve, { id: next });
  expect(await t.run(async ctx => (await ctx.db.get(next))?.status)).toBe('approved');
});
