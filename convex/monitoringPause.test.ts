// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const paused = ['refresh-due-product-health', 'monitor-cj-pricing'];
const preserved = ['sync-klaviyo-waitlist', 'reconcile-klaviyo-consent', 'sync-cj-tracking', 'backfill-cj-sourcing-jobs', 'dispatch-cj-sourcing-jobs', 'recover-stale-cj-webhooks', 'sync-cj-inventory'];
it.each([undefined, 'false'])('pauses monitoring with flag %s while preserving operational jobs', async (value) => {
  vi.stubEnv('BACKGROUND_MONITORING_ENABLED', value);
  vi.stubEnv('CONVEX_SITE_URL', 'https://blessed-rabbit-457.convex.site');
  vi.resetModules();
  const { default: crons } = await import('./crons');
  const jobs = JSON.parse((crons as unknown as { export(): string }).export());
  for (const name of paused) expect(jobs).not.toHaveProperty(name);
  for (const name of preserved) expect(jobs).toHaveProperty(name);
});
it('can explicitly resume monitoring without changing operational jobs', async () => {
  vi.stubEnv('BACKGROUND_MONITORING_ENABLED', 'true');
  vi.stubEnv('CONVEX_SITE_URL', 'https://blessed-rabbit-457.convex.site');
  vi.stubEnv('CHAT_UPLOAD_CANARY_ENABLED', 'true');
  vi.stubEnv('CHAT_QUALITY_CANARY_ENABLED', 'true');
  vi.resetModules();
  const { default: crons } = await import('./crons');
  const jobs = JSON.parse((crons as unknown as { export(): string }).export());
  for (const name of [...paused, ...preserved]) expect(jobs).toHaveProperty(name);
});
