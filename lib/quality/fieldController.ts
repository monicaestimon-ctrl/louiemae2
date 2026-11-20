import { privateLocation } from '../privateIndexing';
import { createFieldVisit } from './fieldVisit';
import { createFieldTransport } from './fieldTransport';
import { fieldRoute, type FieldMetric } from './fieldPolicy';
export type Observation = {
  name: FieldMetric;
  id: string;
  value: number;
  navigationType?: string;
  navigationStartTime?: number;
};
type Vitals = {
  onLCP(callback: (metric: Observation) => void): void;
  onCLS(callback: (metric: Observation) => void): void;
  onINP(callback: (metric: Observation) => void): void;
};
type Options = {
  window: globalThis.Window;
  release: string;
  endpoint: string;
  allowed: () => boolean;
  subscribe: (listener: () => void) => () => void;
  serverEnabled: () => Promise<boolean>;
  loadVitals: () => Promise<Vitals>;
  request?: typeof fetch;
};
/** One controller per document. Never re-label document metrics after client navigation. */
export function installFieldController(options: Options) {
  const win = options.window,
    path = win.location.pathname,
    hash = win.location.hash,
    search = win.location.search;
  const route = fieldRoute(path, hash);
  let stopped = false,
    starting = false,
    started = false,
    restores = 0,
    restoreTime: number | null = null;
  let unsubscribe = () => {};
  let privacyObserver: MutationObserver | undefined;
  let visit: ReturnType<typeof createFieldVisit> | null = null,
    transport: ReturnType<typeof createFieldTransport> | null = null;
  const sameLocation = () =>
    win.location.pathname === path && win.location.hash === hash && win.location.search === search;
  const publicDocument = () =>
    !privateLocation(win.location) &&
    ![...win.document.querySelectorAll('meta[name="robots" i]')].some((node) =>
      /(?:^|,)\s*(?:noindex|none)\s*(?:,|$)/i.test(node.getAttribute('content') || '')
    );
  const permitted = () => !stopped && sameLocation() && publicDocument() && options.allowed();
  const token = () =>
    Array.from(win.crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
  const rotate = () => {
    transport?.revoke();
    visit?.revoke();
    visit = createFieldVisit({
      documentToken: token(),
      release: options.release,
      route: route!,
      device: win.innerWidth < 768 ? 'mobile' : 'desktop',
    });
    transport = createFieldTransport(options.endpoint, permitted, options.request);
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    visit?.revoke();
    transport?.revoke();
    unsubscribe();
    privacyObserver?.disconnect();
    win.removeEventListener('hashchange', navigate);
    win.removeEventListener('popstate', navigate);
    win.removeEventListener('pageshow', restore, true);
  }
  function navigate() {
    if (!sameLocation() || !publicDocument()) stop();
  }
  function restore(event: globalThis.PageTransitionEvent) {
    if (!event.persisted || stopped) return;
    restoreTime = event.timeStamp;
    // Loading the library after a restore cannot recover its missed pageshow identity.
    if (!started || !permitted() || ++restores > 20) {
      stop();
      return;
    }
    try {
      rotate();
    } catch {
      stop();
    }
  }
  function report(metric: Observation) {
    if (!permitted()) {
      stop();
      return;
    }
    if (metric.navigationType === 'soft-navigation') return;
    if (
      restoreTime !== null &&
      (metric.navigationType !== 'back-forward-cache' || metric.navigationStartTime !== restoreTime)
    )
      return;
    if (restoreTime === null && metric.navigationType === 'back-forward-cache') return;
    if (visit?.observe({ name: metric.name, id: metric.id, value: metric.value })) {
      const batch = visit.snapshot();
      if (batch && transport) void transport.send(batch);
    }
  }
  async function begin() {
    if (started || starting || stopped || !route || !options.allowed()) return;
    if (!sameLocation()) {
      stop();
      return;
    }
    starting = true;
    try {
      if (!(await options.serverEnabled())) {
        starting = false;
        return;
      }
      if (!permitted()) {
        stop();
        return;
      }
      const vitals = await options.loadVitals();
      if (!permitted()) {
        stop();
        return;
      }
      rotate();
      started = true;
      starting = false;
      // Listeners above precede the library's capture-phase bfcache listeners.
      vitals.onLCP(report);
      vitals.onCLS(report);
      vitals.onINP(report);
    } catch {
      stop();
    }
  }
  // A newly granted preference applies to the next document, never buffered pre-consent work.
  if (!route || !publicDocument() || !options.allowed()) return stop;
  privacyObserver = new MutationObserver(navigate);
  privacyObserver.observe(win.document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['name', 'content'],
  });
  win.addEventListener('hashchange', navigate);
  win.addEventListener('popstate', navigate);
  win.addEventListener('pageshow', restore, true);
  unsubscribe = options.subscribe(() => {
    if (!options.allowed()) {
      stop();
    } else void begin();
  });
  void begin();
  return stop;
}
