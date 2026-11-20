// @vitest-environment node
/// <reference types="vite/client" />
import {expect,it} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
import {blankCommerceDraft,listingSnapshot} from '../lib/commerce';
import {legacySupplierCostMinor} from '../lib/legacySupplierCost';
const modules=import.meta.glob(['./**/*.ts','./_generated/*.js']);

it.each([undefined,0,-1,NaN,Infinity,1e20])('does not classify invalid supplier cost %s as known',cost=>{
  expect(legacySupplierCostMinor(cost,'USD',1)).toBeNull();
});
it('requires an explicit valid conversion and retains positive cent costs',()=>{
  expect(legacySupplierCostMinor(10,'EUR',0)).toBeNull();
  expect(legacySupplierCostMinor(10,'USD',2)).toBeNull();
  expect(legacySupplierCostMinor(10,'',1)).toBeNull();
  expect(legacySupplierCostMinor(10.25,'USD',1)).toBe(1025);
  expect(legacySupplierCostMinor(10,'EUR',1.2)).toBe(1200);
});

it.each(['missing','zero','bad-fx'] as const)('withdraws %s-cost retail eligibility and rejects a saved checkout before inserting a snapshot',async reason=>{
  const t=convexTest(schema,modules);
  const ids=await t.run(async ctx=>{
    const draft={...blankCommerceDraft(),name:'Fixture Sofa',category:'Sofas',description:'A sofa.',images:['https://example.com/sofa.jpg'],factsApproved:true,imagesApproved:true,
      variants:[{id:'tan',name:'Tan',sku:'SOF00401401',cost:899,minimum:1,increment:1,retail:224750,commercial:180000}]};
    const productId=await ctx.db.insert('commerceProducts',{provider:'ashcroft',sourceKey:'ashcroft:cost-fixture',draft,revision:1,updatedAt:1});
    const listingId=await ctx.db.insert('commerceListings',{productId,channel:'retail',published:true,revision:1,snapshot:listingSnapshot(draft,'ashcroft','retail'),fulfillment:draft.variants,updatedAt:1});
    return {productId,listingId,draft};
  });
  await t.mutation(internal.ashcroftInventory.reconcile,{source:'Isolated cost test inventory',sha256:'a'.repeat(64),observedAt:Date.now(),rows:[{sku:'SOF00401401',quantity:10}]});
  expect((await t.query(api.products.getStorefrontDetail,{id:ids.productId}))?.inStock).toBe(true);
  await t.run(async ctx=>{
    if(reason==='bad-fx') await ctx.db.patch(ids.productId,{draft:{...ids.draft,usdRate:0}});
    else await ctx.db.patch(ids.listingId,{fulfillment:reason==='missing'?[]:ids.draft.variants.map(v=>({...v,cost:0}))});
  });
  expect((await t.query(api.products.getStorefrontDetail,{id:ids.productId}))?.inStock).toBe(false);
  const page=await t.query(api.retailLaunch.storefrontPage,{paginationOpts:{cursor:null,numItems:10}});
  expect(page.page[0].inStock).toBe(false);
  const catalog=await t.query(api.retailLaunch.catalog,{paginationOpts:{cursor:null,numItems:10}});
  expect(catalog.page[0].variants[0].purchasable).toBe(false);
  const cart=await t.query(api.retailLaunch.cartReview,{id:ids.productId,variantId:'tan',quantity:1,attempt:0});
  expect(cart?.maximum).toBe(0);
  await expect(t.mutation(internal.retailLaunch.createSnapshot,{items:[{productId:ids.productId,variantId:'tan',quantity:1}]})).rejects.toThrow();
  expect(await t.run(ctx=>ctx.db.query('retailCheckouts').collect())).toEqual([]);
  expect(await t.run(ctx=>ctx.db.get(ids.listingId))).not.toBeNull();
});
