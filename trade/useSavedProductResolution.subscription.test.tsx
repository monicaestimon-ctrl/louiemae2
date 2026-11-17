import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { holmLegacyId } from '../lib/holmProductIdentity';
import { useProjectCatalog } from './useProjectCatalog';
import type { HolmProduct } from './catalog';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps real SDK subscriptions stable for fresh project arrays and clears switched sources', () => {
  const listeners = new Set<() => void>();
  let subscriptions = 0;
  let renders = 0;
  const results = new Map<string, unknown>();
  const chair = { id: 'chair', name: 'Saved chair', description: '', category: 'Chairs', images: [], facts: '', inStock: true,
    variants: [{ id: 'oak', name: 'Oak', minimum: 1, increment: 1, retail: 10000, trade: null }] };
  results.set('chair', [{ productId: 'chair', item: chair }]);
  const client = { watchQuery: (_query: unknown, args: { productIds: string[] }) => ({
    localQueryResult: () => results.get(args.productIds.join(',')),
    onUpdate: (listener: () => void) => { subscriptions++; listeners.add(listener); return () => listeners.delete(listener); },
    journal: () => undefined,
  }) } as unknown as ConvexReactClient;
  const catalog = new Map<number, HolmProduct>();
  function Probe({ source }: { source: string }) {
    if (++renders > 30) throw new Error('Unstable saved product subscription');
    const result = useProjectCatalog([{ pid: holmLegacyId(source), lid: source }], catalog);
    return <p>{[...result.states.values()].map(row => row.status).join(',')}:{[...result.products.values()].map(product => product.full).join(',')}</p>;
  }
  const tree = (source: string) => <React.StrictMode><ConvexProvider client={client}><Probe source={source} /></ConvexProvider></React.StrictMode>;
  const view = render(tree('chair'));
  expect(screen.getByText('resolved:Saved chair')).toBeInTheDocument();
  const before = subscriptions;
  view.rerender(tree('chair'));
  expect(subscriptions).toBe(before);
  view.rerender(tree('sofa'));
  expect(screen.getByText('pending:')).toBeInTheDocument();
  expect(screen.queryByText(/Saved chair/)).toBeNull();
  results.set('sofa', [{ productId: 'sofa', item: null }]);
  act(() => { for (const listener of [...listeners]) listener(); });
  expect(screen.getByText('unavailable:')).toBeInTheDocument();
  view.unmount();
  expect(listeners.size).toBe(0);
});

it('bounds a stalled source lookup and can recover without losing the saved identity', () => {
  vi.useFakeTimers();
  const listeners = new Set<() => void>();
  let response: unknown;
  const client = { watchQuery: () => ({
    localQueryResult: () => response,
    onUpdate: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    journal: () => undefined,
  }) } as unknown as ConvexReactClient;
  function Probe({ source }: { source: string }) {
    const result = useProjectCatalog([{ pid: holmLegacyId(source), lid: source, vid: 'saved-option' }], new Map());
    const row = [...result.states.values()][0];
    return <p>{row.status}:{row.identity.lid}:{row.identity.vid}</p>;
  }
  const tree = (source: string) => <ConvexProvider client={client}><Probe source={source} /></ConvexProvider>;
  const view = render(tree('chair'));
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(screen.getByText('error:chair:saved-option')).toBeInTheDocument();
  view.rerender(tree('sofa'));
  expect(screen.getByText('pending:sofa:saved-option')).toBeInTheDocument();
  response = [{ productId: 'sofa', item: null }];
  act(() => { for (const listener of [...listeners]) listener(); });
  expect(screen.getByText('unavailable:sofa:saved-option')).toBeInTheDocument();
});
