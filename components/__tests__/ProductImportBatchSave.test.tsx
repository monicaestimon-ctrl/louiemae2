import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getFunctionName } from 'convex/server';
import { ProductImport } from '../ProductImport';

const mocks=vi.hoisted(()=>({mutation:vi.fn(),error:vi.fn(),loading:vi.fn(),dismiss:vi.fn()}));
vi.mock('convex/react',()=>({
  useMutation:(reference: Parameters<typeof getFunctionName>[0])=>(...args:unknown[])=>mocks.mutation(getFunctionName(reference),...args),
  useAction:()=>vi.fn(),useQuery:()=>undefined,
}));
vi.mock('../FadeIn',()=>({FadeIn:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock('../../services/translateService',()=>({detectChinese:()=>false}));
vi.mock('sonner',()=>({Toaster:()=>null,toast:{success:vi.fn(),warning:vi.fn(),error:mocks.error,loading:mocks.loading,dismiss:mocks.dismiss}}));
const fixture={id:'review-item',batchItemId:'batch-item',name:'Asterelle Ashwood Barstool',price:90,salePrice:90,originalPrice:90,
  description:'Curated batch description',images:Array.from({length:6},(_,i)=>`/images/chair-${i}.jpg`),
  selected:true,inStock:true,averageRating:0,reviewCount:0,collection:'furniture',targetCollection:'furniture',category:'Barstools',
  targetSubcategoryIds:['barstools'],primarySubcategoryId:'barstools',productUrl:'https://detail.1688.com/offer/999860531975.html',
  variants:Array.from({length:10},(_,i)=>({id:`v-${i}`,name:`Style ${i}`,priceAdjustment:i,inStock:true})),
  sourceProperties:{'材质':'Ash wood'},
};
beforeEach(()=>{
  localStorage.clear();sessionStorage.clear();vi.clearAllMocks();
  sessionStorage.setItem('import-step','review');sessionStorage.setItem('import-search-results',JSON.stringify([fixture]));
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const review=()=>fireEvent.click(screen.getByRole('button',{name:'Review this batch → (1)'}));
const confirm=()=>fireEvent.click(screen.getByRole('button',{name:'Confirm & Import (1)'}));

describe('atomic batch save in the product studio',()=>{
  it('submits curated fields once and does not make a second completion request',async()=>{
    const save=vi.fn().mockResolvedValue(undefined);
    render(<ProductImport collections={[]} onImportProducts={save}/>);
    review();confirm();
    await waitFor(()=>expect(screen.getByRole('heading',{name:'Import & Curate'})).toBeVisible());
    expect(save).toHaveBeenCalledTimes(1);
    const saved=save.mock.calls[0][0][0];
    expect(saved).toMatchObject({batchImportItemId:'batch-item',storefrontStatus:'hidden',name:fixture.name,
      sourceProperties:[{key:'材质',value:'Ash wood'}]});
    expect(saved.images).toHaveLength(6);expect(saved.variants).toHaveLength(10);
    expect(mocks.mutation.mock.calls.some(([name])=>name==='batchImports:markImported')).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('keeps the complete review available when the atomic save rejects',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>{});
    const save=vi.fn().mockRejectedValue(new Error('Batch item is no longer ready'));
    render(<ProductImport collections={[]} onImportProducts={save}/>);
    review();confirm();
    await waitFor(()=>expect(mocks.error).toHaveBeenCalled());
    expect(screen.getByRole('button',{name:'Confirm & Import (1)'})).toBeEnabled();
    expect(screen.getByRole('heading',{name:fixture.name})).toBeVisible();
    expect(screen.getByRole('heading',{name:'Variant Pricing (10 variants)'})).toBeVisible();
    expect(mocks.mutation.mock.calls.some(([name])=>name==='batchImports:markImported')).toBe(false);
    expect(JSON.parse(sessionStorage.getItem('import-search-results')||'[]')).toHaveLength(1);
  });
});
