import { describe, it, expect } from 'vitest';
import { buildSourceProductSnapshot, formatDescription, coerceGeneratedDescriptionDraft } from './smartDescription';
import { buildGenerationSnapshot } from './productGeneration';
import { extractNormalizedProductFacts } from '../convex/productFacts';
import { normalizedNameProductType, buildSafeNameFallback, validateSmartNameDraft } from '../convex/geminiNameClient';
import { buildSafeFallbackDescription, validateGeneratedDescription } from '../convex/descriptionValidators';
import { LOUIE_MAE_BRAND_VOICE } from '../convex/brandVoice';

function factsFor(name: string, description = '') {
    return extractNormalizedProductFacts(buildSourceProductSnapshot({ name, rawDescription: description, collection: 'decor' }));
}
describe('boutique product copy regressions', () => {
    it.each([
        ['Ceramic Table Lamp', 'table lamp'], ['Floor lamp for bedside tables', 'floor lamp'],
        ['Accent chair with a matching table', 'chair'], ['Ceramic table lamp with urn base', 'table lamp'],
        ['Lamp shade', 'lampshade'], ['Console table', 'console'],
        ['Table lamp and floor lamp', 'product'], ['Green embroidered dress', 'dress'],
    ])('resolves %s without guessing from incidental nouns', (title, type) => {
        const facts = factsFor(title, 'Style beside a console table and chair.');
        expect(facts.productType.value).toBe(type);
        expect(normalizedNameProductType(facts).toLowerCase()).toBe(type);
    });
    it('names a ceramic table lamp accurately and rejects an unsupported urn modifier', () => {
        const facts = factsFor('Ceramic Table Lamp');
        const name = buildSafeNameFallback(facts);
        expect(name.name).toMatch(/Table Lamp$/);
        expect(validateSmartNameDraft(name, facts)).toEqual([]);
        expect(validateSmartNameDraft({ ...name, name: `${name.firstName} Urn Table`, modifier: 'Urn', productType: 'Table' }, facts).length).toBeGreaterThan(0);
        expect(validateSmartNameDraft({ ...name, name: `${name.firstName} Urn Table Lamp`, modifier: 'Urn' }, facts)).toContain('Unsupported name modifier: Urn.');
    });
    it('keeps confirmed ceramic evidence without interpreting ceramic-look as material', () => {
        expect(factsFor('Ceramic Table Lamp').materials.map(f => f.value)).toContain('ceramic');
        expect(factsFor('Ceramic-look Table Lamp').materials).toEqual([]);
    });
    it('uses a specific selected category without leaking parent variant material', () => {
        const source = buildSourceProductSnapshot({ name: 'Ceramic lamps and metal lamps', rawDescription: 'Made from ceramic.', collection: 'decor' });
        const scoped = buildGenerationSnapshot(source, { subset: true, images: [], variants: [{ name: 'Beige' }] }, { collection: 'decor', subcategory: 'table-lamps' });
        const facts = extractNormalizedProductFacts(scoped);
        expect(facts.productType.value).toBe('table lamp');
        expect(facts.materials).toEqual([]);
    });
    it('writes a grounded boutique paragraph during provider outages', () => {
        const facts = factsFor('Ceramic Table Lamp', 'A rounded vessel base with earthy texture.');
        const draft = buildSafeFallbackDescription(facts, { importedAt: 0, images: [] });
        const text = formatDescription(draft);
        expect(text).toContain('A ceramic table lamp with a rounded vessel base.');
        expect(text).toContain('Its earthy texture gives bedside tables and consoles a quiet, collected feel.');
        expect(text).not.toMatch(/supplier|features|not confirmed|handmade|antique/i);
        expect(validateGeneratedDescription({ draft, facts, brandVoice: LOUIE_MAE_BRAND_VOICE }).passed).toBe(true);
    });
    it('accepts a beautiful short paragraph without padding it with detail lines', () => {
        const facts = factsFor('Table Lamp');
        const draft = buildSafeFallbackDescription(facts, { importedAt: 0, images: [] });
        expect(draft.detailLines).toEqual([]);
        expect(coerceGeneratedDescriptionDraft(draft)).toBeDefined();
        expect(validateGeneratedDescription({ draft, facts, brandVoice: LOUIE_MAE_BRAND_VOICE }).passed).toBe(true);
    });
    it('does not reverse a negative supplier statement into a positive feature', () => {
        const facts = factsFor('Table Lamp', 'The lamp does not have a rounded base.');
        const draft = buildSafeFallbackDescription(facts, { importedAt: 0, images: [] });
        expect(formatDescription(draft)).not.toContain('with a rounded base');
    });
    it('preserves the approved editorial language when all those details are supported', () => {
        const facts = factsFor('Clay Table Lamp', 'An antique-inspired lamp with a rounded vessel base, wabi-sabi character and earthy texture.');
        const draft = buildSafeFallbackDescription(facts, { importedAt: 0, images: [] });
        expect(draft.openingSentence).toBe('An antique-inspired clay table lamp with a rounded vessel base and wabi-sabi character. Its earthy texture gives bedside tables and consoles a quiet, collected feel.');
        expect(validateGeneratedDescription({ draft, facts, brandVoice: LOUIE_MAE_BRAND_VOICE }).passed).toBe(true);
    });
    it('allows organic shape while still rejecting unsupported organic certification', () => {
        const facts = factsFor('Table Lamp');
        const draft = buildSafeFallbackDescription(facts, { importedAt: 0, images: [] });
        draft.openingSentence = 'A table lamp with an organic shape and a quiet, sculptural presence.';
        expect(validateGeneratedDescription({ draft, facts, brandVoice: LOUIE_MAE_BRAND_VOICE }).passed).toBe(true);
        draft.openingSentence = 'An organic cotton table lamp with a quiet, sculptural presence.';
        expect(validateGeneratedDescription({ draft, facts, brandVoice: LOUIE_MAE_BRAND_VOICE }).errors.some(e => e.code === 'UNSUPPORTED_CERTIFICATION_CLAIM')).toBe(true);
    });
    it.each(['Supplier details for this table lamp:', 'Features a rounded table lamp.'])('blocks diagnostic or mechanical copy: %s', openingSentence => {
        const facts = factsFor('Table Lamp');
        const draft = { ...buildSafeFallbackDescription(facts, { importedAt: 0, images: [] }), openingSentence };
        expect(validateGeneratedDescription({ draft, facts, brandVoice: LOUIE_MAE_BRAND_VOICE }).passed).toBe(false);
    });
});
