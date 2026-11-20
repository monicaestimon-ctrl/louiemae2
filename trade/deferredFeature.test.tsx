import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { deferredFeature } from './deferredFeature';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('does not request a tool until mounted and retains its props after loading', async () => {
  let resolve!: (module: { default: React.ComponentType<{ value: string }> }) => void;
  const load = vi.fn(() => new Promise<{ default: React.ComponentType<{ value: string }> }>(r => { resolve = r; }));
  const Tool = deferredFeature(load, 'Delivery estimate');
  expect(load).not.toHaveBeenCalled();
  render(<Tool value="90210" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading delivery estimate');
  await act(async () => resolve({ default: ({ value }) => <p>ZIP {value}</p> }));
  expect(screen.getByText('ZIP 90210')).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
});
it('isolates a failed import and retries without removing sibling content', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const load = vi.fn<() => Promise<{ default: React.ComponentType }>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ default: () => <p>Ready tool</p> });
  const Tool = deferredFeature(load, 'Trade application');
  await act(async () => { render(<><p>Saved project</p><Tool /></>); });
  expect(screen.getByRole('alert')).toHaveTextContent('Trade application could not load');
  expect(screen.getByText('Saved project')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try loading again' })));
  expect(screen.getByText('Ready tool')).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
});

it('offers retry for a stalled module request', async () => {
  vi.useFakeTimers();
  const load = vi.fn<() => Promise<{ default: React.ComponentType }>>()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({ default: () => <p>Recovered tool</p> });
  const Tool = deferredFeature(load, 'Delivery estimate');
  render(<Tool />);
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByRole('alert')).toHaveTextContent('taking longer than expected');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try loading again' })));
  expect(screen.getByText('Recovered tool')).toBeTruthy();
});

it('starts a fresh waiting period when retrying a stalled import', async () => {
  vi.useFakeTimers();
  const Tool = deferredFeature(() => new Promise<{ default: React.ComponentType }>(() => {}), 'Account');
  render(<Tool />);
  act(() => vi.advanceTimersByTime(10_000));
  fireEvent.click(screen.getByRole('button', { name: 'Try loading again' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Loading account');
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByRole('alert')).toHaveTextContent('taking longer than expected');
});
