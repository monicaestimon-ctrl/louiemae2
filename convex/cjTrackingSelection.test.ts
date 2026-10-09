import { convexTest } from 'convex-test';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { makeFunctionReference } from 'convex/server';
import { internalAction } from './_generated/server';
import { v } from 'convex/values';
import schema from './schema';
const calls: string[] = [];
const modules = {
  ...import.meta.glob(['./**/*.ts', './_generated/*.js']),
  './cjDropshipping.ts': async () => ({ ...await import('./cjDropshipping'),
    getTrackingInfo: internalAction({args:{orderId:v.id('orders'),cjOrderId:v.string()},handler:async(ctx,args)=>{
      calls.push(args.cjOrderId);
      if(args.cjOrderId==='failure') return {success:false,error:'Provider unavailable'};
      await ctx.runMutation(makeFunctionReference<'mutation'>('cjHelpers:updateOrderTracking'),{orderId:args.orderId,cjStatus:'shipped'});
      return {success:true};
    }}),
  }),
};
const fixture={customerEmail:'fixture@example.test',items:[],subtotal:10,total:10,currency:'usd',status:'paid' as const,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};
const pageRef=makeFunctionReference<'query'>('cjHelpers:getOrdersNeedingSyncPage');
const syncRef=makeFunctionReference<'action'>('cjDropshipping:syncAllTracking');
afterEach(()=>{vi.useRealTimers();calls.length=0;});
describe('indexed tracking selection and sync',()=>{
 it('includes legacy timestamps, excludes terminal and recently synced orders, and visits every page',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
  const t=convexTest(schema,modules);
  const expected=await t.run(async ctx=>{
   const ids=[];
   for(let i=0;i<63;i++)ids.push(await ctx.db.insert('orders',{...fixture,cjStatus:'processing',cjOrderId:'due-'+i,...(i%2?{cjLastSyncAt:'2026-10-09T10:00:00.000Z'}:{})}));
   for(const cjStatus of ['delivered','cancelled','failed','pending','sending'] as const)await ctx.db.insert('orders',{...fixture,cjStatus});
   await ctx.db.insert('orders',{...fixture,cjStatus:'processing',cjLastSyncAt:'2026-10-09T11:00:00.000Z'});
   await ctx.db.insert('orders',{...fixture,cjStatus:'processing',cjLastSyncAt:'2026-10-09T11:30:00.000Z'});
   return ids;
  });
  const actual=[];let cursor:string|null=null,done=false,pages=0;
  while(!done){const result: {page:{_id:string}[];continueCursor:string;isDone:boolean}=await t.query(pageRef,{status:'processing',cutoff:'2026-10-09T11:00:00.000Z',cursor});expect(result.page.length).toBeLessThanOrEqual(10);actual.push(...result.page.map((p:{_id:string})=>p._id));cursor=result.continueCursor;done=result.isDone;pages++;}
  expect(pages).toBeGreaterThan(1);expect(new Set(actual)).toEqual(new Set(expected));expect(actual.length).toBe(63);
 });
 it('processes beyond the first page while rows leave the index range and counts failed responses',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
  const t=convexTest(schema,modules);
  await t.run(async ctx=>{
   for(let i=0;i<61;i++)await ctx.db.insert('orders',{...fixture,cjStatus:'confirmed',cjOrderId:'due-'+i});
   await ctx.db.insert('orders',{...fixture,cjStatus:'processing',cjOrderId:'failure'});
   await ctx.db.insert('orders',{...fixture,cjStatus:'shipped',cjOrderId:'shipped'});
   await ctx.db.insert('orders',{...fixture,cjStatus:'confirmed'});
  });
  expect(await t.action(syncRef,{})).toEqual({synced:62,errors:1});
  expect(calls.length).toBe(63);expect(new Set(calls).size).toBe(63);
 });
});
