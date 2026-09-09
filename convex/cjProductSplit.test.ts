import { describe, expect, it, vi } from 'vitest';
vi.mock('./auth', () => ({ auth: { getUserId: vi.fn() } }));
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn() }));
import { requireCjAdminIdentity } from './cjAdminAccess';
import { splitCjProduct } from './products';
import { appendCjVariant, updateProductInventorySnapshot, updateProductSourcingStatus } from './cjHelpers';

// Exercise the registered handlers without a live database.
const handler = (registered: unknown) => (registered as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
const scoped = { _id: 'product', name: 'Pink', cjVariantScope: ['pink'], cjVariants: [{ vid: 'pink', sku: 'P', name: 'Pink' }] };
const context = () => ({ db: { get: vi.fn().mockResolvedValue(scoped), patch: vi.fn(), insert: vi.fn() } });

describe('split listing boundaries', () => {
    it('ignores catalog and sourcing updates for a different dress', async () => {
        const ctx = context();
        await handler(appendCjVariant)(ctx, { productId: 'product', cjVariant: { vid: 'green', sku: 'G', name: 'Green' } });
        await handler(updateProductSourcingStatus)(ctx, { productId: 'product', status: 'approved', cjVariantId: 'green' });
        expect(ctx.db.patch).not.toHaveBeenCalled();
    });

    it('allows updates to a variant still assigned to the listing', async () => {
        const ctx = context();
        await handler(appendCjVariant)(ctx, { productId: 'product', cjVariant: { vid: 'pink', sku: 'P', name: 'Pink updated' } });
        expect(ctx.db.patch).toHaveBeenCalledWith('product', expect.objectContaining({ cjVariants: [{ vid: 'pink', sku: 'P', name: 'Pink updated' }] }));
    });

    it('discards an inventory poll from before the split and requests a fresh one', async () => {
        const ctx = context();
        await handler(updateProductInventorySnapshot)(ctx, { productId: 'product', snapshots: [{ vid: 'green', sku: 'G' }], status: 'in_stock', totalInventoryNum: 100 });
        expect(ctx.db.patch).toHaveBeenCalledWith('product', { cjInventoryNextCheckAt: 0 });
    });

    it('requires CJ admin access before reading or changing products', async () => {
        vi.mocked(requireCjAdminIdentity).mockRejectedValueOnce(new Error('Not an admin'));
        const ctx = context();
        await expect(handler(splitCjProduct)(ctx, { productId: 'product', selectedVariantIds: ['pink'], name: 'Pink' })).rejects.toThrow('Not an admin');
        expect(ctx.db.get).not.toHaveBeenCalled();
        expect(ctx.db.insert).not.toHaveBeenCalled();
    });
});
