import React from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useKidsRootPreview } from '../useKidsRootPreview';
import { kidsInitialPreview } from '../../lib/kidsInitialPreview';
const transport = vi.hoisted(() => ({
  value: undefined as unknown,
  initial: undefined as unknown,
}));
vi.mock('../../lib/publicInitialData', () => ({
  PUBLIC_INITIAL_ID: 'lm-public-initial-data',
  readPublicInitialData: () => ({ kids: transport.initial }),
}));
vi.mock('convex/react', () => ({
  useQueries: (queries: object) => (Object.keys(queries).length ? { result: transport.value } : {}),
}));
beforeEach(() => { const element=document.createElement('script');element.id='lm-public-initial-data';document.body.append(element); });
afterEach(() => {
  cleanup();
  document.getElementById('lm-public-initial-data')?.remove();
  vi.useRealTimers();
  transport.value = undefined;
  transport.initial = undefined;
});
const initial = () =>
  kidsInitialPreview({
    ready: true,
    version: 5,
    products: [
      {
        _id: 'dress',
        name: 'Dress',
        price: 32,
        category: 'Dresses',
        images: ['/dress.webp'],
        variantCount: 2,
      },
    ],
  });
it('shows only verified display data before the live connection and lets live empty override it', () => {
  transport.initial = initial();
  const { result, rerender } = renderHook(() => useKidsRootPreview(true));
  expect(result.current.loading).toBe(false);
  expect(result.current.products[0]).toMatchObject({ id: 'dress', inStock: false });
  transport.value = { ready: true, version: 5, products: [] };
  rerender();
  expect(result.current.products).toEqual([]);
  transport.value = undefined;
  rerender();
  expect(result.current.products).toEqual([]);
  expect(result.current.loading).toBe(true);
});
it('withdraws initial display at the unchanged timeout and recovers from live data', () => {
  transport.initial = initial();
  vi.useFakeTimers();
  const { result, rerender } = renderHook(() => useKidsRootPreview(true));
  act(() => vi.advanceTimersByTime(10000));
  expect(result.current.unavailable).toBe(true);
  expect(result.current.products).toEqual([]);
  transport.value = initial();
  rerender();
  expect(result.current.unavailable).toBe(false);
  expect(result.current.products).toHaveLength(1);
  transport.value = { ready: false, version: 5, products: [] };
  rerender();
  expect(result.current.unavailable).toBe(true);
  expect(result.current.products).toEqual([]);
});
it('does not resurrect initial data after route changes or a transport failure', () => {
  transport.initial = initial();
  const { result, rerender } = renderHook(({ enabled }) => useKidsRootPreview(enabled), {
    initialProps: { enabled: true },
  });
  rerender({ enabled: false });
  expect(result.current.products).toEqual([]);
  rerender({ enabled: true });
  expect(result.current.products).toEqual([]);
  transport.value = new Error('Offline');
  rerender({ enabled: true });
  expect(result.current.unavailable).toBe(true);
  transport.value = undefined;
  rerender({ enabled: true });
  expect(result.current.products).toEqual([]);
});
it('does not make an absent initial response look like verified emptiness', () => {
  const { result } = renderHook(() => useKidsRootPreview(true));
  expect(result.current).toEqual({ products: [], loading: true, unavailable: false });
});

it.each(['navigation','empty','failure','withdrawal','timeout'])('does not resurrect the document preview on a fresh mount after %s', reason=>{
 transport.initial=initial();vi.useFakeTimers();
 const first=renderHook(()=>useKidsRootPreview(true),{wrapper:({children})=><React.StrictMode>{children}</React.StrictMode>});
 expect(first.result.current.products).toHaveLength(1);
 if(reason==='empty')transport.value={ready:true,version:5,products:[]};
 if(reason==='failure')transport.value=new Error('Offline');
 if(reason==='withdrawal')transport.value={ready:false,version:5,products:[]};
 if(reason==='timeout')act(()=>vi.advanceTimersByTime(10000));else first.rerender();
 first.unmount();transport.value=undefined;
 const second=renderHook(()=>useKidsRootPreview(true));
 expect(second.result.current.products).toEqual([]);expect(second.result.current.loading).toBe(true);
 transport.value=initial();second.rerender();expect(second.result.current.products).toHaveLength(1);
});

it('does not reread the document when a new page key replaces the owner in one commit',()=>{
 transport.initial=initial();
 function Preview(){const value=useKidsRootPreview(true);return <span>{value.products.length}</span>}
 const {rerender,container}=render(<Preview key="first"/>);expect(container.textContent).toBe('1');
 rerender(<Preview key="second"/>);expect(container.textContent).toBe('0');
});
