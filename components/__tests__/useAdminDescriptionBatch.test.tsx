import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminDescriptionBatch } from '../useAdminDescriptionBatch';
const { query, generate } = vi.hoisted(() => ({ query: vi.fn(), generate: vi.fn() }));
vi.mock('convex/react', () => ({ useConvex: () => ({ query }), useAction: () => generate }));
const product = { _id: 'product-1', name: 'Chair', price: 90, description: 'Full description beyond a list excerpt',
  images: ['https://example.com/chair.jpg'], descriptionImages: ['https://example.com/dimensions.jpg'],
  category: 'chairs', collection: 'furniture', productRevision: 12,
  rawSourceDescription: 'Solid oak, 90 cm high', rawHtmlDescription: '<p>Supplier evidence</p>', sourceUrl: 'https://example.com/chair' };
const generated = { ok: true, description: 'Generated description', auditId: 'audit-1', warnings: [], fallbackUsed: false };
beforeEach(() => { query.mockReset(); generate.mockReset(); query.mockResolvedValue(product); generate.mockResolvedValue(generated); });

describe('batch description authoritative details', () => {
  it('uses full supplier evidence and retains the exact product revision for approval', async () => {
    const { result } = renderHook(() => useAdminDescriptionBatch(true));
    await act(() => result.current.run(['product-1', 'product-1']));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.anything(), { id: 'product-1' });
    expect(generate).toHaveBeenCalledWith({ request: expect.objectContaining({
      productId: 'product-1', generationMode: 'batch_regenerate',
      sourceSnapshot: expect.objectContaining({ rawDescription: product.rawSourceDescription, rawHtmlDescription: 'Supplier evidence' }),
    }) });
    expect(result.current.previews[0].product).toMatchObject({ id: 'product-1', productRevision: 12, description: product.description });
    expect(result.current.busy).toBe(false);
  });
  it('rechecks protected descriptions and deleted products before spending on generation', async () => {
    query.mockResolvedValueOnce({ ...product, smartDescription: { adminEdited: true } }).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...product, _id: 'eligible' });
    const { result } = renderHook(() => useAdminDescriptionBatch(true));
    await act(() => result.current.run(['protected', 'deleted', 'eligible']));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.current.previews.map(p => p.product.id)).toEqual(['eligible']);
  });
  it.each(['detail', 'generation'])('stops after leaving the page while %s is in flight', async stage => {
    let resolve!: (value: unknown) => void;
    const deferred = new Promise(done => { resolve = done; });
    if (stage === 'detail') query.mockReturnValueOnce(deferred); else generate.mockReturnValueOnce(deferred);
    const { result, rerender } = renderHook(({ enabled }) => useAdminDescriptionBatch(enabled), { initialProps: { enabled: true } });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.run(['product-1', 'product-2']); });
    rerender({ enabled: false });
    await act(async () => { resolve(stage === 'detail' ? product : generated); await pending; });
    expect(query).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(stage === 'detail' ? 0 : 1);
    expect(result.current.previews).toEqual([]);
    expect(result.current.busy).toBe(false);
  });
  it('ignores late completion from an old batch after returning to the page', async () => {
    let resolve!: (value: unknown) => void;
    generate.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ ...generated, auditId: 'new-audit' });
    const { result, rerender } = renderHook(({ enabled }) => useAdminDescriptionBatch(enabled), { initialProps: { enabled: true } });
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.run(['product-1']); });
    rerender({ enabled: false }); rerender({ enabled: true });
    await act(() => result.current.run(['product-1']));
    await act(async () => { resolve(generated); await pending; });
    expect(result.current.previews.map(p => p.auditId)).toEqual(['new-audit']);
  });
  it('keeps completed previews when a later request fails and does not continue the batch', async () => {
    query.mockResolvedValueOnce(product).mockRejectedValueOnce(new Error('Unavailable'));
    const { result } = renderHook(() => useAdminDescriptionBatch(true));
    await act(() => result.current.run(['product-1', 'product-2', 'product-3']));
    expect(query).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.current.previews).toHaveLength(1);
    expect(result.current.error).toContain('could not finish');
    expect(result.current.busy).toBe(false);
  });
  it('does not start duplicate batches or request private data while disabled', async () => {
    let resolve!: (value: unknown) => void;
    query.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ enabled }) => useAdminDescriptionBatch(enabled), { initialProps: { enabled: true } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(['product-1']); });
    await act(() => result.current.run(['product-2']));
    expect(query).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(product); await pending; });
    rerender({ enabled: false });
    await act(() => result.current.run(['product-3']));
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('reports when every product is protected instead of silently showing no previews', async () => {
    query.mockResolvedValue({ ...product, smartDescription: { adminEdited: true } });
    const { result } = renderHook(() => useAdminDescriptionBatch(true));
    await act(() => result.current.run(['product-1']));
    expect(generate).not.toHaveBeenCalled();
    expect(result.current.error).toContain('No eligible products');
  });
  it('does not restore a dismissed preview when the next product finishes', async () => {
    let resolve!: (value: unknown) => void;
    generate.mockResolvedValueOnce(generated).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useAdminDescriptionBatch(true));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.run(['product-1', 'product-2']); });
    expect(result.current.previews).toHaveLength(1);
    act(() => result.current.setPreviews([]));
    await act(async () => { resolve({ ...generated, auditId: 'audit-2' }); await pending; });
    expect(result.current.previews.map(p => p.auditId)).toEqual(['audit-2']);
  });
});
