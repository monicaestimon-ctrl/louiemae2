import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./auth', () => ({ auth: { getUserId: vi.fn().mockResolvedValue('admin') } }));
vi.mock('./geminiDescriptionClient', () => ({
    generateDescriptionDraftWithGemini: vi.fn(), repairDescriptionDraftWithGemini: vi.fn(),
    analyzeProductImages: vi.fn(), getSmartDescriptionModel: () => 'test-model',
}));
import { generateDescriptionDraftWithGemini, repairDescriptionDraftWithGemini } from './geminiDescriptionClient';
import { generateSmartDescription } from './smartDescriptions';
import { buildSourceProductSnapshot, type SmartDescriptionResponse } from '../lib/smartDescription';
const handler = (generateSmartDescription as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<SmartDescriptionResponse> })._handler;
function context(name = 'Ceramic Table Lamp') {
    return {
        runQuery: vi.fn().mockResolvedValue([]),
        runAction: vi.fn().mockResolvedValue({ sourceSnapshot: buildSourceProductSnapshot({ name, rawDescription: 'A rounded vessel base with earthy texture.', collection: 'decor' }), sourceHash: 'hash', warnings: [] }),
        runMutation: vi.fn().mockResolvedValue('audit-id'),
    };
}
beforeEach(() => vi.clearAllMocks());
describe('description generation failure paths', () => {
    it('preserves a rich labeled model description instead of replacing it with the short fallback', async () => {
        const draft = {
            openingSentence: 'A ceramic table lamp with a rounded vessel base and an earthy presence.',
            detailLines: [
                { label: 'Material', detail: 'Ceramic gives the piece a grounded material presence.', supportedByFactIds: [], riskLevel: 'low' as const },
                { label: 'Design', detail: 'The rounded vessel base gives the silhouette a sculptural rhythm.', supportedByFactIds: [], riskLevel: 'low' as const },
                { label: 'Texture', detail: 'Earthy texture brings a quiet sense of depth to the surface.', supportedByFactIds: [], riskLevel: 'low' as const },
            ], seoKeywordsUsed: [], avoidedClaims: [], confidence: .9,
        };
        vi.mocked(generateDescriptionDraftWithGemini).mockResolvedValue({ warnings: [], value: draft });
        const result = await handler(context(), { request: { generationMode: 'manual_generate' } });
        expect(result).toMatchObject({ ok: true, fallbackUsed: false, structured: draft });
        expect(repairDescriptionDraftWithGemini).not.toHaveBeenCalled();
    });
    it('returns validated boutique copy when the provider quota is exhausted', async () => {
        vi.mocked(generateDescriptionDraftWithGemini).mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
        const ctx = context();
        const result = await handler(ctx, { request: { generationMode: 'manual_generate' } });
        expect(result).toMatchObject({ ok: true, fallbackUsed: true, providerErrorCode: 'PROVIDER_QUOTA_EXHAUSTED', validation: { passed: true } });
        expect(result.description).toContain('A ceramic table lamp with a rounded vessel base');
        expect(result.description).not.toMatch(/supplier|features/i);
        expect(repairDescriptionDraftWithGemini).not.toHaveBeenCalled();
        expect(ctx.runMutation).toHaveBeenCalled();
    });
    it('replaces rejected mechanical model copy when repair is unavailable', async () => {
        vi.mocked(generateDescriptionDraftWithGemini).mockResolvedValue({ warnings: [], value: {
            openingSentence: 'Supplier details for this ceramic table lamp are listed here.', detailLines: [], seoKeywordsUsed: [], avoidedClaims: [], confidence: .9,
        } });
        vi.mocked(repairDescriptionDraftWithGemini).mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
        const result = await handler(context(), { request: { generationMode: 'manual_generate' } });
        expect(result).toMatchObject({ ok: true, fallbackUsed: true, providerErrorCode: 'PROVIDER_QUOTA_EXHAUSTED', validation: { passed: true } });
        expect(result.description).not.toMatch(/supplier|features/i);
    });
    it('does not ask the model to guess between different product types', async () => {
        const result = await handler(context('Table lamp and floor lamp'), { request: { generationMode: 'manual_generate' } });
        expect(result.ok).toBe(false);
        expect(result.description).toBeUndefined();
        expect(generateDescriptionDraftWithGemini).not.toHaveBeenCalled();
    });
});
