import { describe, it, expect } from 'vitest';
import { classifyAiProviderError, sanitizeAiWarning } from './aiProviderErrors';
import { buildGenerationSnapshot, isProductSourceAttribute, sourceEvidenceWarnings } from './productGeneration';
import { buildSourceProductSnapshot } from './smartDescription';
import { extractNormalizedProductFacts } from '../convex/productFacts';
describe('live smart-copy regressions', () => {
    it('classifies suspended access without returning a provider-echoed credential', () => {
        const echoed = 'Image analysis failed: Permission denied: Consumer api_key:FAKE_TEST_VALUE has been suspended. CONSUMER_SUSPENDED';
        const result = classifyAiProviderError(echoed);
        expect(result).toMatchObject({ code: 'PROVIDER_SUSPENDED', retryable: false });
        expect(JSON.stringify(result)).not.toContain('FAKE_TEST_VALUE');
        expect(sanitizeAiWarning(echoed)).not.toContain('FAKE_TEST_VALUE');
    });
    it('distinguishes authentication and quota failures without raw responses', () => {
        expect(classifyAiProviderError('403 PERMISSION_DENIED').code).toBe('PROVIDER_AUTH_FAILED');
        expect(classifyAiProviderError('429 RESOURCE_EXHAUSTED').code).toBe('PROVIDER_QUOTA_EXHAUSTED');
    });
    it('does not infer red from embroidered', () => {
        const source = buildSourceProductSnapshot({ name: 'Green embroidered lace dress', images: [] });
        const facts = extractNormalizedProductFacts(source);
        expect(facts.colors.map(f => f.value)).toEqual(['green']);
        expect(facts.designDetails.map(f => f.value)).toEqual(expect.arrayContaining(['lace', 'embroidered']));
    });
    it('excludes supplier telemetry and marks numeric-only descriptions incomplete', () => {
        expect(isProductSourceAttribute({ key: 'sizeInfo', value: '[{"skuId":"example"}]' })).toBe(false);
        const source = buildSourceProductSnapshot({ name: 'Dress', rawDescription: '1', attributes: [{ key: 'normalizedRating', value: '.96', source: 'otapi_property', confidence: 1 }] });
        expect(sourceEvidenceWarnings(source)).toHaveLength(2);
        expect(buildGenerationSnapshot(source, { variants: [], images: [], subset: false }, {}).attributes).toEqual([]);
    });
});
