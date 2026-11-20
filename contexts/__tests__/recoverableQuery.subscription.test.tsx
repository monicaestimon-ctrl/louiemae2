import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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


it('detaches and reattaches the real SDK watch on manual retry', () => {
  let subscriptions = 0;
  let removals = 0;
  let result: unknown = new Error('offline');
  const client = { watchQuery: () => ({
    localQueryResult: () => { if (result instanceof Error) throw result; return result; },
    onUpdate: () => { subscriptions++; return () => { removals++; }; },
    journal: () => undefined,
  }) } as unknown as ConvexReactClient;
  function Probe() {
    const request = useRecoverableQuery(api.products.searchStorefront, { term: 'chair', limit: 20 });
    return <><p>{request.status}</p><button onClick={request.retry}>Retry</button></>;
  }
  const view = render(<ConvexProvider client={client}><Probe /></ConvexProvider>);
  expect(screen.getByText('unavailable')).toBeInTheDocument();
  expect(subscriptions).toBe(1);
  result = [];
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(removals).toBe(1);
  expect(subscriptions).toBe(2);
  expect(screen.getByText('ready')).toBeInTheDocument();
  view.unmount();
  expect(removals).toBe(2);
});
