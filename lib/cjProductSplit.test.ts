import { describe, expect, it } from 'vitest';
import type { Doc } from '../convex/_generated/dataModel';
import { buildCjProductSplit } from './cjProductSplit';

const product = {
    sourceSnapshotId: 'snapshot', _id: 'source', _creationTime: 1, name: 'Mixed dresses', price: 35,
    description: 'Original description', images: ['mixed.jpg'], category: 'Dresses', collection: 'Kids',
    cjSourcingStatus: 'approved', cjProductId: 'supplier-product', cjVariantId: 'green-90', cjSku: 'G90',
    batchImportItemId: 'batch', cjSourcingId: 'request', storefrontStatus: 'published',
    cjVariants: [
        { vid: 'green-90', sku: 'G90', name: 'Green Lace 90cm', image: 'green.jpg' },
        { vid: 'green-100', sku: 'G100', name: 'Green Lace 100cm', image: 'green.jpg' },
        { vid: 'pink-90', sku: 'P90', name: 'Pink Flowers 90cm', image: 'pink.jpg' },
        { vid: 'blue-90', sku: 'B90', name: 'Blue 90cm' },
    ],
    variants: [
        { id: 'size-green', name: '90cm', priceAdjustment: 2, inStock: true, cjVariantId: 'green-90', cjSku: 'G90' },
        { id: 'size-pink', name: 'Pink 90cm', priceAdjustment: 0, inStock: true, cjVariantId: 'pink-90', cjSku: 'P90' },
        { id: 'unmapped', name: 'Unmapped', priceAdjustment: 0, inStock: false },
    ],
} as unknown as Doc<'products'>;

describe('splitting a mixed CJ listing', () => {
    it('moves the reviewed photo with the exact variant and rejects assignments outside the split', () => {
        const { newProduct, sourcePatch } = buildCjProductSplit(product, ['green-90'], 'Green', [], [{ cjVariantId: 'green-90', image: 'selected-import.jpg' }]);
        expect(newProduct.variants[0]).toMatchObject({ image: 'selected-import.jpg', cjVariantId: 'green-90', cjSku: 'G90', priceAdjustment: 2 });
        expect(sourcePatch.variants).not.toContainEqual(expect.objectContaining({ image: 'selected-import.jpg' }));
        expect(() => buildCjProductSplit(product, ['green-90'], 'Green', [], [{ cjVariantId: 'pink-90', image: 'wrong.jpg' }])).toThrow('Photo assignments');
    });
    it('moves one dress with mapped pricing and creates mappings for its other sizes', () => {
        const result = buildCjProductSplit(product, ['green-90', 'green-100'], ' Green Lace Dress ');
        expect(result.newProduct).toMatchObject({
            name: 'Green Lace Dress', storefrontStatus: 'hidden', price: 35, sourceSnapshotId: 'snapshot', sourceParentProductId: 'source', sourceScopeStatus: 'needs_confirmation',
            images: ['green.jpg'], cjProductId: 'supplier-product', cjVariantScope: ['green-90', 'green-100'],
        });
        expect(result.newProduct.variants[0]).toEqual(product.variants![0]);
        expect(result.newProduct.variants[1]).toMatchObject({ cjVariantId: 'green-100', cjSku: 'G100', inStock: false });
        expect(result.newProduct).not.toHaveProperty('batchImportItemId');
        expect(result.newProduct).not.toHaveProperty('cjSourcingId');
        expect(result.sourcePatch.variants.map(v => v.id)).toEqual(['size-pink', 'unmapped']);
        expect(result.sourcePatch.cjVariantId).toBe('pink-90');
        expect(result.sourcePatch.cjSku).toBe('P90');
        expect(product.cjVariants).toHaveLength(4);
    });

    it('supports subsequent splits and rejects a repeated or stale selection', () => {
        const { sourcePatch } = buildCjProductSplit(product, ['green-90', 'green-100'], 'Green');
        const remaining = { ...product, ...sourcePatch };
        expect(buildCjProductSplit(remaining, ['pink-90'], 'Pink').newProduct.cjVariantScope).toEqual(['pink-90']);
        expect(() => buildCjProductSplit(remaining, ['green-90'], 'Again')).toThrow('changed');
    });

    it('moves explicitly matched unmapped customer labels without leaving duplicate options behind', () => {
        const links = [{ cjVariantId: 'green-100', customerVariantId: 'unmapped' }];
        const result = buildCjProductSplit(product, ['green-100'], 'Green', links);
        expect(result.newProduct.variants[0]).toMatchObject({ id: 'unmapped', cjVariantId: 'green-100', cjSku: 'G100' });
        expect(result.sourcePatch.variants.some(v => v.id === 'unmapped')).toBe(false);
        expect(() => buildCjProductSplit(product, ['green-100'], 'Green', [{ cjVariantId: 'green-100', customerVariantId: 'size-pink' }])).toThrow('different customer option');
        expect(() => buildCjProductSplit(product, ['green-100', 'pink-90'], 'Green', [...links, { cjVariantId: 'pink-90', customerVariantId: 'unmapped' }])).toThrow('different customer option');
    });

    it('rejects empty names, empty selections, duplicates, unknown IDs and moving everything', () => {
        expect(() => buildCjProductSplit(product, ['green-90'], ' ')).toThrow('name');
        expect(() => buildCjProductSplit(product, [], 'Green')).toThrow('Select');
        expect(() => buildCjProductSplit(product, ['green-90', 'green-90'], 'Green')).toThrow('changed');
        expect(() => buildCjProductSplit(product, ['missing'], 'Green')).toThrow('changed');
        expect(() => buildCjProductSplit(product, product.cjVariants!.map(v => v.vid), 'All')).toThrow('Leave');
    });
});
