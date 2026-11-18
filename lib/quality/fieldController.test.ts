import { afterEach, expect, it, vi } from 'vitest';
import { installFieldController, type Observation } from './fieldController';
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  window.history.replaceState({}, '', '/');
  document.head.innerHTML = '';
});
function setup(initial = true, enabled = true, path = '/') {
  window.history.replaceState({}, '', path);
  let allowed = initial,
    consent = () => {};
  const reports: Record<
    string,
    (m: Observation & { navigationURL?: string; entries?: unknown[] }) => void
  > = {};
  const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const vitals = {
    onLCP: (cb: (metric: Observation) => void) => {
      reports.LCP = cb;
    },
    onCLS: (cb: (metric: Observation) => void) => {
      reports.CLS = cb;
    },
    onINP: (cb: (metric: Observation) => void) => {
      reports.INP = cb;
    },
  };
  const loadVitals = vi.fn(async () => vitals),
    serverEnabled = vi.fn(async () => enabled),
    unsubscribe = vi.fn();
  const stop = installFieldController({
    window,
    release: 'b'.repeat(40),
    endpoint: 'https://test.convex.site/quality',
    allowed: () => allowed,
    subscribe: (cb) => {
      consent = cb;
      return unsubscribe;
    },
    serverEnabled,
    loadVitals,
    request,
  });
  stops.push(stop);
  return {
    request,
    reports,
    loadVitals,
    serverEnabled,
    unsubscribe,
    consent: (value: boolean) => {
      allowed = value;
      consent();
    },
  };
}
async function ready() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
it('does not retroactively measure a document opened before opt-in', async () => {
  const s = setup(false);
  await ready();
  expect(s.serverEnabled).not.toHaveBeenCalled();
  expect(s.loadVitals).not.toHaveBeenCalled();
  s.consent(true);
  await ready();
  expect(s.loadVitals).not.toHaveBeenCalled();
});
it('does not load observers when the server gate is off', async () => {
  const s = setup(true, false);
  await ready();
  expect(s.loadVitals).not.toHaveBeenCalled();
  expect(s.request).not.toHaveBeenCalled();
});
it('projects only approved metric fields and discards repeated observations', async () => {
  const s = setup();
  await ready();
  s.reports.LCP({
    name: 'LCP',
    id: 'id',
    value: 2000,
    navigationType: 'navigate',
    navigationURL: 'https://site/private?token=secret',
    entries: [{ private: 'data' }],
  });
  await ready();
  s.reports.LCP({ name: 'LCP', id: 'id', value: 2000 });
  expect(s.request).toHaveBeenCalledTimes(1);
  const data = JSON.parse(s.request.mock.calls[0][1]!.body as string);
  expect(data.route).toBe('retail-home');
  expect(data.samples).toEqual([{ name: 'LCP', value: 2000, revision: 1 }]);
  expect(JSON.stringify(data)).not.toMatch(/secret|entries|navigationURL/);
});
it('stops after client navigation instead of attributing later work to the old page', async () => {
  const s = setup();
  await ready();
  window.history.pushState({}, '', '/products/other');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  s.reports.INP({ name: 'INP', id: 'id', value: 80 });
  expect(s.request).not.toHaveBeenCalled();
  expect(s.unsubscribe).toHaveBeenCalledTimes(1);
});
it('permanently drops the current visit on revocation', async () => {
  const s = setup();
  await ready();
  s.consent(false);
  s.consent(true);
  s.reports.LCP({ name: 'LCP', id: 'id', value: 2000 });
  expect(s.request).not.toHaveBeenCalled();
  expect(s.loadVitals).toHaveBeenCalledTimes(1);
});
it('rotates bfcache visits and rejects stale pre-restore callbacks', async () => {
  const s = setup();
  await ready();
  s.reports.LCP({ name: 'LCP', id: 'first', value: 2000, navigationType: 'navigate' });
  await ready();
  const first = JSON.parse(s.request.mock.calls[0][1]!.body as string);
  const event = new window.PageTransitionEvent('pageshow', { persisted: true });
  window.dispatchEvent(event);
  s.reports.LCP({ name: 'LCP', id: 'old', value: 2100, navigationType: 'navigate' });
  s.reports.LCP({
    name: 'LCP',
    id: 'restored',
    value: 500,
    navigationType: 'back-forward-cache',
    navigationStartTime: event.timeStamp,
  });
  await ready();
  expect(s.request).toHaveBeenCalledTimes(2);
  const second = JSON.parse(s.request.mock.calls[1][1]!.body as string);
  expect(second.documentToken).not.toBe(first.documentToken);
  expect(second.samples).toEqual([{ name: 'LCP', value: 500, revision: 1 }]);
});

