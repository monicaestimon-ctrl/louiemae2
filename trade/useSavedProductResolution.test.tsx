import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { holmLegacyId } from '../lib/holmProductIdentity';
import { savedIdentityRequests, useSavedProductResolution } from './useSavedProductResolution';
const responses = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('convex/react', () => ({ useQueries: () => responses.value }));
const item = (id: string) => ({ id, name: 'Fixture', description: '', category: 'Furniture', images: [], facts: '', inStock: true, variants: [{ id: 'option', name: 'Option', minimum: 1, increment: 1, retail: 10000, trade: null }] });
beforeEach(() => { responses.value = {}; });
it('deduplicates explicit saved identities into bounded requests without fetching catalog pages', () => {
  const identities = Array.from({ length: 50 }, (_, index) => ({ pid: holmLegacyId(`source-${index}`), lid: `source-${index}` }));
  const requests = savedIdentityRequests([...identities, identities[0]], true);
  expect(Object.keys(requests)).toHaveLength(3);
  expect(Object.values(requests).map(request => 'productIds' in request.args ? request.args.productIds.length : 0)).toEqual([24, 24, 2]);
  expect(savedIdentityRequests(identities, false)).toEqual({});
  expect(savedIdentityRequests(Array(2001).fill(identities[0]), true)).toEqual({});
});
it('distinguishes a pending read, disabled legacy index, query failure and confirmed unavailable item', () => {
  const id = holmLegacyId('saved'); const identities = [{ pid: id }];
  const view = renderHook(() => useSavedProductResolution(identities));
  expect(view.result.current.pending).toBe(true);
  responses.value = { 'legacy:0': { ready: false, items: [] } }; view.rerender();
  expect(view.result.current.preparing).toBe(true);
  expect(view.result.current.rows[0].status).toBe('preparing');
  responses.value = { 'legacy:0': new Error('private server detail') }; view.rerender();
  expect(view.result.current.failed).toBe(true);
  expect(JSON.stringify(view.result.current)).not.toContain('private server detail');
  responses.value = { 'legacy:0': { ready: true, items: [{ legacyId: id, status: 'unavailable', item: null }] } }; view.rerender();
  expect(view.result.current.rows[0].status).toBe('unavailable');
  expect(view.result.current.pending).toBe(false);
});
it('never falls back to a numeric match when a saved source ID conflicts', () => {
  const id = holmLegacyId('saved');
  responses.value = { 'source:0': [{ productId: 'different', item: item('saved') }], 'legacy:0': { ready: true, items: [{ legacyId: id, status: 'resolved', item: item('saved') }] } };
  const view = renderHook(({ enabled }) => useSavedProductResolution([{ pid: id, lid: 'different' }], enabled), { initialProps: { enabled: true } });
  expect(view.result.current.rows[0]).toMatchObject({ status: 'conflict', item: null });
  view.rerender({ enabled: false });
  expect(view.result.current.rows[0]).toMatchObject({ status: 'pending', item: null });
});
it('keeps source-bound option identities while rejecting real numeric hash collisions', () => {
  const first = 'fixture-6678'; const second = 'fixture-17986';
  expect(holmLegacyId(first)).toBe(holmLegacyId(second));
  responses.value = { 'source:0': [{ productId: first, item: item(first) }] };
  const view = renderHook(({ identities }) => useSavedProductResolution(identities), { initialProps: { identities: [{ pid: holmLegacyId(first), lid: first, vid: 'saved-option' }] } });
  expect(view.result.current.rows[0]).toMatchObject({ status: 'resolved', identity: { vid: 'saved-option' } });
  responses.value = { 'source:0': [{ productId: first, item: item(first) }, { productId: second, item: item(second) }] };
  view.rerender({ identities: [{ pid: holmLegacyId(first), lid: first, vid: 'saved-option' }, { pid: holmLegacyId(second), lid: second, vid: 'other-option' }] });
  expect(view.result.current.rows.map(row => row.status)).toEqual(['conflict', 'conflict']);
  expect(view.result.current.rows.every(row => row.item === null)).toBe(true);
});
