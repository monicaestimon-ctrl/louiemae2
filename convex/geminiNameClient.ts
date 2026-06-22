"use node";

import { GoogleGenAI } from '@google/genai';
import {
    GeneratedSmartNameDraft,
    NormalizedProductFacts,
} from '../lib/smartDescription';

type GeminiResult<T> = {
    value?: T;
    raw?: string;
    warnings: string[];
};

const NAME_POOLS: Record<string, string[]> = {
    kids: ['Poppy', 'Birdie', 'Rosie', 'Clementine', 'Meadow', 'Elsie', 'Daisy', 'Lottie'],
    fashion: ['Sienna', 'Willow', 'Maeve', 'Ivy', 'Wren', 'Clara', 'Elodie', 'Maren'],
    furniture: ['Astrid', 'Linnea', 'Freya', 'Clara', 'Nora', 'Elma', 'Ingrid', 'Anika'],
    decor: ['Linnea', 'Nora', 'Clara', 'Freya', 'Maren', 'Elowen', 'Iris', 'Aster'],
    home: ['Linnea', 'Nora', 'Clara', 'Freya', 'Maren', 'Elowen', 'Iris', 'Aster'],
    other: ['Clara', 'Nora', 'Maeve', 'Wren', 'Linnea', 'Elodie'],
};

const RISKY_NAME_TERMS = [
    'organic', 'oeko', 'fsc', 'non-toxic', 'hypoallergenic', 'solid oak',
    'solid wood', 'machine washable', 'waterproof', 'handmade', 'handcrafted',
    'linen', 'cotton', 'silk', 'wool', 'leather', 'rattan', 'oak', 'walnut',
    'marble', 'brass', 'bamboo',
];

function getModel(): string {
    return process.env.SMART_NAME_MODEL || process.env.SMART_DESCRIPTION_MODEL || 'gemini-2.5-flash';
}

function getAI(): GoogleGenAI {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not configured in Convex environment variables.');
    return new GoogleGenAI({ apiKey: key });
}

function parseJsonObject<T>(raw = ''): T | undefined {
    const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(trimmed.slice(start, end + 1)) as T;
            } catch {
                return undefined;
            }
        }
        return undefined;
    }
}

function allFactValues(facts: NormalizedProductFacts) {
    return [
        ...facts.designDetails,
        ...facts.materials,
        ...facts.colors,
        ...facts.patternOrFinish,
        ...facts.fitOrSilhouette,
        ...facts.functionalDetails,
        ...facts.dimensions,
        ...facts.careInstructions,
        ...facts.ageOrSizeRange,
        ...facts.roomOrUseCase,
        ...facts.variants,
        ...facts.certifications,
    ];
}

function factsForPrompt(facts: NormalizedProductFacts) {
    return {
        productType: facts.productType,
        collection: facts.collection,
        titleFacts: facts.titleFacts,
        sourceQuality: facts.sourceQuality,
        designDetails: facts.designDetails.slice(0, 12),
        colors: facts.colors.slice(0, 8),
        patternOrFinish: facts.patternOrFinish.slice(0, 8),
        fitOrSilhouette: facts.fitOrSilhouette.slice(0, 8),
        functionalDetails: facts.functionalDetails.slice(0, 8),
        variants: facts.variants.slice(0, 8),
        missingImportantFacts: facts.missingImportantFacts,
    };
}

function titleText(facts: NormalizedProductFacts): string {
    return [
        facts.titleFacts.cleanedTitle,
        facts.titleFacts.originalTitle,
        facts.productType.value,
        ...facts.designDetails.map(f => f.value),
        ...facts.functionalDetails.map(f => f.value),
    ].filter(Boolean).join(' ').toLowerCase();
}

