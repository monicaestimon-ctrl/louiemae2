/* global PopStateEvent */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { usePrivateIndexing } from '../usePrivateIndexing';
import { acquirePrivateIndexing, installPrivateLocationPolicy } from '../../lib/privateIndexing';
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  document.querySelectorAll('meta[name=robots]').forEach((node) => node.remove());
});
function Surface({ active, label }: { active: boolean; label: string }) {
  usePrivateIndexing(active);
  return active ? <section>{label}</section> : null;
}
it('composes route and overlay lifetimes, including navigation and retained quote state', () => {
  window.history.replaceState({}, '', '/?deliveryQuote=private#delivery-access=secret');
  const stop = installPrivateLocationPolicy(window);
  const view = render(
    <>
      <Surface active label="Private quote" />
      <Surface active label="Cart" />
    </>
  );
  expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toContain('noindex');
  window.history.replaceState({}, '', '/shop');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toContain('noindex');
  view.rerender(
    <>
      <Surface active label="Private quote" />
      <Surface active={false} label="Cart" />
    </>
  );
  expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toContain('noindex');
  view.unmount();
  expect(document.querySelector('meta[name=robots]')).toBeNull();
  stop();
});
it('handles direct private routes, Back and repeated installation without duplicate tags', () => {
  window.history.replaceState({}, '', '/trade/#account');
  const stop = installPrivateLocationPolicy(window);
  expect(installPrivateLocationPolicy(window)).toBe(stop);
  expect(document.querySelectorAll('meta[name=robots]')).toHaveLength(1);
  window.history.replaceState({}, '', '/trade/');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(document.querySelector('meta[name=robots]')).toBeNull();
  window.history.replaceState({}, '', '/trade/#studio');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toContain('noindex');
  stop();
  expect(document.querySelector('meta[name=robots]')).toBeNull();
});
it('applies private metadata before a committed surface is observed and cleans up StrictMode effects', () => {
  const view = render(
    <React.StrictMode>
      <Surface active label="Account" />
    </React.StrictMode>
  );
  expect(document.querySelectorAll('meta[name=robots]')).toHaveLength(1);
  view.rerender(
    <React.StrictMode>
      <Surface active={false} label="Account" />
    </React.StrictMode>
  );
  expect(document.querySelector('meta[name=robots]')).toBeNull();
});
it('reinstates a removed policy while a private surface remains active', async () => {
  const release = acquirePrivateIndexing(document);
  await act(async () => {
    document.querySelector('meta[name=robots]')?.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.querySelector('meta[name=robots]')?.getAttribute('content')).toBe(
    'noindex, nofollow'
  );
  release();
  expect(document.querySelector('meta[name=robots]')).toBeNull();
});
