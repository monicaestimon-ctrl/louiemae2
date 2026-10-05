import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminProductDetail } from '../useAdminProductDetail';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('convex/react', () => ({ useConvex: () => ({ query }) }));
const product = { _id: 'product-1', name: 'Chair', description: 'Full authoritative description', productRevision: 12, rawHtmlDescription: 'supplier details' };
beforeEach(() => { query.mockReset(); });
describe('authoritative product editor loading', () => {
  it('opens the complete authoritative product and its latest revision', async () => {
    query.mockResolvedValue(product);
    const loaded = vi.fn();
    const { result } = renderHook(() => useAdminProductDetail(true, 'products', loaded));
    await act(() => result.current.load('product-1'));
    expect(query).toHaveBeenCalledWith(expect.anything(), { id: 'product-1' });
    expect(loaded).toHaveBeenCalledWith({ ...product, id: product._id });
    expect(result.current.loadingId).toBeNull();
  });
  it('ignores a slower previous selection', async () => {
    let resolveFirst!: (value: unknown) => void;
    query.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce({ ...product, _id: 'product-2' });
    const loaded = vi.fn();
    const { result } = renderHook(() => useAdminProductDetail(true, 'products', loaded));
    let first!: Promise<void>;
    act(() => { first = result.current.load('product-1'); });
    await act(() => result.current.load('product-2'));
    await act(async () => { resolveFirst(product); await first; });
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded.mock.calls[0][0].id).toBe('product-2');
  });
  it.each(['cancel', 'navigate', 'signout', 'unmount'])('does not reopen after %s', async reason => {
    let resolve!: (value: unknown) => void;
    query.mockReturnValue(new Promise(done => { resolve = done; }));
    const loaded = vi.fn();
    const { result, rerender, unmount } = renderHook(({ enabled, scope }) => useAdminProductDetail(enabled, scope, loaded), { initialProps: { enabled: true, scope: 'products' } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.load('product-1'); });
    if (reason === 'cancel') act(() => result.current.cancel());
    if (reason === 'navigate') rerender({ enabled: true, scope: 'orders' });
    if (reason === 'signout') rerender({ enabled: false, scope: 'products' });
    if (reason === 'unmount') unmount();
    await act(async () => { resolve(product); await pending; });
    expect(loaded).not.toHaveBeenCalled();
  });
  it.each([null, new Error('backend unavailable')])('keeps the editor closed for unavailable data', async response => {
    if (response instanceof Error) query.mockRejectedValue(response); else query.mockResolvedValue(response);
    const loaded = vi.fn();
    const { result } = renderHook(() => useAdminProductDetail(true, 'products', loaded));
    await act(() => result.current.load('product-1'));
    expect(result.current.error).toBeTruthy();
    expect(result.current.loadingId).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
  });
  it('does not request private details while signed out', async () => {
    const { result } = renderHook(() => useAdminProductDetail(false, 'products', vi.fn()));
    await act(() => result.current.load('product-1'));
    expect(query).not.toHaveBeenCalled();
  });
});
