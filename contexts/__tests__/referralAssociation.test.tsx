import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReferralAssociation } from '../useReferralAssociation';
const { associate } = vi.hoisted(() => ({ associate: vi.fn() }));
vi.mock('convex/react', () => ({ useMutation: () => associate }));
beforeEach(() => { localStorage.clear(); associate.mockReset(); });
afterEach(() => vi.useRealTimers());
const visitor = 'existing-browser-123456';
function remember(consent = 'granted') { localStorage.setItem('hol:visitor', JSON.stringify(visitor)); localStorage.setItem('lm:consent', consent); }
const done = { userId: 'user1', associated: 1, isDone: true, cursor: null, cutoff: 100 };

it('does not create a tracking ID or submit an anonymous/denied association', async () => {
  const view = renderHook(({ signedIn }) => useReferralAssociation(signedIn), { initialProps: { signedIn: false } });
  view.rerender({ signedIn: true });
  expect(associate).not.toHaveBeenCalled(); expect(localStorage.getItem('hol:visitor')).toBeNull();
  remember('denied'); act(() => window.dispatchEvent(new Event('focus')));
  expect(associate).not.toHaveBeenCalled(); view.unmount();
});
it('joins on sign-in and sends the server-owned continuation and account precondition', async () => {
  remember(); associate.mockResolvedValueOnce({ ...done, isDone: false, cursor: 'next' }).mockResolvedValueOnce(done);
  const view = renderHook(({ signedIn }) => useReferralAssociation(signedIn), { initialProps: { signedIn: false } });
  view.rerender({ signedIn: true });
  await waitFor(() => expect(view.result.current).toBe('complete'));
  expect(associate.mock.calls).toEqual([[{ visitorKey: visitor, consent: 'granted' }], [{ visitorKey: visitor, consent: 'granted', cursor: 'next', cutoff: 100, expectedUserId: 'user1' }]]);
  view.unmount();
});
it('stops continuation after sign-out while an earlier page is pending', async () => {
  remember(); let resolve!: (v: unknown) => void;
  associate.mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = renderHook(({ signedIn }) => useReferralAssociation(signedIn), { initialProps: { signedIn: true } });
  view.rerender({ signedIn: false });
  await act(async () => resolve({ ...done, isDone: false, cursor: 'next' }));
  expect(associate).toHaveBeenCalledTimes(1); expect(view.result.current).toBe('idle'); view.unmount();
});
it('rechecks consent before the next page', async () => {
  remember(); associate.mockImplementationOnce(async () => { localStorage.setItem('lm:consent', 'denied'); return { ...done, isDone: false, cursor: 'next' }; });
  const view = renderHook(() => useReferralAssociation(true));
  await waitFor(() => expect(view.result.current).toBe('idle')); expect(associate).toHaveBeenCalledTimes(1); view.unmount();
});
it('leaves shopping mounted after a rejection and retries only on a later focus', async () => {
  remember('unknown'); associate.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(done);
  const view = renderHook(() => useReferralAssociation(true));
  await waitFor(() => expect(view.result.current).toBe('unavailable')); expect(associate).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(view.result.current).toBe('complete'));
  expect(associate.mock.calls[0][0].consent).toBe('unknown'); view.unmount();
});
it('yields after 20 pages and resumes the saved continuation a minute later', async () => {
  vi.useFakeTimers(); remember();
  associate.mockResolvedValue({ ...done, isDone: false, cursor: 'next' });
  const view = renderHook(() => useReferralAssociation(true));
  await act(async () => {});
  expect(associate).toHaveBeenCalledTimes(20); expect(view.result.current).toBe('pending');
  associate.mockResolvedValueOnce(done);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(associate).toHaveBeenCalledTimes(21); expect(view.result.current).toBe('complete'); view.unmount();
});
