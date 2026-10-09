// @vitest-environment node
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
import { requireCjAdminIdentity } from './cjAdminAccess';

vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })) }));
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const claim = makeFunctionReference<'mutation'>('cjHelpers:claimWebhookProcessing');
const processed = makeFunctionReference<'mutation'>('cjHelpers:markWebhookProcessed');
const failed = makeFunctionReference<'mutation'>('cjHelpers:markWebhookFailed');
const wasProcessed = makeFunctionReference<'query'>('cjHelpers:wasWebhookProcessed');
const preview = makeFunctionReference<'query'>('webhookRetention:preview');
const storageSample = makeFunctionReference<'query'>('webhookRetention:storageSample');
const compact = makeFunctionReference<'mutation'>('webhookRetention:compact');
const cleanup = makeFunctionReference<'mutation'>('dataLifecycle:cleanup');
const payload = { messageId: 'event-1', type: 'ORDER', data: 'x'.repeat(100_000) };
const oldLog = { messageId: 'old-event', type: 'ORDER', processedAt: '2026-01-01T00:00:00.000Z', payload, expiresAt: 1 };

describe('webhook payload retention and deduplication', () => {
  it('samples only the indexed age window, bounds rows, redacts contents and preserves source records', async () => {
    const t = convexTest(schema, modules);
    const before = await t.run(async ctx => {
      for (let i = 0; i < 9; i++) await ctx.db.insert('cjWebhookLog', {
        ...oldLog, messageId: `private-${i}`, payload: { confidential: 'é'.repeat(20) },
        lastError: 'private diagnostic', claimToken: 'private token',
        status: i === 1 ? 'failed' : 'processed',
      });
      return ctx.db.query('cjWebhookLog').collect();
    });
    const sample = await t.query(storageSample, { fromInclusive: before[1]._creationTime, toExclusive: before[7]._creationTime });
    expect(sample.selection).toBe('earliest_in_window');
    expect(sample.windowExhausted).toBe(false);
    expect(sample.records.map((row: { id: string }) => row.id)).toEqual(before.slice(1, 6).map(row => row._id));
    expect(sample.records[0]).toMatchObject({ status: 'failed', eligible: false, hasPayload: true });
    expect(sample.records[1]).toMatchObject({ status: 'processed', eligible: true });
    expect(sample.records[0].approximatePayloadJsonBytes).toBe(new globalThis.TextEncoder().encode(JSON.stringify(before[1].payload)).length);
    expect(JSON.stringify(sample)).not.toMatch(/confidential|private diagnostic|private token|private-1/);
    expect(await t.run(ctx => ctx.db.query('cjWebhookLog').collect())).toEqual(before);
    expect(await t.query(storageSample, { fromInclusive: before[0]._creationTime, toExclusive: before[1]._creationTime }))
      .toMatchObject({ windowExhausted: true, records: [{ id: before[0]._id }] });
    expect(await t.query(storageSample, { fromInclusive: 0, toExclusive: 1 })).toMatchObject({ windowExhausted: true, records: [] });
  });

  it('requires admin access and valid storage-sample boundaries', async () => {
    const t = convexTest(schema, modules);
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.query(storageSample, { fromInclusive: 0, toExclusive: 1 })).rejects.toThrow('Not an admin');
    for (const args of [{ fromInclusive: -1, toExclusive: 1 }, { fromInclusive: 1, toExclusive: 1 }, { fromInclusive: 2, toExclusive: 1 }]) {
      await expect(t.query(storageSample, args)).rejects.toThrow('creation-time window');
    }
  });

  it('clears a successful payload but preserves duplicate suppression indefinitely', async () => {
    const t = convexTest(schema, modules);
    const args = { messageId: 'event-1', type: 'ORDER', payload };
    const reservation = await t.mutation(claim, args);
    await t.mutation(processed, { messageId: args.messageId, type: args.type, claimToken: reservation.claimToken });
    const row = await t.run(ctx => ctx.db.query('cjWebhookLog').first());
    expect(row).toMatchObject({ status: 'processed', expiresAt: 0 });
    expect(row).not.toHaveProperty('payload');
    expect(JSON.stringify(row).length).toBeLessThan(1000);
    expect(await t.query(wasProcessed, { messageId: args.messageId })).toBe(true);
    expect(await t.mutation(claim, args)).toEqual({ claimed: false, status: 'processed' });
    expect(await t.query(preview, { cursor: null })).toMatchObject({ records: [] });
  });

  it('retains failed payloads and rejects completion by a stale claim owner', async () => {
    const t = convexTest(schema, modules);
    const reservation = await t.mutation(claim, { messageId: 'event-1', type: 'ORDER', payload });
    await t.mutation(processed, { messageId: 'event-1', type: 'ORDER', claimToken: 'stale-owner' });
    expect(await t.run(ctx => ctx.db.query('cjWebhookLog').first())).toMatchObject({ status: 'processing', payload });
    await t.mutation(failed, { messageId: 'event-1', type: 'ORDER', claimToken: reservation.claimToken });
    const row = await t.run(ctx => ctx.db.query('cjWebhookLog').first());
    await t.run(ctx => ctx.db.patch(row!._id, { expiresAt: 1 }));
    expect(await t.mutation(compact, { ids: [row!._id], dryRun: false })).toMatchObject({ identitiesDeleted: 0, results: [{ eligible: false, compacted: false }] });
    expect(await t.run(ctx => ctx.db.get(row!._id))).toMatchObject({ payload, status: 'failed' });
    expect(await t.mutation(claim, { messageId: 'event-1', type: 'ORDER' })).toMatchObject({ claimed: true });
    expect(await t.run(ctx => ctx.db.get(row!._id))).toHaveProperty('payload');
  });

  it('supports dry run and idempotent compaction of legacy successes without deleting identities', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(ctx => ctx.db.insert('cjWebhookLog', oldLog));
    expect(await t.query(preview, { cursor: null })).toMatchObject({ records: [{ id, eligible: true, approximatePayloadBytes: expect.any(Number) }] });
    await t.mutation(compact, { ids: [id], dryRun: true });
    expect(await t.run(ctx => ctx.db.get(id))).toHaveProperty('payload');
    await t.mutation(compact, { ids: [id], dryRun: false });
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ messageId: 'old-event', expiresAt: 0 });
    expect(await t.query(wasProcessed, { messageId: 'old-event' })).toBe(true);
    expect(await t.mutation(compact, { ids: [id], dryRun: false })).toMatchObject({ results: [{ compacted: false }] });
  });

  it('advances past unresolved pages and excludes missing or cleared expiration metadata', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 6; i++) await ctx.db.insert('cjWebhookLog', { ...oldLog, messageId: `failed-${i}`, status: 'failed' });
      await ctx.db.insert('cjWebhookLog', { ...oldLog, messageId: 'ready', status: 'processed', expiresAt: 2 });
      await ctx.db.insert('cjWebhookLog', { ...oldLog, messageId: 'missing', expiresAt: undefined });
      await ctx.db.insert('cjWebhookLog', { ...oldLog, messageId: 'cleared', expiresAt: 0 });
    });
    const first = await t.query(preview, { cursor: null });
    expect(first.records).toHaveLength(5);
    expect(first.records.every((row: { eligible: boolean }) => !row.eligible)).toBe(true);
    const second = await t.query(preview, { cursor: first.cursor });
    expect(second.records).toHaveLength(2);
    expect(second.records.filter((row: { eligible: boolean }) => row.eligible)).toHaveLength(1);
    expect(second.complete).toBe(true);
  });

  it('general lifecycle cleanup preserves failed, unexpired and missing-expiry records', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => ({
      failed: await ctx.db.insert('cjWebhookLog', { ...oldLog, status: 'failed' }),
      future: await ctx.db.insert('cjWebhookLog', { ...oldLog, messageId: 'future', status: 'processed', expiresAt: Date.now() + 86_400_000 }),
      missing: await ctx.db.insert('cjWebhookLog', { ...oldLog, messageId: 'missing', expiresAt: undefined }),
      success: await ctx.db.insert('cjWebhookLog', { ...oldLog, messageId: 'success', status: 'processed' }),
    }));
    await t.mutation(cleanup, { dryRun: false, now: Date.now() + 10 * 86_400_000 });
    for (const id of [ids.failed, ids.future, ids.missing]) expect(await t.run(ctx => ctx.db.get(id))).toHaveProperty('payload');
    expect(await t.run(ctx => ctx.db.get(ids.success))).not.toHaveProperty('payload');
    expect(await t.run(ctx => ctx.db.query('cjWebhookLog').collect())).toHaveLength(4);
  });

  it('enforces admin access and bounded, distinct reviewed IDs', async () => {
    const t = convexTest(schema, modules);
    vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
    await expect(t.query(preview, { cursor: null })).rejects.toThrow('Not an admin');
    await expect(t.mutation(compact, { ids: [], dryRun: false })).rejects.toThrow('one and five');
    const id = await t.run(ctx => ctx.db.insert('cjWebhookLog', oldLog));
    await expect(t.mutation(compact, { ids: [id, id], dryRun: false })).rejects.toThrow('distinct');
    expect(await t.run(ctx => ctx.db.get(id))).toHaveProperty('payload');
  });
});
