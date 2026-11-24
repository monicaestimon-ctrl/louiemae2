// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const args = { route: 'retail-home' as const, device: 'mobile' as const, release: 'a'.repeat(40) };
afterEach(() => vi.unstubAllEnvs());
it('rejects anonymous and non-staff identities through real authorization', async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv('CJ_ADMIN_EMAILS', 'staff@example.com');
  await expect(t.query(api.qualityTelemetry.summary, args)).rejects.toThrow();
  const id = await t.run((ctx) => ctx.db.insert('users', { email: 'customer@example.com' }));
  await expect(
    t
      .withIdentity({ subject: `${id}|fixture`, email: 'customer@example.com' })
      .query(api.qualityTelemetry.summary, args)
  ).rejects.toThrow();
});
for (const role of ['support', 'operations', 'finance', 'approver', 'engineering', 'owner'])
  it(`enforces the real ${role} role for performance summaries`, async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv('CJ_ADMIN_EMAILS', 'staff@example.com');
    vi.stubEnv('DELIVERY_ADMIN_ROLES', JSON.stringify({ 'staff@example.com': [role] }));
    const id = await t.run((ctx) => ctx.db.insert('users', { email: 'staff@example.com' }));
    const staff = t.withIdentity({ subject: `${id}|fixture`, email: 'staff@example.com' });
    const call = staff.query(api.qualityTelemetry.summary, args);
    if (role === 'engineering' || role === 'owner') {
      const report = await call;
      expect(report.visits).toBe(0);
      expect(report.metrics.every((metric) => metric.status === 'insufficient-data')).toBe(true);
      expect(JSON.stringify(report)).not.toMatch(/documentToken|samples/);
    } else await expect(call).rejects.toThrow();
  });
