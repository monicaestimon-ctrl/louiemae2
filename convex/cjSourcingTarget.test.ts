import { describe, expect, it, vi } from 'vitest';
vi.mock('./auth', () => ({ auth: { getUserId: vi.fn() } }));
import { markAttemptSending } from './cjSourcingJobs';
const handler = (
  markAttemptSending as unknown as { _handler: (ctx: any, args: any) => Promise<any> }
)._handler;
describe('legacy sourcing purchase targets', () => {
  it('removes retail targets from an unsent prepared attempt without changing its correlation ID', async () => {
    const ctx = {
      db: {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            _id: 'j',
            leaseToken: 'lease',
            state: 'submitting',
            activeAttemptId: 'a',
          })
          .mockResolvedValueOnce({
            _id: 'a',
            state: 'prepared',
            payloadSnapshot: {
              productName: 'Chair',
              productUrl: 'https://example.com/chair',
              productImage: 'https://example.com/chair.jpg',
              thirdProductId: 'lm:p:g1',
              price: '899',
            },
          }),
        patch: vi.fn(),
      },
    };
    expect(await handler(ctx, { jobId: 'j', leaseToken: 'lease' })).toBe(true);
    const update = ctx.db.patch.mock.calls[0][1];
    expect(update.payloadSnapshot).not.toHaveProperty('price');
    expect(update.payloadSnapshot.thirdProductId).toBe('lm:p:g1');
    expect(update.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
