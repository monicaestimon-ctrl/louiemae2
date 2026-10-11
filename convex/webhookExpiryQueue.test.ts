// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { checkedExpirySource, syncExpiry } from './webhookExpiryMaintenance';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const ref = (name: string) => makeFunctionReference<'mutation'>(name);
const begin = ref('webhookExpiryQueue:begin');
const advance = ref('webhookExpiryQueue:advance');
const claim = ref('cjHelpers:claimWebhookProcessing');
const processed = ref('cjHelpers:markWebhookProcessed');
const base = (messageId: string) => ({ messageId, type: 'STOCK', processedAt: '2026-01-01T00:00:00.000Z' });
const step = (s: any) => ({ expectedEpoch: s.epoch, expectedPhase: s.phase, expectedCursor: s.cursor });
async function finish(t: ReturnType<typeof convexTest>, s: any) {
  for (let i = 0; i < 100 && !['verified', 'failed'].includes(s.phase); i++) s = await t.mutation(advance, step(s));
  expect(s.phase).toBe('verified'); return s;
}
describe('webhook expiry queue migration', () => {
  it('bounds source pages at fifty and payload dereference pages at five', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => { for(let i=0;i<52;i++) await ctx.db.insert('cjWebhookLog',{...base('bounded-'+i),expiresAt:1}); });
    let state = await t.mutation(begin, {});
    state = await t.mutation(advance, step(state));
    expect(state).toMatchObject({phase:'backfill',checked:50});
    state = await t.mutation(advance, step(state));
    expect(state).toMatchObject({phase:'source',checked:52});
    state = await t.mutation(advance, step(state));
    expect(state).toMatchObject({phase:'source',checked:102});
    state = await t.mutation(advance, step(state));
    expect(state).toMatchObject({phase:'queue',checked:104});
    state = await t.mutation(advance, step(state));
    expect(state).toMatchObject({phase:'queue',checked:109});
  });
  it('indexes only positive expiries, verifies both directions, and never rewrites source history', async () => {
    const t = convexTest(schema, modules);
    const before = await t.run(async ctx => {
      for (let i = 0; i < 100; i++) await ctx.db.insert('cjWebhookLog', base(`legacy-${i}`));
      await ctx.db.insert('cjWebhookLog', { ...base('cleared'), expiresAt: 0 });
      for (let i = 0; i < 13; i++) await ctx.db.insert('cjWebhookLog', { ...base(`expiring-${i}`), expiresAt: i + 1, status: i % 2 ? 'failed' : 'processed', payload: { keep: i } });
      return ctx.db.query('cjWebhookLog').collect();
    });
    const initial = await t.mutation(begin, {});
    expect(await t.mutation(begin, {})).toEqual(initial);
    const done = await finish(t, initial);
    expect(done.checked).toBe(39);
    expect(await t.run(ctx => ctx.db.query('cjWebhookLog').collect())).toEqual(before);
    expect(await t.run(ctx => ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(13);
    await expect(t.mutation(advance, step(initial))).rejects.toThrow('WEBHOOK_EXPIRY_STALE_CURSOR');
  });
  it('tracks new claims, retries and completion transactionally during migration', async () => {
    const t = convexTest(schema, modules);
    const initial = await t.mutation(begin, {});
    const args = { messageId: 'live', type: 'STOCK', payload: { stock: 4 } };
    const reserved = await t.mutation(claim, args);
    expect(await t.run(ctx => ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(1);
    await t.mutation(ref('cjHelpers:markWebhookRetryable'), { messageId: args.messageId, type: args.type, claimToken: reserved.claimToken, error: 'temporary' });
    const retry = await t.mutation(claim, args);
    await t.mutation(processed, { messageId: args.messageId, type: args.type, claimToken: reserved.claimToken });
    expect(await t.run(ctx => ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(1);
    await finish(t, initial);
    await t.mutation(processed, { messageId: args.messageId, type: args.type, claimToken: retry.claimToken });
    expect(await t.run(ctx => ctx.db.query('webhookExpiryQueue').collect())).toHaveLength(0);
    expect(await t.mutation(claim, args)).toEqual({ claimed: false, status: 'processed' });
  });
  it('detects missing and orphaned queue rows and supports bounded derived-only repair', async () => {
    for (const kind of ['missing', 'orphan']) {
      const t = convexTest(schema, modules);
      const id = await t.run(ctx => ctx.db.insert('cjWebhookLog', { ...base(kind), expiresAt: 1, payload: 'retained' }));
      let s = await t.mutation(begin, {});
      s = await t.mutation(advance, step(s));
      await t.run(async ctx => {
        const entry = await ctx.db.query('webhookExpiryQueue').unique();
        if (kind === 'missing') await ctx.db.delete(entry!._id);
        else await ctx.db.patch(id, { expiresAt: 0 }); // Simulate an unsupported raw writer.
      });
      for (let i = 0; i < 5 && s.phase !== 'failed'; i++) s = await t.mutation(advance, step(s));
      expect(s).toMatchObject({ phase: 'failed', mismatchIds: [id] });
      await expect(t.mutation(ref('webhookExpiryQueue:repair'), { ids: Array(6).fill(id) })).rejects.toThrow('at most five');
      await t.mutation(ref('webhookExpiryQueue:repair'), { ids: [id] });
      await finish(t, await t.mutation(begin, {}));
      expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ payload: 'retained' });
    }
  });
  it('refuses stale queue reads and retains expiry ordering for equal timestamps', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 7; i++) { const id = await ctx.db.insert('cjWebhookLog', { ...base(`same-${i}`), expiresAt: 1 }); await syncExpiry(ctx, id, await ctx.db.get(id)); }
    });
    const expected = await t.run(ctx => ctx.db.query('cjWebhookLog').withIndex('by_expiry').collect());
    const entries = await t.run(ctx => ctx.db.query('webhookExpiryQueue').withIndex('by_expiry').collect());
    expect(entries.map(x => x.webhookId)).toEqual(expected.map(x => x._id));
    await t.run(ctx => ctx.db.patch(expected[0]._id, { expiresAt: 2 }));
    await expect(t.run(ctx => checkedExpirySource(ctx, entries[0]))).rejects.toThrow('WEBHOOK_EXPIRY_QUEUE_DRIFT');
  });
});

