import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FieldPerformance from './FieldPerformance';
const query = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/useRecoverableQuery', () => ({ useRecoverableQuery: query }));
afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
  query.mockReset();
});
const report = {
  enabled: false,
  since: 0,
  through: 1,
  visits: 0,
  truncated: false,
  collectionLimited: false,
  limitedDays: 0,
  dailyBudget: { requests: 0, maxRequests: 5000, visits: 0, maxVisits: 1000 },
  metrics: [{ name: 'INP', count: 0, p75: null, threshold: 200, status: 'insufficient-data' }],
};
const setup = () => {
  document.head.innerHTML = '<meta name="lm-build-commit" content="' + 'a'.repeat(40) + '">';
};
it('does not query an invalid release and supplies accessible validation', () => {
  query.mockReturnValue({ status: 'idle' });
  render(<FieldPerformance />);
  expect(query.mock.calls.at(-1)?.[1]).toBe('skip');
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('valid release');
});
it('shows missing INP and insufficient observations without calling them healthy', () => {
  setup();
  query.mockReturnValue({ status: 'ready', data: report });
  render(<FieldPerformance />);
  expect(screen.getByText('Not measured')).toBeVisible();
  expect(screen.getByText('insufficient data')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('disabled');
  expect(screen.queryByText('within target')).toBeNull();
});
it('shows budget and truncation caveats and queries the selected segment', () => {
  setup();
  query.mockReturnValue({
    status: 'ready',
    data: { ...report, truncated: true, collectionLimited: true, limitedDays: 2 },
  });
  render(<FieldPerformance />);
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Page type'), { target: { value: 'holm-home' } });
  fireEvent.change(screen.getByLabelText('Device'), { target: { value: 'desktop' } });
  expect(query.mock.calls.at(-1)?.[1]).toEqual({
    route: 'holm-home',
    device: 'desktop',
    release: 'a'.repeat(40),
  });
});
it('offers explicit retry without rendering stale healthy metrics on failure', () => {
  setup();
  const retry = vi.fn();
  query.mockReturnValue({ status: 'unavailable', retry });
  render(<FieldPerformance />);
  expect(screen.getByRole('alert')).toHaveTextContent('No healthy status');
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry measurements' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('presents an actionable in-app alert for an above-target metric', () => {
  setup();
  query.mockReturnValue({
    status: 'ready',
    data: {
      ...report,
      enabled: true,
      visits: 60,
      metrics: [{ name: 'LCP', count: 60, p75: 2700, threshold: 2500, status: 'above-target' }],
    },
  });
  render(<FieldPerformance />);
  expect(screen.getByRole('alert')).toHaveTextContent('exceeds its target: LCP');
  expect(screen.getByText('2700 ms')).toBeVisible();
});

it('alerts engineering when expired observations await cleanup', () => {
  setup();
  query.mockReturnValue({ status: 'ready', data: { ...report, retentionBacklog: true } });
  render(<FieldPerformance />);
  expect(screen.getByRole('alert')).toHaveTextContent('Expired observations are awaiting cleanup');
});
