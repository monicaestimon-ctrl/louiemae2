import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const start = vi.hoisted(() => vi.fn());
vi.mock('./fieldBootstrap', () => ({ startFieldMonitoring: start }));
beforeEach(() => {
  vi.resetModules();
  start.mockReset();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => vi.restoreAllMocks());
const ready = () => new Promise((resolve) => setTimeout(resolve, 0));
it('never starts retroactively when permission is granted later in the same document', async () => {
  const entry = await import('./fieldEntry');
  entry.installOptionalFieldMonitoring();
  localStorage.setItem('lm:performance-consent:v1', 'granted');
  entry.installOptionalFieldMonitoring();
  await ready();
  expect(start).not.toHaveBeenCalled();
});
it('starts only once when permission was present at entry', async () => {
  localStorage.setItem('lm:performance-consent:v1', 'granted');
  const entry = await import('./fieldEntry');
  entry.installOptionalFieldMonitoring();
  entry.installOptionalFieldMonitoring();
  await ready();
  expect(start).toHaveBeenCalledOnce();
});
it('does not start from a bfcache restoration missed by the unloaded collector', async () => {
  localStorage.setItem('lm:performance-consent:v1', 'granted');
  const entry = await import('./fieldEntry');
  entry.installOptionalFieldMonitoring();
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
  await ready();
  expect(start).not.toHaveBeenCalled();
});
it('fails closed when browser storage is unavailable', async () => {
  vi.spyOn(globalThis.Storage.prototype, 'getItem').mockImplementation(() => {
    throw Error('globalThis.Storage blocked');
  });
  const entry = await import('./fieldEntry');
  expect(() => entry.installOptionalFieldMonitoring()).not.toThrow();
  await ready();
  expect(start).not.toHaveBeenCalled();
});

it('does not load monitoring for a private entry URL even with permission', async () => {
  localStorage.setItem('lm:performance-consent:v1', 'granted');
  window.history.replaceState({}, '', '/?deliveryQuote=private');
  const entry = await import('./fieldEntry');
  entry.installOptionalFieldMonitoring();
  await ready();
  expect(start).not.toHaveBeenCalled();
});
