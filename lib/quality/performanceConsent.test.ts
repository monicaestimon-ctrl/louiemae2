import { describe, expect, it, vi } from 'vitest';
import {
  PERFORMANCE_CONSENT_EVENT,
  PERFORMANCE_CONSENT_KEY,
  readPerformanceConsent,
  setPerformanceConsent,
  subscribePerformanceConsent,
  type ConsentEnvironment,
} from './performanceConsent';
function fixture() {
  const events = new globalThis.EventTarget();
  const data = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  } as unknown as globalThis.Storage;
  const environment = {
    localStorage,
    dispatchEvent: events.dispatchEvent.bind(events),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as ConsentEnvironment;
  return { environment, data, localStorage, events };
}
describe('separate opt-in performance permission', () => {
  it.each([null, 'true', 'yes', '1', '{"analytics":true}', 'GRANTED'])(
    'does not accept absent or malformed permission %s',
    (value) => {
      const { environment, data } = fixture();
      if (value !== null) data.set(PERFORMANCE_CONSENT_KEY, value);
      data.set('lm:consent', 'granted');
      expect(readPerformanceConsent(environment)).toBe('unknown');
    }
  );
  it('stores only the requested preference and reports its actual persisted state', () => {
    const { environment, data } = fixture();
    expect(setPerformanceConsent(environment, true)).toEqual({
      persisted: true,
      consent: 'granted',
    });
    expect([...data.entries()]).toEqual([[PERFORMANCE_CONSENT_KEY, 'granted']]);
    expect(setPerformanceConsent(environment, false)).toEqual({
      persisted: true,
      consent: 'denied',
    });
  });
  it('fails closed when storage cannot be read', () => {
    const { environment, localStorage } = fixture();
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readPerformanceConsent(environment)).toBe('unknown');
    expect(setPerformanceConsent(environment, true).consent).toBe('denied');
  });
  it('revokes an existing permission immediately even if its stored value cannot be overwritten', () => {
    const { environment, localStorage, data } = fixture();
    data.set(PERFORMANCE_CONSENT_KEY, 'granted');
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('quota');
    });
    expect(setPerformanceConsent(environment, false)).toEqual({
      persisted: false,
      consent: 'denied',
    });
    expect(data.get(PERFORMANCE_CONSENT_KEY)).toBe('granted');
    expect(readPerformanceConsent(environment)).toBe('denied');
  });
  it('requires successful persistence before a revoked document can grant again', () => {
    const { environment, localStorage, data } = fixture();
    setPerformanceConsent(environment, false);
    vi.mocked(localStorage.setItem).mockImplementation(() => {});
    expect(setPerformanceConsent(environment, true).consent).toBe('denied');
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      data.set(key, value);
    });
    expect(setPerformanceConsent(environment, true).consent).toBe('granted');
  });
  it('notifies active subscribers and stops after disposal', () => {
    const { environment } = fixture();
    const listener = vi.fn();
    const dispose = subscribePerformanceConsent(environment, listener);
    setPerformanceConsent(environment, true);
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    setPerformanceConsent(environment, false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('ignores forged event consent and reads storage instead', () => {
    const { environment } = fixture();
    environment.dispatchEvent(
      new globalThis.CustomEvent(PERFORMANCE_CONSENT_EVENT, { detail: { consent: 'granted' } })
    );
    expect(readPerformanceConsent(environment)).toBe('unknown');
  });
  it('observes cross-tab preference changes and clearing, not unrelated storage', () => {
    const { environment, events } = fixture();
    const listener = vi.fn();
    subscribePerformanceConsent(environment, listener);
    events.dispatchEvent(new globalThis.StorageEvent('storage', { key: 'unrelated' }));
    expect(listener).not.toHaveBeenCalled();
    events.dispatchEvent(
      new globalThis.StorageEvent('storage', { key: PERFORMANCE_CONSENT_KEY, newValue: 'denied' })
    );
    events.dispatchEvent(new globalThis.StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
