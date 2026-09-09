import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./auth', () => ({ auth: { getUserId: vi.fn() } }));
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn().mockResolvedValue({ email: 'admin@example.com' }) }));
vi.mock('./productNameRegistry', () => ({ claimProductName: vi.fn(), attachNameClaimToProduct: vi.fn(), retireProductName: vi.fn() }));
import { claimProductName, attachNameClaimToProduct, retireProductName } from './productNameRegistry';
import { saveVariantWorkspace } from './products';
const handler = (saveVariantWorkspace as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
const variant = { id: 'green90', name: 'Green 90cm', image: 'import.jpg', inStock: true, priceAdjustment: 2, cjVariantId: 'cj90', cjSku: 'G90' };
const product = { _id: 'product', name: 'Original', description: 'Original story', images: ['import.jpg'], productRevision: 2, activeNameClaimId: 'old', variants: [variant], cjVariants: [{ vid: 'cj90', sku: 'G90', name: 'Green 90cm' }] };
const context = () => ({ db: { get: vi.fn().mockResolvedValue(product), patch: vi.fn(), insert: vi.fn(), query: vi.fn().mockReturnValue({ withIndex: () => ({ unique: async () => null }) }) } });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(claimProductName).mockResolvedValue({ claimId: 'new', normalizedName: 'celia dress' } as never); });

describe('saving the final listing review', () => {
    it('saves the reserved name, story, gallery, and variant image in one revision', async () => {
        const ctx = context();
        await handler(ctx, { productId: 'product', expectedRevision: 2, variants: [{ ...variant, image: 'cj.jpg' }],
            listing: { name: 'Celia Dress', description: 'New story', images: ['cj.jpg'], pendingNameClaimId: 'new', nameOwnerKey: 'owner' } });
        expect(claimProductName).toHaveBeenCalledWith(ctx, expect.objectContaining({ pendingClaimId: 'new', ownerKey: 'owner', productId: 'product' }));
        expect(ctx.db.patch).toHaveBeenCalledWith('product', expect.objectContaining({ productRevision: 3, variants: [expect.objectContaining({ image: 'cj.jpg', cjVariantId: 'cj90', cjSku: 'G90' })] }));
        expect(ctx.db.patch).toHaveBeenCalledWith('product', expect.objectContaining({ name: 'Celia Dress', description: 'New story', images: ['cj.jpg'], activeNameClaimId: 'new' }));
        expect(attachNameClaimToProduct).toHaveBeenCalledWith(ctx, 'new', 'product');
        expect(retireProductName).toHaveBeenCalledWith(ctx, 'product', 'old');
    });
    it('rejects a stale review before changing metadata or mapping', async () => {
        const ctx = context();
        await expect(handler(ctx, { productId: 'product', expectedRevision: 1, variants: [variant], listing: { name: 'Stale', description: '', images: [] } })).rejects.toThrow('changed');
        expect(ctx.db.patch).not.toHaveBeenCalled();
        expect(claimProductName).not.toHaveBeenCalled();
    });
});
