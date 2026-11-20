import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
const fixture=vi.hoisted(()=>({status:'ready',settings:{enabled:true,approvedTrade:true},retry:vi.fn(),pageStatus:'Exhausted',products:[] as unknown[],loadMore:vi.fn()}));
vi.mock('../../contexts/useRecoverableQuery',()=>({useRecoverableQuery:()=>({status:fixture.status,data:fixture.status==='ready'?fixture.settings:undefined,retry:fixture.retry})}));
vi.mock('convex/react',()=>({usePaginatedQuery:()=>({results:fixture.products,status:fixture.pageStatus,loadMore:fixture.loadMore}),useQuery:()=>undefined}));
vi.mock('./useDeliveryRequest',()=>({useDeliveryRequest:()=>()=>{throw Error('No commands allowed');}}));
vi.mock('./CheckoutV2',()=>({DeliveryCheckout:()=>null}));
vi.mock('./DeliveryQuoteRequest',()=>({default:()=>null}));
import Calculator from './TradeDeliveryCalculator';
afterEach(()=>{cleanup();fixture.status='ready';fixture.settings={enabled:true,approvedTrade:true};fixture.pageStatus='Exhausted';fixture.products=[];vi.clearAllMocks();});
it('contains a failed settings query and provides a local retry',()=>{
  fixture.status='unavailable';render(<Calculator/>);
  expect(screen.getByRole('alert').textContent).toContain('saved projects are unchanged');
  fireEvent.click(screen.getByRole('button',{name:'Try calculator again'}));
  expect(fixture.retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('announces settings loading without promising available products',()=>{
  fixture.status='loading';render(<Calculator/>);
  expect(screen.getByRole('status').textContent).toBe('Loading calculator…');
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('keeps disabled and unapproved trade gates distinct from an empty catalog',()=>{
  fixture.settings={enabled:false,approvedTrade:false};const view=render(<Calculator/>);
  expect(screen.getByText(/request confirmed merchandise/)).toBeTruthy();
  fixture.settings={enabled:true,approvedTrade:false};view.rerender(<Calculator/>);
  expect(screen.getByText(/after trade approval/)).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('distinguishes loading, further pages and a genuinely exhausted empty catalog',()=>{
  fixture.pageStatus='LoadingFirstPage';const view=render(<Calculator/>);
  expect(screen.getByRole('status').textContent).toBe('Loading approved products…');
  expect(screen.getByRole('combobox')).toBeDisabled();
  fixture.pageStatus='CanLoadMore';view.rerender(<Calculator/>);
  expect(screen.queryByText(/No products are currently eligible/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Load more products'}));
  expect(fixture.loadMore).toHaveBeenCalledWith(20);
  fixture.pageStatus='Exhausted';view.rerender(<Calculator/>);
  expect(screen.getByRole('status').textContent).toContain('No products are currently eligible');
  expect(screen.getByRole('button',{name:'Estimate project delivery'})).toBeDisabled();
});
