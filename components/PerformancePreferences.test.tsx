import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PerformancePreferences } from './PerformancePreferences';
import { PERFORMANCE_CONSENT_KEY, setPerformanceConsent } from '../lib/quality/performanceConsent';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it('starts disabled and lets a visitor explicitly enable and revoke without touching referrals', () => {
  localStorage.setItem('lm:consent', 'granted');
  render(<PerformancePreferences />);
  fireEvent.click(screen.getByRole('button', { name: 'Performance preferences' }));
  const input = screen.getByRole('checkbox');
  expect(input).not.toBeChecked();
  fireEvent.click(input);
  expect(input).toBeChecked();
  expect(localStorage.getItem(PERFORMANCE_CONSENT_KEY)).toBe('granted');
  fireEvent.click(input);
  expect(input).not.toBeChecked();
  expect(localStorage.getItem('lm:consent')).toBe('granted');
  expect(screen.getByRole('status')).toHaveTextContent('disabled');
});
it('explains persistence failure and immediately stops permission', () => {
  setPerformanceConsent(window, true);
  render(<PerformancePreferences />);
  fireEvent.click(screen.getByRole('button', { name: 'Performance preferences' }));
  vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('off for this visit');
  expect(screen.getByRole('status')).toHaveTextContent('previously saved choice');
});
it('closes without changing the current preference', () => {
  setPerformanceConsent(window, true);
  render(<PerformancePreferences />);
  fireEvent.click(screen.getByRole('button', { name: 'Performance preferences' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(localStorage.getItem(PERFORMANCE_CONSENT_KEY)).toBe('granted');
});
