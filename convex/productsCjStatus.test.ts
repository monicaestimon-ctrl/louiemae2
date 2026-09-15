import { describe, expect, it, vi } from 'vitest';

vi.mock('./cjAdminAccess', () => ({
  requireCjAdminIdentity: vi.fn(async () => ({ email: 'admin@example.com' })),
}));

import { getProductsWithCjVariants } from './products';

const handler = (getProductsWithCjVariants as unknown as {
  _handler: (ctx: unknown, args: Record<string, never>) => Promise<Array<{ _id: string; mappingSummary: { issueCodes: string[] } }>>;
})._handler;

describe('CJ variant queue approval states', () => {
  it('never reports pending or rejected sourcing as fulfillment ready', async () => {
    const products = [
      {
        _id: 'pending',
        _creationTime: 1,
        name: 'Pending Product',
        images: [],
        cjSourcingStatus: 'pending',
        cjFulfillmentReadiness: 'ready',
        cjSourcingState: 'fulfillment_ready',
        variants: [],
      },
      {
        _id: 'rejected',
        _creationTime: 2,
        name: 'Rejected Product',
        images: [],
        cjSourcingStatus: 'rejected',
        variants: [],
      },
    ];
    const ctx = {
      db: {
        query: vi.fn(() => ({ take: vi.fn(async () => products) })),
      },
    };

    const result = await handler(ctx, {});

    expect(result.find((product) => product._id === 'pending')?.mappingSummary.issueCodes).toContain('CJ_APPROVAL_PENDING');
    expect(result.find((product) => product._id === 'pending')?.mappingSummary.issueCodes).not.toContain('READY');
    expect(result.find((product) => product._id === 'rejected')?.mappingSummary.issueCodes).toContain('CJ_REJECTED');
  });
});
