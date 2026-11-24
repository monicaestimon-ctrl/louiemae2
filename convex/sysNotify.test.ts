// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import { sendRecorded } from './sysNotifySender';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval'] });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.RESEND_API_KEY = 'fixture-no-real-provider';
  process.env.FURNITURE_QUOTE_EMAIL = 'owner@example.com';
  process.env.FURNITURE_EMAIL_FROM = 'Louie Mae <sender@example.com>';
  process.env.CJ_ADMIN_EMAILS = 'owner@example.com';
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of [
    'RESEND_API_KEY',
    'FURNITURE_QUOTE_EMAIL',
    'FURNITURE_EMAIL_FROM',
    'CJ_ADMIN_EMAILS',
  ])
    delete process.env[key];
});
async function setup(legacy = false) {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert('sysNotifications', {
      dedupeKey: 'fixture',
      audience: 'customer',
      category: 'transactional',
      template: 'order_confirmation',
      to: 'customer@example.com',
      subject: 'Fixture confirmation',
      text: 'Fixture only',
      status: 'queued',
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
      ...(legacy ? {} : { deliveryVersion: 2, generation: 0 }),
    })
  );
  const uid = await t.run((ctx) => ctx.db.insert('users', { email: 'owner@example.com' }));
  return { t, id, admin: t.withIdentity({ subject: `${uid}|s`, email: 'owner@example.com' }) };
}
describe('transactional outbox recovery', () => {
  it('retries identical payloads and records only actual provider acceptance', async () => {
    const s = await setup();
    fetchMock
      .mockResolvedValueOnce(new Response('{"name":"application_error"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"id":"provider-receipt-1"}', { status: 200 }));
    await s.t.action(internal.sysNotify.deliver, { id: s.id });
    let n = (await s.t.run((ctx) => ctx.db.get(s.id)))!;
    expect(n.status).toBe('failed');
    expect(n.providerId).toBeUndefined();
    process.env.FURNITURE_EMAIL_FROM = 'Changed <changed@example.com>';
    process.env.FURNITURE_QUOTE_EMAIL = 'new-owner@example.com';
    vi.setSystemTime(n.nextAttemptAt);
    await s.t.action(internal.sysNotify.deliver, { id: s.id });
    await s.t.action(internal.sysNotify.deliver, { id: s.id });
    n = (await s.t.run((ctx) => ctx.db.get(s.id)))!;
    expect(n.status).toBe('sent');
    expect(n.providerId).toBe('provider-receipt-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe(
      fetchMock.mock.calls[1][1].headers['Idempotency-Key']
    );
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  });
  it('does not report missing configuration, permanent errors or legacy sends as successful', async () => {
    const s = await setup();
    delete process.env.RESEND_API_KEY;
    await s.t.action(internal.sysNotify.deliver, { id: s.id });
    expect(await s.t.run((ctx) => ctx.db.get(s.id))).toMatchObject({
      status: 'failed',
      reviewRequired: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.RESEND_API_KEY = 'fixture';
    const legacy = await setup(true);
    await legacy.t.action(internal.sysNotify.deliver, { id: legacy.id });
    expect(await legacy.t.run((ctx) => ctx.db.get(legacy.id))).toMatchObject({
      status: 'failed',
      reviewRequired: true,
    });
    const denied = await setup();
    fetchMock.mockResolvedValueOnce(
      new Response('{"name":"validation_error","message":"private detail"}', { status: 400 })
    );
    await denied.t.action(internal.sysNotify.deliver, { id: denied.id });
    const row = await denied.t.run((ctx) => ctx.db.get(denied.id));
    expect(row).toMatchObject({ status: 'failed', reviewRequired: true });
    expect(row?.lastError).not.toContain('private detail');
  });
  it('recovers abandoned leases and fences late attempts', async () => {
    const s = await setup();
    const first = await s.t.mutation(internal.sysNotify.claim, { id: s.id });
    vi.setSystemTime(Date.now() + 121000);
    await s.t.mutation(internal.sysNotify.recover, {});
    const second = await s.t.mutation(internal.sysNotify.claim, { id: s.id });
    expect(second?.attempts).toBe(2);
    expect(
      await s.t.mutation(internal.sysNotify.result, {
        id: s.id,
        attempt: first!.attempts,
        generation: 0,
        ok: true,
        providerId: 'late',
      })
    ).toBe(false);
    expect(
      await s.t.mutation(internal.sysNotify.result, {
        id: s.id,
        attempt: second!.attempts,
        generation: 0,
        ok: true,
        providerId: 'accepted',
      })
    ).toBe(true);
  });
  it('holds work outside the safe idempotency window and requires audited reconciliation', async () => {
    const s = await setup();
    await s.t.mutation(internal.sysNotify.claim, { id: s.id });
    vi.setSystemTime(Date.now() + 24 * 3600000);
    await s.t.mutation(internal.sysNotify.recover, {});
    expect(await s.t.run((ctx) => ctx.db.get(s.id))).toMatchObject({
      status: 'failed',
      reviewRequired: true,
    });
    await expect(
      s.t.mutation(api.sysNotifyAdmin.resolve, {
        id: s.id,
        decision: 'retry_not_sent',
        evidence: 'Fixture',
        confirmedNotSent: true,
      })
    ).rejects.toThrow();
    await expect(
      s.admin.mutation(api.sysNotifyAdmin.resolve, {
        id: s.id,
        decision: 'retry_not_sent',
        evidence: 'Fixture',
      })
    ).rejects.toThrow();
    await s.admin.mutation(api.sysNotifyAdmin.resolve, {
      id: s.id,
      decision: 'retry_not_sent',
      evidence: 'Fixture provider records confirm not accepted',
      confirmedNotSent: true,
    });
    const fresh = await s.t.mutation(internal.sysNotify.claim, { id: s.id });
    expect(fresh).toMatchObject({ attempts: 1, generation: 1 });
    expect(
      await s.t.mutation(internal.sysNotify.result, {
        id: s.id,
        attempt: 1,
        generation: 0,
        ok: true,
        providerId: 'old-generation',
      })
    ).toBe(false);
    await s.t.mutation(internal.sysNotify.result, {
      id: s.id,
      attempt: 1,
      generation: 1,
      ok: true,
      providerId: 'new-generation',
    });
    await expect(
      s.admin.mutation(api.sysNotifyAdmin.resolve, {
        id: s.id,
        decision: 'retry_not_sent',
        evidence: 'Must not resend accepted message',
        confirmedNotSent: true,
      })
    ).rejects.toThrow();
    expect(await s.t.run((ctx) => ctx.db.query('sysAuditEvents').collect())).toHaveLength(1);
  });
  it('bounds retries and recovers legacy sending rows without replay', async () => {
    const legacy = await setup(true);
    await legacy.t.run((ctx) => ctx.db.patch(legacy.id, { status: 'sending', attempts: 1 }));
    await legacy.t.mutation(internal.sysNotify.recover, {});
    expect(await legacy.t.run((ctx) => ctx.db.get(legacy.id))).toMatchObject({
      status: 'failed',
      reviewRequired: true,
    });
    const s = await setup();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = await s.t.mutation(internal.sysNotify.claim, { id: s.id });
      expect(claim?.attempts).toBe(attempt);
      await s.t.mutation(internal.sysNotify.result, {
        id: s.id,
        attempt,
        generation: 0,
        ok: false,
        error: 'Transient fixture',
        retryable: true,
      });
      const row = (await s.t.run((ctx) => ctx.db.get(s.id)))!;
      if (attempt < 5) vi.setSystemTime(row.nextAttemptAt);
    }
    expect(await s.t.run((ctx) => ctx.db.get(s.id))).toMatchObject({
      status: 'failed',
      reviewRequired: true,
      attempts: 5,
    });
    expect(await s.t.mutation(internal.sysNotify.claim, { id: s.id })).toBeNull();
  });

  it('aborts stalled transport and never stores a raw provider error', async () => {
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('private provider payload'))
          );
        })
    );
    const sending = sendRecorded(
      { from: 'a@example.com', to: 'b@example.com', subject: 'Fixture', text: 'Fixture' },
      'fixture'
    );
    await vi.advanceTimersByTimeAsync(10000);
    const result = await sending;
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain('private provider payload');
  });

  it('never accepts a successful HTTP response without a provider receipt', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(
      await sendRecorded(
        { from: 'a@example.com', to: 'b@example.com', subject: 'Fixture', text: 'Fixture' },
        'fixture'
      )
    ).toMatchObject({ ok: false, retryable: false });
  });
});
