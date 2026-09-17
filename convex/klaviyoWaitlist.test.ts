import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, finish, readJob } from './klaviyoWaitlist';

function fixture() {
  const signup = { _id: 'signup', email: 'test@example.com', status: 'active' };
  const subscriber = { _id: 'subscriber', status: 'active' };
  const job = { _id: 'job', signupId: 'signup', attempts: 1, state: 'pending', nextAttemptAt: 1 };
  const records: Record<string, any> = { signup, subscriber, job };
  const ctx = { db: {
    get: vi.fn(async (id: string) => records[id]),
    patch: vi.fn(async (id: string, data: unknown) => { Object.assign(records[id], data); }),
    delete: vi.fn(),
    query: vi.fn(() => ({ withIndex: () => ({ first: async () => subscriber }) })),
  } };
  return { ctx, signup, subscriber, job };
}

afterEach(() => vi.unstubAllEnvs());
describe('durable Klaviyo delivery', () => {
  it('does nothing until explicitly enabled', async () => {
    vi.stubEnv('KLAVIYO_WAITLIST_ENABLED', 'false');
    const { ctx } = fixture();
    await (dispatch as any)._handler(ctx, {});
    expect(ctx.db.query).not.toHaveBeenCalled();
  });
  it('ignores stale workers after a newer claim', async () => {
    const { ctx } = fixture();
    expect(await (readJob as any)._handler(ctx, { id: 'job', attempt: 0 })).toBeNull();
    await (finish as any)._handler(ctx, { id: 'job', attempt: 0, outcome: 'accepted', unsubscribe: false });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it('requeues an unsubscribe that arrives during a subscribe request', async () => {
    const { ctx, signup, job } = fixture();
    signup.status = 'unsubscribed';
    await (finish as any)._handler(ctx, { id: 'job', attempt: 1, outcome: 'accepted', unsubscribe: false });
    expect(job.state).toBe('pending');
    expect(job.nextAttemptAt).toBeGreaterThan(Date.now());
  });
  it('mirrors provider suppression and removes completed jobs from the due index', async () => {
    const { ctx, signup, subscriber, job } = fixture();
    await (finish as any)._handler(ctx, { id: 'job', attempt: 1, outcome: 'suppressed', unsubscribe: false });
    expect(signup.status).toBe('unsubscribed');
    expect(subscriber.status).toBe('unsubscribed');
    expect(job.nextAttemptAt).toBeUndefined();
    expect(job.state).toBe('suppressed');
  });
  it('keeps failed requests available for retry after the specified delay', async () => {
    const { ctx, job } = fixture();
    await (finish as any)._handler(ctx, { id: 'job', attempt: 1, outcome: 'retry', unsubscribe: false, delayMs: 120000, errorCode: 429 });
    expect(job.state).toBe('pending');
    expect(job.nextAttemptAt).toBeGreaterThanOrEqual(Date.now() + 119000);
  });
});
