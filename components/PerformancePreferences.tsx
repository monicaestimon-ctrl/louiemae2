import { useId, useState, useSyncExternalStore } from 'react';
import { Modal } from './Modal';
import {
  readPerformanceConsent,
  setPerformanceConsent,
  subscribePerformanceConsent,
} from '../lib/quality/performanceConsent';
import './performancePreferences.css';

const subscribe = (listener: () => void) => subscribePerformanceConsent(window, listener);
const snapshot = () => readPerformanceConsent(window);
const serverSnapshot = () => 'unknown' as const;

/** One browser preference shared by Louie Mae and HOLM, independent of account and referrals. */
export function PerformancePreferences({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const choice = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        onClick={() => {
          setMessage('');
          setOpen(true);
        }}
      >
        Performance preferences
      </button>
      <Modal open={open} label="Performance preferences" onClose={() => setOpen(false)}>
        <div className="lm-performance-backdrop">
          <section className="lm-performance-panel">
            <h2>Performance preferences</h2>
            <p>
              Help us understand how quickly pages load and respond. Optional performance
              measurements are off unless you turn them on.
            </p>
            <label className="lm-performance-choice">
              <input
                type="checkbox"
                checked={choice === 'granted'}
                aria-describedby={id}
                onChange={(event) => {
                  const result = setPerformanceConsent(window, event.currentTarget.checked);
                  setMessage(
                    result.persisted
                      ? result.consent === 'granted'
                        ? 'Preference saved: optional measurements are allowed on eligible page visits.'
                        : 'Performance measurements disabled.'
                      : 'Performance measurements are off for this visit. Your browser could not save this change; a previously saved choice may apply on your next visit.'
                  );
                }}
              />
              <span>Allow optional performance measurements</span>
            </label>
            <p id={id}>
              This browser choice applies to Louie Mae and HOLM on this site. You can turn it off
              here at any time. It does not change referral preferences, necessary site functions,
              or your account. Turning on applies from your next page load; turning off also stops
              measurements for this visit.
            </p>
            <p role="status" className="lm-performance-status">
              {message}
            </p>
            <button type="button" className="lm-performance-done" onClick={() => setOpen(false)}>
              Done
            </button>
          </section>
        </div>
      </Modal>
    </>
  );
}
