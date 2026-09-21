import { describe, expect, it, vi } from 'vitest';
import { fromUrl } from './furnitureImport';
const handler = (
  fromUrl as unknown as { _handler: (ctx: unknown, args: { url: string }) => Promise<any> }
)._handler;
describe('furniture imports', () => {
  it('preserves original CNY variant prices without inventing an FX rate or shipping terms', async () => {
    const ctx = {
      runQuery: vi.fn(async () => ({ email: 'admin@example.com' })),
      runAction: vi.fn(async () => ({
        source: '1688',
        data: {
          Id: 'abb-123',
          Title: 'Oak chair',
          VendorId: 'shop123',
          VendorName: 'Example factory',
          Price: { OriginalPrice: 150 },
          Pictures: [{ Url: 'https://example.com/chair.jpg' }],
          ConfiguredItems: [{ Id: 'oak', Title: 'Oak', Price: { OriginalPrice: 200 } }],
        },
      })),
    };
    const result = await handler(ctx, { url: 'https://detail.1688.com/offer/123.html' });
    expect(result.product.currency).toBe('CNY');
    expect(result.product.usdRate).toBe(0);
    expect(result.product.variants[0].cost).toBe(200);
    expect(result.product.supplierKey).toBe('1688:shop123');
    expect(result.product.published).toBe(false);
    expect(result.product.imagePermission).toBe(false);
    expect(result.product).not.toHaveProperty('shippingInfo');
    expect(result.product.packaging).toBe('');
  });
  it('does not call the importer without admin authorization', async () => {
    const ctx = {
      runQuery: vi.fn(async () => {
        throw new Error('Unauthorized');
      }),
      runAction: vi.fn(),
    };
    await expect(handler(ctx, { url: 'https://example.com' })).rejects.toThrow('Unauthorized');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
