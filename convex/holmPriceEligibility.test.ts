// @vitest-environment node
/// <reference types="vite/client" />
import {afterEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
import {blankCommerceDraft,listingSnapshot} from '../lib/commerce';
const modules=import.meta.glob(['./**/*.ts','./_generated/*.js']);
type Test=ReturnType<typeof convexTest>;
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
async function seed(t:Test) {
  const source=await t.run(async ctx=>{
    const draft={...blankCommerceDraft(),name:'Fixture Sofa',description:'A sofa.',category:'Sofas',images:['https://example.com/sofa.jpg'],factsApproved:true,imagesApproved:true,
      variants:[{id:'tan',name:'Tan',sku:'SOF00401401',cost:899,minimum:1,increment:1,retail:224750,commercial:180000}]};
    const productId=await ctx.db.insert('commerceProducts',{provider:'ashcroft',sourceKey:'ashcroft:price-floor-fixture',draft,revision:1,updatedAt:1});
    const listingId=await ctx.db.insert('commerceListings',{productId,channel:'house',published:true,revision:1,snapshot:listingSnapshot(draft,'ashcroft','house'),fulfillment:draft.variants,updatedAt:1});
    await ctx.db.insert('commerceListings',{productId,channel:'retail',published:true,revision:1,snapshot:listingSnapshot(draft,'ashcroft','retail'),fulfillment:draft.variants,updatedAt:1});
    return {productId,listingId,variants:draft.variants};
  });
  await t.mutation(internal.ashcroftInventory.reconcile,{source:'Isolated stock fixture',sha256:'a'.repeat(64),observedAt:Date.now(),rows:[{sku:'SOF00401401',quantity:10}]});
  return source;
}
it.each([0,5000])('withdraws a missing-cost or unfunded offer (%s) from reads and authoritative quote creation',async cost=>{
  const t=convexTest(schema,modules),source=await seed(t);
  const page=()=>t.query(api.holm.catalogPage,{paginationOpts:{cursor:null,numItems:24}});
  expect((await page()).page).toHaveLength(1);
  await t.run(ctx=>ctx.db.patch(source.listingId,{fulfillment:source.variants.map(v=>({...v,cost}))}));
  expect((await page()).page).toEqual([]);
  expect((await t.query(api.holm.catalogItems,{productIds:[source.productId]}))[0].item).toBeNull();
  await expect(t.mutation(api.holm.requestQuote,{
    token:'price-eligibility-fixture',projectName:'Fixture',name:'Fixture Buyer',email:'fixture@example.com',phone:'',business:'',
    address:{line1:'1 Main',city:'Stockton',state:'CA',postalCode:'95206',country:'US'},timing:'asap',date:'',receiving:'threshold',notes:'',website:'',
    items:[{productId:source.productId,variantId:'tan',quantity:1,zone:'Room'}],
  })).rejects.toThrow(/no longer available/);
  expect(await t.run(ctx=>ctx.db.query('commerceProjects').collect())).toEqual([]);
  vi.stubEnv('CJ_ADMIN_EMAILS','owner@example.com');
  vi.stubEnv('DELIVERY_ADMIN_ROLES',JSON.stringify({'owner@example.com':['owner']}));
  const user=await t.run(ctx=>ctx.db.insert('users',{email:'owner@example.com'}));
  const owner=t.withIdentity({subject:`${user}|fixture`,email:'owner@example.com'});
  const report=await owner.query(api.holm.adminPricing,{});
  expect(report).toHaveLength(1);
  expect(report[0]).toMatchObject({productId:source.productId,tradeCents:0,tradeMarginBps:null,projectMarginBps:null});
  expect(report[0].flags).toContain('Cost review required: new offers unavailable');
  await expect(t.query(api.holm.adminPricing,{})).rejects.toThrow();
});
it.each([{currency:'EUR',usdRate:0},{currency:'USD',usdRate:2}])('does not substitute an implicit currency conversion for %j',async conversion=>{
  const t=convexTest(schema,modules),source=await seed(t);
  await t.run(async ctx=>{
    const product=await ctx.db.get(source.productId);
    await ctx.db.patch(source.productId,{draft:{...product!.draft,...conversion}});
  });
  const result=await t.query(api.holm.catalogItems,{productIds:[source.productId]});
  expect(result[0].item).toBeNull();
});

it('keeps unavailable stock visible in the owner cost diagnostic without reopening customer offers',async()=>{
  const t=convexTest(schema,modules),source=await seed(t);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+1000);
  await t.mutation(internal.ashcroftInventory.reconcile,{source:'New zero-stock fixture',sha256:'b'.repeat(64),observedAt:Date.now(),rows:[{sku:'SOF00401401',quantity:0}]});
  expect((await t.query(api.holm.catalogPage,{paginationOpts:{cursor:null,numItems:24}})).page).toEqual([]);
  vi.stubEnv('CJ_ADMIN_EMAILS','owner@example.com');
  vi.stubEnv('DELIVERY_ADMIN_ROLES',JSON.stringify({'owner@example.com':['owner']}));
  const user=await t.run(ctx=>ctx.db.insert('users',{email:'owner@example.com'}));
  const owner=t.withIdentity({subject:`${user}|fixture`,email:'owner@example.com'});
  const report=await owner.query(api.holm.adminPricing,{});
  expect(report).toHaveLength(1);expect(report[0].productId).toBe(source.productId);
  expect(report[0].flags).toContain('Availability review required: not a current offer');
});

it('does not use a product-level landed estimate to replace a missing variant supplier cost',async()=>{
  const t=convexTest(schema,modules),source=await seed(t);
  await t.run(async ctx=>{
    const linked=await ctx.db.insert('products',{name:'Linked fixture',price:90,description:'Fixture',images:[],category:'chairs',collection:'furniture',estimatedLandedCost:100});
    await ctx.db.patch(source.productId,{provider:'owner_managed',cjProductId:linked});
    await ctx.db.patch(source.listingId,{fulfillment:source.variants.map(v=>({...v,cost:0}))});
  });
  expect((await t.query(api.holm.catalogPage,{paginationOpts:{cursor:null,numItems:24}})).page).toEqual([]);
});
