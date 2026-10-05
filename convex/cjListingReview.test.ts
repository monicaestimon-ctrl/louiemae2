// @vitest-environment node
/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './schema';
vi.mock('./cjAdminAccess', () => ({ requireCjAdminIdentity: vi.fn().mockResolvedValue({ email: 'admin@example.com' }) }));
vi.mock('./productNameRegistry', () => ({ claimProductName: vi.fn(), attachNameClaimToProduct: vi.fn(), retireProductName: vi.fn() }));
import { claimProductName, attachNameClaimToProduct, retireProductName } from './productNameRegistry';
const modules = import.meta.glob(['./**/*.ts', './_generated/*.js']);
const save = makeFunctionReference<'mutation'>('products:saveVariantWorkspace');
const variant = { id: 'green90', name: 'Green 90cm', image: 'import.jpg', inStock: true, priceAdjustment: 2, cjVariantId: 'cj90', cjSku: 'G90' };
beforeEach(() => vi.clearAllMocks());
async function setup() {
    const t = convexTest(schema, modules);
    const ids = await t.run(async ctx => {
        const claim = { normalizedName: 'original', displayName: 'Original', normalizationVersion: 1, status: 'active' as const, ownerKey: 'owner', source: 'manual' as const, createdAt: 1, updatedAt: 1 };
        const old = await ctx.db.insert('productNameClaims', claim);
        const next = await ctx.db.insert('productNameClaims', { ...claim, normalizedName: 'celia dress', displayName: 'Celia Dress' });
        const productId = await ctx.db.insert('products', { name: 'Original', description: 'Original story', price: 20, category: 'dresses', collection: 'fashion', images: ['import.jpg'], productRevision: 2, activeNameClaimId: old, variants: [variant], cjVariants: [{ vid: 'cj90', sku: 'G90', name: 'Green 90cm' }] });
        return { old, next, productId };
    });
    vi.mocked(claimProductName).mockResolvedValue({ claimId: ids.next, normalizedName: 'celia dress' } as never);
    return { t, ...ids };
}
describe('saving the final listing review', () => {
    it('saves the reserved name, story, gallery, and variant image in one revision', async () => {
        const { t, productId, old, next } = await setup();
        await t.mutation(save, { productId, expectedRevision: 2, variants: [{ ...variant, image: 'cj.jpg' }],
            listing: { name: 'Celia Dress', description: 'New story', images: ['cj.jpg'], pendingNameClaimId: next, nameOwnerKey: 'owner' } });
        expect(claimProductName).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pendingClaimId: next, ownerKey: 'owner', productId }));
        expect(await t.run(ctx => ctx.db.get(productId))).toMatchObject({ productRevision: 3, name: 'Celia Dress', description: 'New story', images: ['cj.jpg'], activeNameClaimId: next, variants: [expect.objectContaining({ image: 'cj.jpg', cjVariantId: 'cj90', cjSku: 'G90' })] });
        expect(await t.run(ctx => ctx.db.query('productCatalog').first())).toMatchObject({ publicData: { name: 'Celia Dress', descriptionExcerpt: 'New story' }, adminData: { productRevision: 3 } });
        expect(attachNameClaimToProduct).toHaveBeenCalledWith(expect.anything(), next, productId);
        expect(retireProductName).toHaveBeenCalledWith(expect.anything(), productId, old);
    });
    it('rejects a newly accepted description for different variants and rolls back both tables', async () => {
        const { t, productId } = await setup();
        const auditId = await t.run(ctx => ctx.db.insert('descriptionAudits', { model: 'model', promptVersion: 'v1', sourceSnapshotHash: 'hash', selectedCjVariantIds: ['other'], generationMode: 'manual_generate', brandVoiceVersion: 'v1', sourceSnapshot: {}, normalizedFacts: {}, validation: {}, fallbackUsed: false, adminEdited: false, warnings: [], createdAt: 1, updatedAt: 1 }));
        await expect(t.mutation(save, { productId, expectedRevision: 2, variants: [variant], listing: { name: 'Celia', description: 'Generated', images: [], smartDescription: {
            auditId, model: 'model', promptVersion: 'v1', sourceSnapshotHash: 'hash', description: 'Generated', generatedAt: 1, adminEdited: false, status: 'generated',
        } } })).rejects.toThrow('selected variants changed');
        expect(await t.run(ctx => ctx.db.get(productId))).toMatchObject({ productRevision: 2, description: 'Original story' });
        expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
        expect(await t.run(ctx => ctx.db.query('productVariantAudits').collect())).toEqual([]);
    });
    it('rejects a stale review before changing metadata or mapping', async () => {
        const { t, productId } = await setup();
        await expect(t.mutation(save, { productId, expectedRevision: 1, variants: [variant], listing: { name: 'Stale', description: '', images: [] } })).rejects.toThrow('changed');
        expect(await t.run(ctx => ctx.db.get(productId))).toMatchObject({ productRevision: 2, name: 'Original' });
        expect(await t.run(ctx => ctx.db.query('productCatalog').collect())).toEqual([]);
        expect(claimProductName).not.toHaveBeenCalled();
    });
});
