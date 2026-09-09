import { describe, expect, it } from 'vitest';
import { buildSourceProductSnapshot, normalizeVariants } from './smartDescription';
import { normalizeSourceProduct } from '../convex/sourceProductNormalizer';

describe('smart tool variant snapshots', () => {
    it('preserves selected style and size facts across the client/server boundary', () => {
        const snapshot = buildSourceProductSnapshot({ name: 'Green dress', variants: [
            { name: 'Green Lace / Size: 90cm' }, { name: 'Green Lace / Size: 100cm' },
        ] });
        expect(normalizeSourceProduct(snapshot).variants).toEqual(snapshot.variants);
        expect(snapshot.variants).toEqual([
            { name: 'Option', values: ['Green Lace'] }, { name: 'Size', values: ['90cm', '100cm'] },
        ]);
    });
    it('merges grouped and raw options without duplicates or nontext values', () => {
        expect(normalizeVariants([{ name: 'Size', values: ['90cm', ' ', 3] }, { name: 'Size: 90cm' }, { name: 'Size: 100cm' }]))
            .toEqual([{ name: 'Size', values: ['90cm', '100cm'] }]);
    });
});
