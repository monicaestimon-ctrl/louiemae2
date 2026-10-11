// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.test' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const cleanup = makeFunctionReference<'mutation'>('dataLifecycle:cleanup');
const report = makeFunctionReference<'query'>('dataLifecycle:report');
async function fixture(jobStatus: 'ready' | 'processing' | 'completed' | 'cancelled', itemStatus: 'ready' | 'fetching' | 'pending' | 'error' | 'imported' | 'skipped') {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    await ctx.db.insert('webhookExpiryState', {key:'webhook-expiry-v1',epoch:1,phase:'verified',cursor:null,checked:0,mismatchIds:[],updatedAt:Date.now()});
    const job = await ctx.db.insert('batchImportJobs', {status:jobStatus,total:1,fetchConcurrency:3,reviewBatchSize:12,createdAt:1,updatedAt:1,expiresAt:2});
    const item = await ctx.db.insert('batchImportItems', {jobId:job,position:0,inputUrl:'https://example.test/chair',normalizedUrl:'https://example.test/chair',status:itemStatus,stage:'Review',attempts:1,createdAt:1,updatedAt:1,result:{legacy:'keep'},expiresAt:2});
    const payload = await ctx.db.insert('batchImportPayloads', {jobId:job,itemId:item,version:1,byteLength:20,result:{description:'unsaved review'},createdAt:1,expiresAt:2});
    return {job,item,payload};
  });
  return {t,...ids};
}
describe('temporary import retention', () => {
  it.each([['ready','ready'],['processing','fetching'],['completed','ready'],['cancelled','ready'],['completed','pending'],['completed','error']] as const)('preserves unfinished %s/%s work despite expiration', async (jobStatus,itemStatus) => {
    const {t,job,item,payload}=await fixture(jobStatus,itemStatus);
    const before=await t.run(async ctx=>Promise.all([ctx.db.get(job),ctx.db.get(item),ctx.db.get(payload)]));
    expect((await t.query(report,{limit:5})).candidates).toMatchObject({batchPayloads:0,terminalBatchJobs:0});
    expect((await t.mutation(cleanup,{dryRun:true,limit:5})).eligible).toMatchObject({batchPayloads:0,terminalBatchJobs:0});
    await t.mutation(cleanup,{dryRun:false,limit:5});
    expect(await t.run(async ctx=>Promise.all([ctx.db.get(job),ctx.db.get(item),ctx.db.get(payload)]))).toEqual(before);
  });
  it.each([['completed','imported'],['cancelled','skipped']] as const)('still previews and cleans finished %s/%s records',async(jobStatus,itemStatus)=>{
    const {t,job,item,payload}=await fixture(jobStatus,itemStatus);
    expect((await t.query(report,{limit:5})).candidates).toMatchObject({batchPayloads:1,terminalBatchJobs:1});
    await t.mutation(cleanup,{dryRun:true,limit:5});
    expect(await t.run(ctx=>ctx.db.get(payload))).not.toBeNull();
    await t.mutation(cleanup,{dryRun:false,limit:5});
    expect(await t.run(async ctx=>Promise.all([ctx.db.get(job),ctx.db.get(item),ctx.db.get(payload)]))).toEqual([null,null,null]);
  });
  it('preserves an orphan payload for investigation instead of assuming it is disposable',async()=>{
    const {t,item,payload}=await fixture('ready','ready');
    await t.run(ctx=>ctx.db.delete(item));
    const before=await t.run(ctx=>ctx.db.get(payload));
    await t.mutation(cleanup,{dryRun:false,limit:5});
    expect(await t.run(ctx=>ctx.db.get(payload))).toEqual(before);
  });
  it('checks unfinished items beyond the 200-item deletion page',async()=>{
    const {t,job,item,payload}=await fixture('completed','imported');
    await t.run(async ctx=>{
      const original=(await ctx.db.get(item))!;
      const {_id: ignoredId,_creationTime: ignoredTime,...fields}=original;
      void ignoredId; void ignoredTime;
      for(let n=0;n<200;n++)await ctx.db.insert('batchImportItems',{...fields,position:n+1});
      await ctx.db.insert('batchImportItems',{...fields,position:201,status:'ready'});
    });
    expect((await t.query(report,{limit:5})).candidates.terminalBatchJobs).toBe(0);
    await t.mutation(cleanup,{dryRun:false,limit:5});
    expect(await t.run(ctx=>ctx.db.get(job))).not.toBeNull();
    expect(await t.run(ctx=>ctx.db.query('batchImportItems').collect())).toHaveLength(202);
    // An already-imported item's redundant payload can still be released.
    expect(await t.run(ctx=>ctx.db.get(payload))).toBeNull();
  });
});
