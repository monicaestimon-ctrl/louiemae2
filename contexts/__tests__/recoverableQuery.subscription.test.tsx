import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useRecoverableQuery } from '../useRecoverableQuery';
afterEach(cleanup);

it('uses stable SDK watches for equivalent fresh arguments and never retains another search result', () => {
  const listeners = new Set<() => void>();
  const results = new Map<string, unknown>([['chair', [{ name: 'Chair' }]]]);
  const client = { watchQuery: (_query: unknown, args: { term: string }) => ({
    localQueryResult: () => { const result = results.get(args.term); if (result instanceof Error) throw result; return result; },
    onUpdate: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    journal: () => undefined,
  }) } as unknown as ConvexReactClient;
  function Probe({ term }: { term?: string }) {
    const request = useRecoverableQuery(api.products.searchStorefront, term ? { term, limit: 20 } : 'skip');
    return <p>{request.status}:{request.data?.map(item => item.name).join(',')}</p>;
  }
  const tree = (term?: string) => <React.StrictMode><ConvexProvider client={client}><Probe term={term} /></ConvexProvider></React.StrictMode>;
  const view = render(tree('chair'));
  expect(screen.getByText('ready:Chair')).toBeTruthy();
  view.rerender(tree('chair'));
  expect(screen.getByText('ready:Chair')).toBeTruthy();
  view.rerender(tree('sofa'));
  expect(screen.getByText('loading:')).toBeTruthy();
  expect(screen.queryByText(/Chair/)).toBeNull();
  results.set('sofa', new Error('offline'));
  act(() => { for (const listener of [...listeners]) listener(); });
  expect(screen.getByText('unavailable:')).toBeTruthy();
  view.rerender(tree());
  expect(screen.getByText('idle:')).toBeTruthy();
  view.unmount(); expect(listeners.size).toBe(0);
});
