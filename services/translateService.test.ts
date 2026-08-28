import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateProductFields } from './translateService';

afterEach(() => vi.unstubAllGlobals());

describe('product variant translation', () => {
    it('translates unique labels concurrently, preserving order and the three-request limit', async () => {
        let active = 0;
        let peak = 0;
        const fetchMock = vi.fn(async (url: string) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 2));
            active--;
            const source = new URL(url).searchParams.get('q');
            return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: `English ${source}` } }) };
        });
        vi.stubGlobal('fetch', fetchMock);
        const labels = Array.from({ length: 50 }, (_, i) => `蓝色 ${i}`);
        const result = await translateProductFields({ name: 'Name', description: 'Description', variantNames: [...labels, labels[0], 'Black / S'] });
        expect(fetchMock).toHaveBeenCalledTimes(50);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(3);
        expect(result.variantNames).toEqual([...labels.map(label => `English ${label}`), `English ${labels[0]}`, 'Black / S']);
    });

    it('preserves failed labels while completing the rest', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (new URL(url).searchParams.get('q') === '红色') throw new Error('temporary failure');
            return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Blue' } }) };
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await translateProductFields({ name: 'Name', description: '', variantNames: ['蓝色', '红色', '蓝色'] });
        expect(result.variantNames).toEqual(['Blue', '红色', 'Blue']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('bounds chunk requests even for long variant labels', async () => {
        let active = 0;
        let peak = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 2));
            active--;
            return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Translated' } }) };
        }));
        const result = await translateProductFields({ name: 'Name', description: '', variantNames: ['蓝'.repeat(1200), '红'.repeat(1200), '绿'.repeat(1200), '白'] });
        expect(peak).toBeLessThanOrEqual(3);
        expect(result.variantNames).toEqual(['TranslatedTranslatedTranslated', 'TranslatedTranslatedTranslated', 'TranslatedTranslatedTranslated', 'Translated']);
    });

    it('still rejects failed product-name translations', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        await expect(translateProductFields({ name: '蓝色', description: '', variantNames: ['红色'] })).rejects.toThrow('offline');
    });
});
