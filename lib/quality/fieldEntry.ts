import { loadModule } from '../moduleRecovery';
import { privateLocation } from '../privateIndexing';
let installed = false;
/** Snapshot permission at document entry. A new grant only affects a later visit. */
export function installOptionalFieldMonitoring() {
  if (installed) return;
  installed = true;
  try {
    if (
      localStorage.getItem('lm:performance-consent:v1') !== 'granted' ||
      privateLocation(window.location)
    )
      return;
    // Do not mislabel a restoration that happened while the optional module was loading.
    let restored = false;
    const restore = (event: globalThis.PageTransitionEvent) => {
      if (event.persisted) restored = true;
    };
    window.addEventListener('pageshow', restore, true);
    void loadModule(() => import('./fieldBootstrap'))
      .then((module) => {
        if (!restored) module.startFieldMonitoring(window, import.meta.env.VITE_CONVEX_URL);
      })
      .catch(() => {})
      .finally(() => window.removeEventListener('pageshow', restore, true));
  } catch {
    /* Unavailable storage leaves optional collection off. */
  }
}
