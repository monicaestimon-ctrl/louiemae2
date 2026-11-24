import { loadModule } from '../moduleRecovery';
import { installFieldController } from './fieldController';
import { qualityEndpoint, fieldEnabled } from './fieldConfig';
import { readPerformanceConsent, subscribePerformanceConsent } from './performanceConsent';
const installed = new WeakSet<globalThis.Window>();
/** Called once per document after a persisted grant was observed at entry. */
export function startFieldMonitoring(window: globalThis.Window, deployment: string) {
  if (installed.has(window)) return;
  installed.add(window);
  if (readPerformanceConsent(window) !== 'granted') return;
  const metas = window.document.querySelectorAll('meta[name="lm-build-commit"]');
  const release = metas.length === 1 ? metas[0].getAttribute('content') || '' : '';
  const endpoint = qualityEndpoint(deployment);
  if (!endpoint || !/^[a-f0-9]{40}$/.test(release)) return;
  installFieldController({
    window,
    release,
    endpoint,
    allowed: () => readPerformanceConsent(window) === 'granted',
    subscribe: (listener) => subscribePerformanceConsent(window, listener),
    serverEnabled: () => fieldEnabled(endpoint),
    loadVitals: () => loadModule(() => import('web-vitals')),
  });
}
