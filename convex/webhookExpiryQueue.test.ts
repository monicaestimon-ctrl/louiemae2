// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { expiredWebhookRows, syncExpiry } from './webhookExpiryMaintenance';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ref = (name: string) => makeFunctionReference<'mutation'>(name);
const initialize = ref('webhookExpiryQueue:initializeEmpty');
const base = (messageId: string) => ({ messageId, type: 'STOCK', processedAt: '2026-01-01T00:00:00.000Z' });
describe('webhook expiry after history-index retirement', () => {
  it('fails closed until verified and only initializes empty deployments', async () => {
    const t = convexTest(schema, modules);
    await expect(t.run(ctx => expiredWebhookRows(ctx, Date.now(), 5))).rejects.toThrow('NOT_VERIFIED');
    const state = await t.mutation(initialize, {});
    expect(await t.mutation(initialize, {})).toEqual(state);
    await expect(t.mutation(ref('webhookExpiryQueue:begin'), {})).rejects.toThrow('Restore cjWebhookLog.by_expiry');
    await expect(t.mutation(ref('webhookExpiryQueue:advance'), { expectedEpoch: 1, expectedPhase: 'source', expectedCursor: null })).rejects.toThrow('Restore cjWebhookLog.by_expiry');
    const existing = convexTest(schema, modules);
    await existing.run(ctx => ctx.db.insert('cjWebhookLog', base('legacy')));
    await expect(existing.mutation(initialize, {})).rejects.toThrow('Restore cjWebhookLog.by_expiry');
  });
  it('keeps duplicate protection and updates expiry membership with claim ownership', async () => {
    const t = convexTest(schema, modules); await t.mutation(initialize, {});
    const args = { messageId: 'live', type: 'STOCK', payload: { stock: 4 } };
    const first = await t.mutation(ref('cjHelpers:claimWebhookProcessing'), args);
    await t.mutation(ref('cjHelpers:markWebhookRetryable'), { messageId: args.messageId, type: args.type, claimToken: first.claimToken, error: 'temporary' });
    const retry = await t.mutation(ref('cjHelpers:claimWebhookProcessing'), args);
    await t.mutation(ref('cjHelpers:markWebhookProcessed'), { messageId: args.messageId, type: args.type, claimToken: first.claimToken });
    expect(await t.run(ctx => ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(1);
    await t.mutation(ref('cjHelpers:markWebhookProcessed'), { messageId: args.messageId, type: args.type, claimToken: retry.claimToken });
    expect(await t.run(ctx => ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(0);
    expect(await t.mutation(ref('cjHelpers:claimWebhookProcessing'), args)).toEqual({ claimed: false, status: 'processed' });
  });
  it('matches expired selection and ordering while preserving unresolved payloads and all receipts', async () => {
    const t = convexTest(schema, modules); await t.mutation(initialize, {});
    const before = await t.run(async ctx => {
      for (let i = 0; i < 100; i++) await ctx.db.insert('cjWebhookLog', base(`legacy-${i}`));
      for (let i = 0; i < 13; i++) { const id = await ctx.db.insert('cjWebhookLog', { ...base(`expiry-${i}`), expiresAt: i < 8 ? 1 : Date.now() + 100000, status: i % 2 ? 'failed' : 'processed', payload: { retain: i } }); await syncExpiry(ctx, id, await ctx.db.get(id)); }
      return ctx.db.query('cjWebhookLog').collect();
    });
    const expected = before.filter(r => r.expiresAt && r.expiresAt < Date.now()).sort((a,b) => a.expiresAt! - b.expiresAt! || a._creationTime - b._creationTime);
    expect(await t.run(ctx => expiredWebhookRows(ctx, Date.now(), 5))).toEqual(expected.slice(0,5));
    const preview = makeFunctionReference<'query'>('webhookRetention:preview');
    const first = await t.query(preview, { cursor: null });
    const second = await t.query(preview, { cursor: first.cursor });
    expect([...first.records, ...second.records].map((r: {id:string}) => r.id)).toEqual(expected.map(r=>r._id));
    expect(second.complete).toBe(true);
    const failed = expected.find(r=>r.status==='failed')!;
    await t.mutation(ref('webhookRetention:compact'), { ids: [failed._id], dryRun: false });
    expect(await t.run(ctx=>ctx.db.get(failed._id))).toEqual(failed);
    expect(await t.run(ctx=>ctx.db.query('cjWebhookLog').collect())).toEqual(before);
  });
  it('detects stale derived rows and repairs only requested queue entries', async () => {
    const t = convexTest(schema, modules); await t.mutation(initialize, {});
    const id = await t.run(async ctx => { const id = await ctx.db.insert('cjWebhookLog', {...base('drift'),expiresAt:1,payload:'keep'});await syncExpiry(ctx,id,await ctx.db.get(id));await ctx.db.patch(id,{expiresAt:0});return id; });
    await expect(t.run(ctx=>expiredWebhookRows(ctx,Date.now(),5))).rejects.toThrow('DRIFT');
    await expect(t.mutation(ref('webhookExpiryQueue:repair'),{ids:Array(6).fill(id)})).rejects.toThrow('at most five');
    await t.mutation(ref('webhookExpiryQueue:repair'),{ids:[id]});
    expect(await t.run(ctx=>expiredWebhookRows(ctx,Date.now(),5))).toEqual([]);
    expect(await t.run(ctx=>ctx.db.get(id))).toMatchObject({payload:'keep'});
  });
  it('requires an explicit bounded cursor for legacy metadata work and maintains derived coverage', async () => {
    const t = convexTest(schema, modules);await t.mutation(initialize,{});
    await t.run(async ctx=>{for(let i=0;i<7;i++)await ctx.db.insert('cjWebhookLog',base(`legacy-${i}`));});
    const backfill=ref('dataLifecycle:backfillRetentionMetadata');
    await expect(t.mutation(backfill,{kind:'webhookLogs',dryRun:false})).rejects.toThrow('explicit cursor');
    const dry=await t.mutation(backfill,{kind:'webhookLogs',dryRun:true,cursor:null,limit:2});
    expect(dry).toMatchObject({scanned:2,candidates:2,complete:false});
    expect(await t.run(ctx=>ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(0);
    const first=await t.mutation(backfill,{kind:'webhookLogs',dryRun:false,cursor:null,limit:2});
    const second=await t.mutation(backfill,{kind:'webhookLogs',dryRun:false,cursor:first.cursor,limit:2});
    expect(second).toMatchObject({scanned:2,candidates:2,complete:false});
    expect(await t.run(ctx=>ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(4);
    expect(await t.run(ctx=>ctx.db.query('cjWebhookLog').collect())).toHaveLength(7);
  });
});
