// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import type { Id } from './_generated/dataModel';
vi.mock('./cjAdminAccess',()=>({requireCjAdminIdentity:vi.fn(async()=>({email:'admin@example.com'}))}));
const modules=import.meta.glob(['./**/*.ts','./_generated/*.js']);
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`cjInventoryTargets:${name}`);
const lookup=makeFunctionReference<'query'>('cjHelpers:getProductsLinkedToCjInventoryTarget');
const fixture={name:'Test chair',price:100,description:'Chair',images:['chair.jpg'],category:'Chairs',collection:'furniture',storefrontStatus:'hidden' as const};
async function migrate(t:ReturnType<typeof convexTest>){let state=await t.mutation(mutation('begin'),{});for(let n=0;!['verified','failed'].includes(state.phase)&&n<3000;n++)state=await t.mutation(mutation('advance'),{expectedPhase:state.phase,expectedCursor:state.cursor});expect(state.phase).toBe('verified');await t.mutation(mutation('setEnabled'),{enabled:true});return state;}
describe('inventory target index',()=>{
 it('preserves all legacy VID/SKU matches beyond 500 products, including hidden listings and duplicate mappings',async()=>{
  const t=convexTest(schema,modules);
  const ids=await t.run(async ctx=>{const ids:Id<'products'>[]=[];for(let n=0;n<510;n++)ids.push(await ctx.db.insert('products',{...fixture,name:`Chair ${n}`}));
   ids.push(await ctx.db.insert('products',{...fixture,cjVariantId:'shared',cjSku:'top'}));
   ids.push(await ctx.db.insert('products',{...fixture,variants:[{id:'one',name:'One',priceAdjustment:0,inStock:false,cjVariantId:'shared',cjSku:'customer'}]}));
   ids.push(await ctx.db.insert('products',{...fixture,cjVariants:[{vid:'shared',sku:'supplier',name:'Supplier',price:1}]}));
   ids.push(await ctx.db.insert('products',{...fixture,cjVariantId:'shared',cjSku:'shared',variants:[{id:'two',name:'Two',priceAdjustment:0,inStock:true,cjVariantId:'shared',cjSku:'shared'}]}));return ids;});
  const cases=[{vid:'shared'},{sku:'shared'},{sku:'supplier'},{vid:'shared',sku:'customer'},{vid:'SHARED'},{sku:'missing'},{}];
  const before=await Promise.all(cases.map(args=>t.query(lookup,args)));
  expect(before[0].map((p:{_id:string})=>p._id)).toEqual(ids.slice(510));
  await expect(t.mutation(mutation('setEnabled'),{enabled:true})).rejects.toThrow();
  await migrate(t);
  for(let n=0;n<cases.length;n++)expect(await t.query(lookup,cases[n])).toEqual(before[n]);
  expect(await t.run(ctx=>ctx.db.query('cjInventoryTargets').collect())).toHaveLength(8);
 });
 it('maintains remaps and deletion through the actual product writers after activation',async()=>{
  const t=convexTest(schema,modules);await migrate(t);
  const id=await t.mutation(makeFunctionReference<'mutation'>('products:create'),{...fixture,cjSourcingStatus:'none',variants:[{id:'one',name:'One',priceAdjustment:0,inStock:true,cjVariantId:'old'}]});
  expect((await t.query(lookup,{vid:'old'})).map((p:{_id:string})=>p._id)).toEqual([id]);
  await t.mutation(makeFunctionReference<'mutation'>('products:update'),{id,expectedRevision:1,variants:[{id:'one',name:'One',priceAdjustment:0,inStock:true,cjVariantId:'new',cjSku:'new-sku'}]});
  expect(await t.query(lookup,{vid:'old'})).toEqual([]);expect(await t.query(lookup,{vid:'new',sku:'new-sku'})).toHaveLength(1);
  await t.mutation(makeFunctionReference<'mutation'>('products:remove'),{id});
  expect(await t.query(lookup,{vid:'new'})).toEqual([]);expect(await t.run(ctx=>ctx.db.query('cjInventoryTargets').collect())).toEqual([]);
 });
 it('resumes bounded batches, rejects premature activation, and keeps a concurrent remap',async()=>{
  const t=convexTest(schema,modules);const ids=await t.run(async ctx=>{const ids:Id<'products'>[]=[];for(let n=0;n<5;n++)ids.push(await ctx.db.insert('products',{...fixture,cjSku:`sku-${n}`}));return ids;});
  const first=await t.mutation(mutation('begin'),{});
  const second=await t.mutation(mutation('advance'),{expectedPhase:first.phase,expectedCursor:first.cursor});expect(second.checked).toBe(2);
  expect((await t.mutation(mutation('advance'),{expectedPhase:first.phase,expectedCursor:first.cursor})).advanced).toBe(false);
  await expect(t.mutation(mutation('setEnabled'),{enabled:true})).rejects.toThrow('Verify');
  await t.mutation(makeFunctionReference<'mutation'>('products:update'),{id:ids[0],cjSku:'changed'});
  let state=second;for(let n=0;state.phase!=='verified'&&n<30;n++)state=await t.mutation(mutation('advance'),{expectedPhase:state.phase,expectedCursor:state.cursor});
  expect(state.phase).toBe('verified');await t.mutation(mutation('setEnabled'),{enabled:true});
  expect(await t.query(lookup,{sku:'sku-0'})).toEqual([]);expect((await t.query(lookup,{sku:'changed'}))[0]._id).toBe(ids[0]);
  await expect(t.mutation(mutation('begin'),{})).rejects.toThrow('Disable');
 });
 it('fails verification for a missing mapping and rejects stale index results after activation',async()=>{
  const t=convexTest(schema,modules);const id=await t.run(ctx=>ctx.db.insert('products',{...fixture,cjSku:'old'}));
  const first=await t.mutation(mutation('begin'),{});const second=await t.mutation(mutation('advance'),{expectedPhase:first.phase,expectedCursor:first.cursor});expect(second.phase).toBe('source');
  await t.run(ctx=>ctx.db.patch(id,{cjSku:'new'}));
  const failed=await t.mutation(mutation('advance'),{expectedPhase:second.phase,expectedCursor:second.cursor});expect(failed.phase).toBe('failed');
  await expect(t.mutation(mutation('setEnabled'),{enabled:true})).rejects.toThrow('Verify');
  await migrate(t);await t.run(ctx=>ctx.db.patch(id,{cjSku:'another'}));
  await expect(t.query(lookup,{sku:'new'})).rejects.toThrow('INVENTORY_TARGET_INDEX_DRIFT');
 });
});