export function normalizedNameProductType(facts: NormalizedProductFacts): string {
    const text = titleText(facts);
    const pairs: Array<[RegExp, string]> = [
        [/romper|onesie|bodysuit/, 'Romper'],
        [/\bset\b|2\s?piece|two\s?piece|matching/, 'Set'],
        [/dress/, 'Dress'],
        [/blouse/, 'Blouse'],
        [/\btop\b|shirt|tee/, 'Top'],
        [/cardigan|sweater|knit/, 'Cardigan'],
        [/pants|trouser|jeans/, 'Pants'],
        [/skirt/, 'Skirt'],
        [/chair|seat/, 'Chair'],
        [/stool/, 'Stool'],
        [/sideboard|buffet|cabinet|storage/, 'Cabinet'],
        [/console/, 'Console'],
        [/table|desk/, 'Table'],
        [/lamp|light/, 'Lamp'],
        [/vase|planter|pot/, 'Vase'],
        [/rug|carpet/, 'Rug'],
        [/basket/, 'Basket'],
        [/mirror/, 'Mirror'],
        [/pillow|cushion/, 'Pillow'],
    ];
    for (const [regex, type] of pairs) {
        if (regex.test(text)) return type;
    }
    const fallback = facts.productType.value
        .replace(/\b(piece|product|item|furniture)\b/gi, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .pop();
    return fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1).toLowerCase() : 'Piece';
}

function groundedModifier(facts: NormalizedProductFacts): { modifier?: string; factIds: string[] } {
    const candidates = [
        ...facts.designDetails,
        ...facts.patternOrFinish,
        ...facts.fitOrSilhouette,
        ...facts.functionalDetails,
        ...facts.colors,
        ...facts.variants,
    ];
    const pairs: Array<[RegExp, string]> = [
        [/ruffle|ruffled/, 'Ruffle'],
        [/floral|flower/, 'Floral'],
        [/bow/, 'Bow'],
        [/scallop/, 'Scallop'],
        [/smock|smocked/, 'Smocked'],
        [/pleat|pleated/, 'Pleated'],
        [/ribbed/, 'Ribbed'],
        [/quilted/, 'Quilted'],
        [/curved|rounded/, 'Curved'],
        [/low-profile|low profile/, 'Lowline'],
        [/drawer|door|shelf|storage/, 'Storage'],
        [/stripe|striped/, 'Stripe'],
        [/lace/, 'Lace'],
        [/embroider/, 'Embroidered'],
        [/ivory/, 'Ivory'],
        [/sage/, 'Sage'],
        [/rose|pink/, 'Rose'],
    ];
    for (const fact of candidates) {
        for (const [regex, modifier] of pairs) {
            if (regex.test(fact.value) || regex.test(fact.label)) {
                return { modifier, factIds: [fact.id] };
            }
        }
    }
    return { factIds: [] };
}

function seededIndex(seed: string, size: number): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    return Math.abs(hash) % Math.max(size, 1);
}

export function buildSafeNameFallback(facts: NormalizedProductFacts): GeneratedSmartNameDraft {
    const collection = facts.collection.value;
    const pool = NAME_POOLS[collection] || NAME_POOLS.other;
    const productType = normalizedNameProductType(facts);
    const modifier = groundedModifier(facts);
    const firstName = pool[seededIndex(`${facts.titleFacts.cleanedTitle || ''}:${productType}:${modifier.modifier || ''}`, pool.length)];
    const nameParts = [firstName, modifier.modifier, productType].filter(Boolean);
    return {
        name: nameParts.join(' '),
        firstName,
        modifier: modifier.modifier,
        productType,
        supportedByFactIds: modifier.factIds,
        confidence: Math.min(0.68, Math.max(0.45, facts.sourceQuality.score / 100)),
        notesForAdmin: facts.missingImportantFacts,
    };
}

function cleanNamePart(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.replace(/[^a-zA-Z\s-]/g, '').replace(/\s+/g, ' ').trim();
    return cleaned || undefined;
}

