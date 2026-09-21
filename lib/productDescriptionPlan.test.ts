import { describe, expect, it } from 'vitest';
import { buildSourceProductSnapshot } from './smartDescription';
import { extractNormalizedProductFacts } from '../convex/productFacts';
import { planProductDescription } from './productDescriptionPlan';
import { buildEditorialFallback } from './editorialProductCopy';
import { validateGeneratedDescription } from '../convex/descriptionValidators';
import { LOUIE_MAE_BRAND_VOICE } from '../convex/brandVoice';

const lamp = (rich = false) => extractNormalizedProductFacts(buildSourceProductSnapshot({
    name: 'Clay Table Lamp', collection: 'decor', rawDescription: 'A rounded vessel base with earthy texture.',
    attributes: rich ? [
        { key: 'Finish', value: 'matte', source: 'admin_input', confidence: 1 },
        { key: 'Feature', value: 'Dimmable', source: 'admin_input', confidence: 1 },
        { key: 'Height', value: '30 cm', source: 'admin_input', confidence: 1 },
        { key: 'Color', value: 'beige', source: 'admin_input', confidence: 1 },
    ] : [],
}));

describe('description depth follows evidence', () => {
    it('keeps the short editorial treatment for a lamp with minimal facts', () => {
        expect(planProductDescription(lamp()).mode).toBe('short');
        expect(buildEditorialFallback(lamp()).detailLines).toEqual([]);
        expect(buildEditorialFallback(lamp()).openingSentence).toContain('quiet, collected feel');
    });
    it('gives the same product type a full breakdown when more information is available', () => {
        const facts = lamp(true);
        const plan = planProductDescription(facts);
        expect(plan.mode).toBe('full');
        expect(plan.preferredDetailLines).toEqual({ min: 3, max: 6 });
        const draft = buildEditorialFallback(facts);
        expect(draft.detailLines.length).toBeGreaterThanOrEqual(3);
        expect(draft.detailLines.map(line => line.label)).toEqual(expect.arrayContaining(['Material', 'Design', 'Texture', 'Finish']));
        expect(validateGeneratedDescription({ draft, facts, brandVoice: LOUIE_MAE_BRAND_VOICE }).passed).toBe(true);
    });
    it('uses a compact middle ground rather than an all-or-nothing format', () => {
        const facts = lamp();
        facts.patternOrFinish = lamp(true).patternOrFinish;
        expect(planProductDescription(facts)).toMatchObject({ mode: 'compact', preferredDetailLines: { min: 1, max: 3 } });
    });
    it('does not count duplicated facts or a large number of variants as more editorial substance', () => {
        const facts = lamp();
        const detail = facts.designDetails[0];
        facts.designDetails = Array(30).fill(detail);
        facts.functionalDetails = [detail];
        facts.variants = Array(100).fill(detail);
        expect(planProductDescription(facts).mode).toBe('short');
    });
    it('does not reserve the short format for lamps', () => {
        const facts = extractNormalizedProductFacts(buildSourceProductSnapshot({ name: 'Floral Dress', collection: 'fashion' }));
        expect(planProductDescription(facts).mode).toBe('short');
    });
});
