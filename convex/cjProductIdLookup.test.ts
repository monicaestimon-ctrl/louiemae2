// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import type { Id } from './_generated/dataModel';
const modules=import.meta.glob(['./**/*.ts','./_generated/*.js']);
const lookup=makeFunctionReference<'query'>('cjHelpers:getProductByCjProductId');
const fixture={name:'Test chair',price:100,description:'Chair',images:['chair.jpg'],category:'Chairs',collection:'furniture'};
describe('CJ product-ID lookup',()=>{
 it('returns every matching listing beyond 500 records in legacy creation order, including hidden and out-of-stock listings',async()=>{
  const t=convexTest(schema,modules);
  const ids=await t.run(async ctx=>{const ids:Id<'products'>[]=[];for(let i=0;i<515;i++)ids.push(await ctx.db.insert('products',{...fixture,cjProductId:'shared',storefrontStatus:i%2?'hidden':'published',inStock:i%3!==0}));await ctx.db.insert('products',{...fixture,cjProductId:'different'});await ctx.db.insert('products',fixture);return ids;});
  const actual=await t.query(lookup,{cjProductId:'shared'});
  const legacy=await t.run(ctx=>ctx.db.query('products').filter(q=>q.eq(q.field('cjProductId'),'shared')).collect());
  expect(actual).toEqual(legacy);expect(actual.map((p:{_id:string})=>p._id)).toEqual(ids);
 });
 it('keeps exact matching for case, empty strings, missing fields and no matches',async()=>{
  const t=convexTest(schema,modules);
  await t.run(async ctx=>{for(const value of ['abc','ABC',' abc ',''])await ctx.db.insert('products',{...fixture,cjProductId:value});await ctx.db.insert('products',fixture);});
  for(const value of ['abc','ABC',' abc ','','missing']){
   const legacy=await t.run(ctx=>ctx.db.query('products').filter(q=>q.eq(q.field('cjProductId'),value)).collect());
   expect(await t.query(lookup,{cjProductId:value})).toEqual(legacy);
  }
 });
 it('reflects remapping and deletion immediately through the native index',async()=>{
  const t=convexTest(schema,modules);const id=await t.run(ctx=>ctx.db.insert('products',{...fixture,cjProductId:'old'}));
  expect(await t.query(lookup,{cjProductId:'old'})).toHaveLength(1);
  await t.run(ctx=>ctx.db.patch(id,{cjProductId:'new'}));
  expect(await t.query(lookup,{cjProductId:'old'})).toEqual([]);expect((await t.query(lookup,{cjProductId:'new'}))[0]._id).toBe(id);
  await t.run(ctx=>ctx.db.delete(id));expect(await t.query(lookup,{cjProductId:'new'})).toEqual([]);
 });
});
