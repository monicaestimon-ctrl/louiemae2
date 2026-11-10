import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSiteAccount } from '../useSiteAccount';
const state = vi.hoisted(() => ({ session: undefined as unknown }));
vi.mock('convex/react', () => ({ useQueries: () => ({ session: state.session }) }));
beforeEach(() => { state.session = undefined; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('bounds pending account access and never retains owner permissions during auth transitions', () => {
  const { result, rerender } = renderHook(({ authenticated, loading }) => useSiteAccount(authenticated, loading), { initialProps: { authenticated: true, loading: false } });
  expect(result.current.status).toBe('loading');
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.status).toBe('unavailable');
  expect(result.current.session).toBeUndefined();
  state.session = { owner: true }; rerender({ authenticated: true, loading: false });
  expect(result.current.session?.owner).toBe(true);
  rerender({ authenticated: true, loading: true });
  expect(result.current.status).toBe('loading');
  expect(result.current.session).toBeUndefined();
  rerender({ authenticated: false, loading: false });
  expect(result.current.status).toBe('anonymous');
  expect(result.current.session).toBeUndefined();
});
