import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { LiveShell } from './LiveShell';

const state = vi.hoisted(() => ({ installed: [] as Array<{ id: string }>, authenticated: true }));
vi.mock('convex/react', async importOriginal => ({ ...(await importOriginal<typeof import('convex/react')>()), useConvexAuth: () => ({ isLoading: false, isAuthenticated: state.authenticated }) }));
vi.mock('./catalog', () => ({ liveProducts: (rows: unknown[]) => rows }));
vi.mock('./app', () => ({
  setProducts: (rows: Array<{ id: string }>) => { state.installed = rows; },
  App: () => <main>{state.installed.map(row => <p key={row.id}>{row.id}</p>)}</main>,
}));
afterEach(() => { cleanup(); state.installed = []; state.authenticated = true; });

it('uses fresh SDK pagination identities across logout and trade-role changes', () => {
  let me: { signedIn: boolean; email?: string; verified?: boolean } = { signedIn: true, email: 'partner@example.test', verified: true };
  const pages = new Map<number, unknown>();
  const ids = new Set<number>();
  const listeners = new Set<() => void>();
  // Keep the real Convex useQuery/usePaginatedQuery lifecycle; replace only its transport.
  const client = {
    watchQuery: (query: Parameters<typeof getFunctionName>[0], args: { paginationOpts?: { id: number } }) => ({
      localQueryResult: () => {
        if (getFunctionName(query) === 'holm:me') return me;
        const id = args.paginationOpts!.id; ids.add(id); return pages.get(id);
      },
      onUpdate: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      journal: () => undefined,
    }),
  } as unknown as ConvexReactClient;
  const notify = () => act(() => { for (const listener of [...listeners]) listener(); });
  const fillCurrent = (id: string) => { pages.set([...ids].at(-1)!, { page: [{ id }], isDone: true, continueCursor: '' }); notify(); };
  render(<ConvexProvider client={client}><LiveShell /></ConvexProvider>);
  fillCurrent('private trade row');
  expect(screen.getByText('private trade row')).toBeTruthy();
  const firstId = [...ids].at(-1);

  state.authenticated = false; me = { signedIn: false }; notify();
  expect([...ids].at(-1)).not.toBe(firstId);
  expect(screen.queryByText('private trade row')).toBeNull();
  expect(state.installed).toEqual([]);
  fillCurrent('public retail row');
  expect(screen.getByText('public retail row')).toBeTruthy();

  state.authenticated = true; me = { signedIn: true, email: 'partner@example.test', verified: false }; notify();
  fillCurrent('unapproved retail row');
  const unapprovedId = [...ids].at(-1);
  me = { signedIn: true, email: 'partner@example.test', verified: true }; notify();
  expect([...ids].at(-1)).not.toBe(unapprovedId);
  expect(screen.queryByText('unapproved retail row')).toBeNull();
  expect(state.installed).toEqual([]);
});
