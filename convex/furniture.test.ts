import { describe, expect, it, vi } from 'vitest';
vi.mock('./cjAdminAccess', () => ({
  requireCjAdminIdentity: vi.fn(async () => {
    throw new Error('Unauthorized');
  }),
}));
import { save, submit, adminProducts } from './furniture';
import { blankFurniture } from '../lib/furniture';
const handler = (fn: unknown) =>
  (fn as { _handler: (ctx: any, args: any) => Promise<any> })._handler;
function context(existing: any = null) {
  const chain: any = {
    withIndex: () => chain,
    unique: async () => existing,
    order: () => chain,
    take: async () => [],
  };
  return {
    db: {
      query: () => chain,
      get: vi.fn(async () => ({
        ...blankFurniture(),
        _id: 'p',
        name: 'Chair',
        published: true,
        variants: [{ id: 'v', name: 'Walnut', cost: 100, minimum: 2 }],
      })),
      insert: vi.fn(async (_table: string, _value: any) => 'request-id'),
    },
    scheduler: { runAfter: vi.fn(async () => {}) },
  };
}
const request = {
  token: '12345678-1234-1234-1234-123456789012',
  name: 'Test Customer',
  email: 'TEST@example.com',
  business: '',
  address: '123 Example Street, Austin TX 78701',
  phone: '',
  notes: '',
  service: 'Inside placement',
  website: '',
  items: [{ productId: 'p', variantId: 'v', quantity: 3 }],
};
describe('furniture quote persistence and access', () => {
  it('requires admin authorization for editing and private reads', async () => {
    await expect(handler(save)(context(), { product: blankFurniture() })).rejects.toThrow(
      'Unauthorized'
    );
    await expect(handler(adminProducts)(context(), {})).rejects.toThrow('Unauthorized');
  });
  it('calculates authoritative prices, saves a snapshot, then schedules both emails', async () => {
    const ctx = context();
    await handler(submit)(ctx, request);
    const saved = ctx.db.insert.mock.calls[0][1];
    expect(saved.lower).toBe(1500);
    expect(saved.upper).toBe(1800);
    expect(saved.email).toBe('test@example.com');
    expect(saved.items[0].name).toBe('Chair');
    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(2);
    expect(ctx.db.insert.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.scheduler.runAfter.mock.invocationCallOrder[0]
    );
  });
  it('rejects quantities below MOQ and hidden products', async () => {
    await expect(
      handler(submit)(context(), { ...request, items: [{ ...request.items[0], quantity: 1 }] })
    ).rejects.toThrow('quantity');
    const ctx = context();
    ctx.db.get.mockResolvedValue({ ...blankFurniture(), published: false } as any);
    await expect(handler(submit)(ctx, request)).rejects.toThrow('no longer available');
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
  it('makes submission retries idempotent without resending emails', async () => {
    const ctx = context({ _id: 'original', email: 'test@example.com' });
    expect(await handler(submit)(ctx, request)).toBe('original');
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});