it('does not register observers if consent is revoked during library loading', async () => {
  window.history.replaceState({}, '', '/');
  let allowed = true,
    changed = () => {};
  const observers = { onLCP: vi.fn(), onCLS: vi.fn(), onINP: vi.fn() };
  let resolveLibrary: ((value: typeof observers) => void) | undefined;
  const loadVitals = vi.fn(
    () =>
      new Promise<typeof observers>((resolve) => {
        resolveLibrary = resolve;
      })
  );
  stops.push(
    installFieldController({
      window,
      release: 'b'.repeat(40),
      endpoint: 'https://test.convex.site/quality',
      allowed: () => allowed,
      subscribe: (listener) => {
        changed = listener;
        return () => {};
      },
      serverEnabled: async () => true,
      loadVitals,
    })
  );
  await ready();
  allowed = false;
  changed();
  resolveLibrary!(observers);
  await ready();
  expect(observers.onLCP).not.toHaveBeenCalled();
  expect(observers.onINP).not.toHaveBeenCalled();
});
it('does not start from a restore event that the unloaded library missed', async () => {
  const s = setup(false);
  await ready();
  window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
  s.consent(true);
  await ready();
  expect(s.loadVitals).not.toHaveBeenCalled();
});
it('rejects a delayed callback from an earlier bfcache restoration', async () => {
  const s = setup();
  await ready();
  const first = new window.PageTransitionEvent('pageshow', { persisted: true });
  Object.defineProperty(first, 'timeStamp', { value: 100 });
  window.dispatchEvent(first);
  const second = new window.PageTransitionEvent('pageshow', { persisted: true });
  Object.defineProperty(second, 'timeStamp', { value: 200 });
  window.dispatchEvent(second);
  s.reports.LCP({
    name: 'LCP',
    id: 'old-restore',
    value: 900,
    navigationType: 'back-forward-cache',
    navigationStartTime: 100,
  });
  expect(s.request).not.toHaveBeenCalled();
  s.reports.LCP({
    name: 'LCP',
    id: 'new-restore',
    value: 500,
    navigationType: 'back-forward-cache',
    navigationStartTime: 200,
  });
  await ready();
  expect(s.request).toHaveBeenCalledTimes(1);
});

it('keeps revocation permanent even when collection was disabled before observers loaded', async () => {
  const s = setup(true, false);
  await ready();
  expect(s.serverEnabled).toHaveBeenCalledTimes(1);
  s.consent(false);
  s.consent(true);
  await ready();
  expect(s.serverEnabled).toHaveBeenCalledTimes(1);
  expect(s.loadVitals).not.toHaveBeenCalled();
});

it('never starts measurements on a private query or noindex document', async () => {
  const query = setup(true, true, '/?deliveryQuote=private');
  await ready();
  expect(query.serverEnabled).not.toHaveBeenCalled();
  document.head.innerHTML = '<meta name="robots" content="noindex, nofollow">';
  const hidden = setup();
  await ready();
  expect(hidden.serverEnabled).not.toHaveBeenCalled();
});
it('permanently stops when a private overlay adds noindex, even after it closes', async () => {
  const s = setup();
  await ready();
  document.head.innerHTML = '<meta name="robots" content="noindex, nofollow">';
  await ready();
  document.head.innerHTML = '';
  await ready();
  s.reports.LCP({ name: 'LCP', id: 'after-private', value: 1000 });
  expect(s.request).not.toHaveBeenCalled();
});
it('does not attribute measurements after any query change', async () => {
  const s = setup();
  await ready();
  window.history.replaceState({}, '', '/?variant=other');
  s.reports.LCP({ name: 'LCP', id: 'after-query', value: 1000 });
  expect(s.request).not.toHaveBeenCalled();
});