export function coerceSmartNameDraft(value: unknown): GeneratedSmartNameDraft | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const name = cleanNamePart(record.name);
    const firstName = cleanNamePart(record.firstName);
    const productType = cleanNamePart(record.productType);
    if (!name || !firstName || !productType) return undefined;
    return {
        name: name.replace(/^The\s+/i, ''),
        firstName,
        modifier: cleanNamePart(record.modifier),
        productType,
        supportedByFactIds: Array.isArray(record.supportedByFactIds)
            ? record.supportedByFactIds.map(item => String(item)).filter(Boolean)
            : [],
        confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.5,
        notesForAdmin: Array.isArray(record.notesForAdmin)
            ? record.notesForAdmin.map(item => String(item)).filter(Boolean)
            : undefined,
    };
}

export function validateSmartNameDraft(draft: GeneratedSmartNameDraft, facts: NormalizedProductFacts): string[] {
    const errors: string[] = [];
    const name = draft.name.trim();
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) errors.push('Name must be 2-4 words.');
    if (/^the\s/i.test(name)) errors.push('Name must not start with "The".');
    if (name.toLowerCase() === (facts.titleFacts.originalTitle || '').toLowerCase()) errors.push('Name cannot repeat the source title.');
    const productType = normalizedNameProductType(facts).toLowerCase();
    if (!name.toLowerCase().includes(productType)) errors.push(`Name must include the product type "${productType}".`);

    const directFactText = allFactValues(facts)
        .filter(fact => ['source_structured', 'source_text', 'source_title', 'source_variant', 'admin_input'].includes(fact.evidenceLevel))
        .map(fact => `${fact.value} ${fact.label}`.toLowerCase())
        .join(' ');
    for (const term of RISKY_NAME_TERMS) {
        if (!name.toLowerCase().includes(term)) continue;
        if (!directFactText.includes(term)) {
            errors.push(`Unsupported high-risk name term: ${term}.`);
        }
    }
    return errors;
}

export async function generateSmartNameWithGemini(args: {
    facts: NormalizedProductFacts;
    adminContext?: Record<string, unknown>;
}): Promise<GeminiResult<GeneratedSmartNameDraft>> {
    const ai = getAI();
    const model = getModel();
    const productType = normalizedNameProductType(args.facts);
    const fallback = buildSafeNameFallback(args.facts);
    const collection = args.facts.collection.value;
    const firstNamePool = NAME_POOLS[collection] || NAME_POOLS.other;
    const systemInstruction = `
You name Louie Mae products using grounded source facts.
Return JSON only. Do not return Markdown or prose outside JSON.

Goal: a short boutique name that feels personal and specific, while keeping Louie Mae's format.
Preferred format: Feminine first name + grounded modifier + product type.
Acceptable fallback format: Feminine first name + product type.
Examples: "Poppy Ruffle Romper", "Willow Floral Dress", "Elma Curved Chair", "Linnea Storage Cabinet".

Strict rules:
- Use only the verified facts provided.
- Keep the name 2-4 words total.
- Do not start with "The".
- Do not repeat the marketplace/source title.
- Product type must be exactly or very close to: ${productType}.
- Use a modifier only when grounded in visible/source facts, such as ruffle, floral, bow, scallop, smocked, ribbed, curved, lowline, storage, stripe, lace.
- Do not use material, certification, care, safety, handmade, solid wood, organic, FSC, OEKO-TEX, or washable claims unless directly present in verified source facts.
- Choose first names from this collection-appropriate pool when possible: ${firstNamePool.join(', ')}.

JSON shape:
{
  "name": "Poppy Ruffle Romper",
  "firstName": "Poppy",
  "modifier": "Ruffle",
  "productType": "Romper",
  "supportedByFactIds": ["fact-id"],
  "confidence": 0.0,
  "notesForAdmin": []
}
`;
    const response = await ai.models.generateContent({
        model,
        contents: JSON.stringify({
            verifiedFacts: factsForPrompt(args.facts),
            targetProductType: productType,
            safeFallbackExample: fallback,
            adminContext: args.adminContext || {},
        }),
        config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.5,
        },
    } as any);
    const raw = response.text || '';
    const value = parseJsonObject<GeneratedSmartNameDraft>(raw);
    return { value, raw, warnings: value ? [] : ['Gemini returned invalid JSON for smart name.'] };
}

export function getSmartNameModel(): string {
    return getModel();
}
