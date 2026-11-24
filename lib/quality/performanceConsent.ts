/** A separate, explicit preference. Referral consent never grants performance collection. */
export const PERFORMANCE_CONSENT_KEY = 'lm:performance-consent:v1';
export const PERFORMANCE_CONSENT_EVENT = 'lm:performance-consent-change';
export type PerformanceConsent = 'granted' | 'denied' | 'unknown';
export type ConsentEnvironment = Pick<
  globalThis.Window,
  'localStorage' | 'dispatchEvent' | 'addEventListener' | 'removeEventListener'
>;
const revoked = new WeakSet<ConsentEnvironment>();

export function readPerformanceConsent(environment: ConsentEnvironment): PerformanceConsent {
  if (revoked.has(environment)) return 'denied';
  try {
    const stored = environment.localStorage.getItem(PERFORMANCE_CONSENT_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Revocation takes effect immediately even when persistent storage fails. A grant must persist. */
export function setPerformanceConsent(environment: ConsentEnvironment, granted: boolean) {
  if (!granted) revoked.add(environment);
  let persisted = false;
  try {
    const choice = granted ? 'granted' : 'denied';
    environment.localStorage.setItem(PERFORMANCE_CONSENT_KEY, choice);
    persisted = environment.localStorage.getItem(PERFORMANCE_CONSENT_KEY) === choice;
  } catch {
    persisted = false;
  }
  if (granted && persisted) revoked.delete(environment);
  // A failed grant cannot leave an older permission active in this document.
  if (granted && !persisted) revoked.add(environment);
  environment.dispatchEvent(new Event(PERFORMANCE_CONSENT_EVENT));
  return { persisted, consent: readPerformanceConsent(environment) };
}

/** Subscribers re-read authoritative storage; no consent is accepted from custom event payloads. */
export function subscribePerformanceConsent(environment: ConsentEnvironment, listener: () => void) {
  const storage = (event: Event) => {
    const change = event as globalThis.StorageEvent;
    if (change.key !== null && change.key !== PERFORMANCE_CONSENT_KEY) return;
    // A locally failed revocation is sticky until this document explicitly saves a fresh grant.
    listener();
  };
  environment.addEventListener(PERFORMANCE_CONSENT_EVENT, listener);
  environment.addEventListener('storage', storage);
  return () => {
    environment.removeEventListener(PERFORMANCE_CONSENT_EVENT, listener);
    environment.removeEventListener('storage', storage);
  };
}
