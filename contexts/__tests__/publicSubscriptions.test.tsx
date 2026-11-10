import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { usePublicEditorialPosts } from '../usePublicEditorialPosts';
import { usePublicSiteContent } from '../usePublicSiteContent';
import { useSiteAccount } from '../useSiteAccount';

afterEach(cleanup);

it('uses the real Convex subscription lifecycle without render loops across updates and disabled queries', () => {
  const listeners = new Set<() => void>();
  let unavailable = false;
  // Only the transport watch is faked. useQueries/useSubscription are the real
  // installed SDK implementations, which require stable request identities.
  const client = {
    watchQuery: () => ({
      localQueryResult: () => { if (unavailable) throw new Error('offline'); return undefined; },
      onUpdate: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      journal: () => undefined,
    }),
  } as unknown as ConvexReactClient;
  function Probe({ enabled }: { enabled: boolean }) {
    const editorial = usePublicEditorialPosts(enabled);
    const content = usePublicSiteContent();
    const account = useSiteAccount(enabled, false);
    return <><p>{editorial.status}/{content.siteContentStatus}/{content.customPagesStatus}</p><span>{account.status}</span></>;
  }
  const tree = (enabled: boolean) => <React.StrictMode><ConvexProvider client={client}><Probe enabled={enabled} /></ConvexProvider></React.StrictMode>;
  const view = render(tree(true));
  expect(screen.getByText('loading/loading/loading')).toBeTruthy();
  view.rerender(tree(true));
  unavailable = true;
  act(() => { for (const listener of listeners) listener(); });
  expect(screen.getByText('unavailable/unavailable/unavailable')).toBeTruthy();
  expect(screen.getByText('unavailable')).toBeTruthy();
  view.rerender(tree(false));
  expect(screen.getByText('empty/unavailable/unavailable')).toBeTruthy();
  expect(screen.getByText('anonymous')).toBeTruthy();
  view.unmount();
  expect(listeners.size).toBe(0);
});
