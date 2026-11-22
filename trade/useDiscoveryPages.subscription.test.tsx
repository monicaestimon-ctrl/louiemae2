import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import type { DiscoveryRequest } from '../lib/holmDiscoveryFilters';
import { useDiscoveryPages } from './useDiscoveryPages';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const base: DiscoveryRequest = { query: '', type: 'all', materials: [], tones: [], photoPalette: [], maximumMinor: null, inStock: false, sort: 'relevance', channel: 'retail' };
it('keeps real SDK query subscriptions isolated from late responses and changed boundaries', () => {
  vi.useFakeTimers();
  const values = new Map<string, unknown>();
  const watches = new Map<string, { cursor: string | null; request: DiscoveryRequest }>();
  const listeners = new Set<() => void>();
  const client = { watchQuery: (_query: unknown, args: { cursor: string | null; request: DiscoveryRequest }) => {
    const key = JSON.stringify(args); watches.set(key, args);
    return { localQueryResult: () => values.get(key), onUpdate: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); }, journal: () => undefined };
  } } as unknown as ConvexReactClient;
  const respond = (query: string, cursor: string | null, names: string[], nextCursor: string | null) => act(() => {
    for (const [key, args] of watches) if (args.request.query === query && args.cursor === cursor) values.set(key, {
      ready: true, items: names.map(name => ({ name })), nextCursor, refreshAfterMs: 30000, serverNow: 1,
    });
    for (const callback of [...listeners]) callback();
  });
  const hook = renderHook(({ query }) => useDiscoveryPages({ ...base, query }, 'viewer', true), {
    initialProps: { query: 'chair' }, wrapper: ({ children }) => <ConvexProvider client={client}>{children}</ConvexProvider>,
  });
  respond('chair', null, ['First'], 'old');
  act(() => hook.result.current.loadMore());
  respond('chair', 'old', ['Second'], null);
  expect(hook.result.current.items.map(item => item.name)).toEqual(['First', 'Second']);
  respond('chair', null, ['Replacement'], 'new');
  expect(hook.result.current.items.map(item => item.name)).toEqual(['Replacement']);
  respond('chair', 'old', ['Late stale row'], null);
  expect(hook.result.current.items.map(item => item.name)).toEqual(['Replacement']);
  hook.rerender({ query: 'sofa' });
  expect(hook.result.current.items).toEqual([]);
  respond('chair', null, ['Old filter response'], 'old');
  expect(hook.result.current.items).toEqual([]);
  respond('sofa', null, ['Current sofa'], null);
  expect(hook.result.current.items.map(item => item.name)).toEqual(['Current sofa']);
  respond('sofa', null, ['Current sofa'], 'pending');
  act(() => vi.advanceTimersByTime(29_900));
  act(() => hook.result.current.loadMore());
  expect(hook.result.current.items.map(item => item.name)).toEqual(['Current sofa']);
  act(() => vi.advanceTimersByTime(100));
  expect(hook.result.current.items).toEqual([]);
  expect(hook.result.current.pending).toBe(true);
  hook.unmount(); expect(listeners.size).toBe(0);
});
