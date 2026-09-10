import { describe, it, expect } from 'vitest';
import { buildGenerationSnapshot, buildImportGenerationInput, semanticGenerationKey, sourceIdentity } from './productGeneration';
import { sourceFromImportPayload } from './productSourceAdapters';
import { buildBatchImportProduct } from './batchImportProduct';
import { normalizeSourceProduct } from '../convex/sourceProductNormalizer';
const url = 'https://detail.1688.com/offer/1025821169194.html';
const item = { Title: 'Mixed dresses', Price: { OriginalPrice: 60 }, Pictures: [{ Url: 'https://example.com/pink.jpg' }],
    Attributes: [{ PropertyName: 'Material', Value: 'Cotton' }],
    ConfiguredItems: Array.from({ length: 84 }, (_, i) => ({ Id: String(i), Title: `${i < 7 ? 'Green Lace' : 'Pink Flowers'} ${90 + i % 7 * 10}cm`, Quantity: 2 })) };
const payload = { source: '1688', data: { Result: item }, rawDescription: 'Different dresses with floral embroidery and lace trims.', descriptionImages: ['https://example.com/detail.jpg'] };
const source = sourceFromImportPayload(payload, url);
describe('shared supplier generation workflow', () => {
    it('normalizes wrapped and unwrapped OTAPI responses identically', () => {
        expect(semanticGenerationKey(sourceFromImportPayload({ ...payload, data: item }, url))).toBe(semanticGenerationKey(source));
    });
    it('uses identical source input for single and batch import', () => {
        const single = buildBatchImportProduct({ _id: 'single', normalizedUrl: url, result: payload }, 'kids', p => p);
        const batch = buildBatchImportProduct({ _id: 'batch', normalizedUrl: url, result: payload }, 'kids', p => p);
        expect(semanticGenerationKey(buildImportGenerationInput(single))).toBe(semanticGenerationKey(buildImportGenerationInput(batch)));
        expect(source.descriptionImages?.[0].url).toBe(payload.descriptionImages[0]);
    });
    it('preserves evidence for generation when a supplier no longer returns a price', () => {
        expect(sourceFromImportPayload({ ...payload, data: { ...item, Price: undefined } }, url).rawDescription).toBe(payload.rawDescription);
        expect(() => buildBatchImportProduct({ _id: 'x', normalizedUrl: url, result: { ...payload, data: { ...item, Price: undefined } } }, 'kids', p => p)).toThrow('price');
    });
    it('scopes seven of 84 variants and excludes unrelated facts and photos', () => {
        const snapshot = buildGenerationSnapshot({ ...source, attributes: [{ key: 'Material', value: 'Cotton', source: 'otapi_property', confidence: 1 }] },
            { subset: true, images: ['https://example.com/green.jpg'], variants: item.ConfiguredItems.slice(0, 7).map(v => ({ name: v.Title })) }, { collection: 'kids', audience: 'girls' });
        expect(JSON.stringify(snapshot)).not.toMatch(/Pink|pink.jpg|Cotton|floral embroidery/);
        expect(snapshot.rawTitle).toContain('Green Lace');
        expect(snapshot.categoryHints?.audience).toBe('girls');
        expect(normalizeSourceProduct(snapshot).categoryHints?.audience).toBe('girls');
    });
    it('includes only confirmed subset attributes and manual facts', () => {
        const snapshot = buildGenerationSnapshot({ ...source, attributes: [{ key: 'Material', value: 'Cotton', source: 'otapi_property', confidence: 1 }, { key: 'Closure', value: 'Zipper', source: 'otapi_property', confidence: 1 }] },
            { subset: true, images: [], variants: [{ name: 'Green Lace 90cm' }], evidence: { attributeKeys: ['Closure'], facts: 'Verified lace trim' } }, {});
        expect(snapshot.attributes.map(a => a.value)).toEqual(['Zipper', 'Verified lace trim']);
        expect(snapshot.rawDescription).toBe('Verified lace trim');
    });
    it('never recycles generated copy as supplier evidence', () => {
        const input = buildImportGenerationInput({ name: 'Celia', description: 'Invented generated marketing', rawSourceDescription: 'Verified original details', variants: [] });
        expect(input.sourceSnapshot.rawDescription).toBe('Verified original details');
    });
    it('ignores timestamps but detects changed images and confirmed facts', () => {
        expect(semanticGenerationKey({ ...source, importedAt: 1 })).toBe(semanticGenerationKey({ ...source, importedAt: 2 }));
        expect(semanticGenerationKey({ images: ['green'] })).not.toBe(semanticGenerationKey({ images: ['pink'] }));
    });
    it('normalizes offer tracking while rejecting credentials and preserving other hosts', () => {
        expect(sourceIdentity(url + '?spm=tracking#fragment')).toBe(url);
        expect(() => sourceIdentity('https://secret:password@example.com')).toThrow('credentials');
        expect(sourceIdentity('https://evil1688.com/offer/123.html')).toContain('evil1688.com');
    });
});
