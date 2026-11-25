// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
async function jobs(background: string | undefined, catalog: string | undefined) {
  vi.stubEnv('BACKGROUND_MONITORING_ENABLED', background);
  vi.stubEnv('CATALOG_FRESHNESS_ENABLED', catalog);
  vi.resetModules();
  const { default: crons } = await import('./crons');
  // Convex uses this internal serializer when registering schedules; it is omitted from public typings.
  return JSON.parse((crons as unknown as { export(): string }).export());
}
it('enables catalog freshness without resuming paused supplier monitoring', async () => {
  const configured = await jobs('false', 'true');
  expect(configured).toHaveProperty('refresh-catalog-freshness');
  expect(configured).not.toHaveProperty('monitor-cj-pricing');
  expect(configured).not.toHaveProperty('refresh-due-product-health');
  expect(configured).toHaveProperty('expire-checkout-intents');
});
it('preserves existing behavior when the catalog override is unset', async () => {
  expect(await jobs('true', undefined)).toHaveProperty('refresh-catalog-freshness');
  expect(await jobs('false', undefined)).not.toHaveProperty('refresh-catalog-freshness');
});
it('allows a scoped catalog pause without stopping other enabled monitoring', async () => {
  const configured = await jobs('true', 'false');
  expect(configured).not.toHaveProperty('refresh-catalog-freshness');
  expect(configured).toHaveProperty('monitor-cj-pricing');
});
