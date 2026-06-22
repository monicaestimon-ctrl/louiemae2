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
        [/\bsets?\b|2[-\s]?piece|two[-\s]?piece|matching|co[-\s]?ord|coordinat(?:ed|ing)/, 'Sets'],
        [/romper|onesie|bodysuit/, 'Romper'],
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

function groundedModifiers(facts: NormalizedProductFacts): Array<{ modifier?: string; factIds: string[] }> {
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
    const modifiers: Array<{ modifier?: string; factIds: string[] }> = [];
    const seen = new Set<string>();
    for (const fact of candidates) {
        for (const [regex, modifier] of pairs) {
            if (regex.test(fact.value.toLowerCase()) || regex.test(fact.label.toLowerCase())) {
                if (!seen.has(modifier)) {
                    seen.add(modifier);
                    modifiers.push({ modifier, factIds: [fact.id] });
                }
            }
        }
    }
    return modifiers;
}

function groundedModifier(facts: NormalizedProductFacts): { modifier?: string; factIds: string[] } {
    return groundedModifiers(facts)[0] || { factIds: [] };
}

function tokenPattern(term: string): RegExp {
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
}

function containsToken(text: string, term: string): boolean {
    if (!term.trim()) return false;
    return tokenPattern(term).test(text);
}

function seededIndex(seed: string, size: number): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    return Math.abs(hash) % Math.max(size, 1);
}

function normalizeNameKey(name = ''): string {
    return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function existingNameKeys(existingNames: string[] = []): Set<string> {
    return new Set(existingNames.map(normalizeNameKey).filter(Boolean));
}

export function buildSafeNameFallback(facts: NormalizedProductFacts, existingNames: string[] = []): GeneratedSmartNameDraft {
    const collection = facts.collection.value;
    const pool = NAME_POOLS[collection] || NAME_POOLS.other;
    const productType = normalizedNameProductType(facts);
    const modifiers = [...groundedModifiers(facts), { factIds: [] }];
    const used = existingNameKeys(existingNames);
    const seed = seededIndex(`${facts.titleFacts.cleanedTitle || ''}:${productType}:${modifiers[0]?.modifier || ''}`, pool.length);
    let selected = {
        firstName: pool[seed],
        modifier: modifiers[0],
        name: [pool[seed], modifiers[0]?.modifier, productType].filter(Boolean).join(' '),
    };

    for (let nameOffset = 0; nameOffset < pool.length; nameOffset++) {
        const firstName = pool[(seed + nameOffset) % pool.length];
        for (const modifier of modifiers) {
            const name = [firstName, modifier.modifier, productType].filter(Boolean).join(' ');
            selected = { firstName, modifier, name };
            if (!used.has(normalizeNameKey(name))) {
                nameOffset = pool.length;
                break;
            }
        }
    }

    return {
        name: selected.name,
        firstName: selected.firstName,
        modifier: selected.modifier.modifier,
        productType,
        supportedByFactIds: selected.modifier.factIds,
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

export function validateSmartNameDraft(draft: GeneratedSmartNameDraft, facts: NormalizedProductFacts, existingNames: string[] = []): string[] {
    const errors: string[] = [];
    const name = draft.name.trim();
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) errors.push('Name must be 2-4 words.');
    if (/^the\s/i.test(name)) errors.push('Name must not start with "The".');
    if (name.toLowerCase() === (facts.titleFacts.originalTitle || '').toLowerCase()) errors.push('Name cannot repeat the source title.');
    if (existingNameKeys(existingNames).has(normalizeNameKey(name))) errors.push(`Name is already used in inventory: ${name}.`);
    const productType = normalizedNameProductType(facts).toLowerCase();
    if (!containsToken(name.toLowerCase(), productType)) errors.push(`Name must include the product type "${productType}".`);

    const directFactText = allFactValues(facts)
        .filter(fact => ['source_structured', 'source_text', 'source_title', 'source_variant', 'admin_input'].includes(fact.evidenceLevel))
        .map(fact => `${fact.value} ${fact.label}`.toLowerCase())
        .join(' ');
    for (const term of RISKY_NAME_TERMS) {
        if (!containsToken(name.toLowerCase(), term)) continue;
        if (!containsToken(directFactText, term)) {
            errors.push(`Unsupported high-risk name term: ${term}.`);
        }
    }
    return errors;
}

export async function generateSmartNameWithGemini(args: {
    facts: NormalizedProductFacts;
    adminContext?: Record<string, unknown>;
    existingNames?: string[];
}): Promise<GeminiResult<GeneratedSmartNameDraft>> {
    const ai = getAI();
    const model = getModel();
    const productType = normalizedNameProductType(args.facts);
    const fallback = buildSafeNameFallback(args.facts, args.existingNames || []);
    const collection = args.facts.collection.value;
    const firstNamePool = NAME_POOLS[collection] || NAME_POOLS.other;
    const systemInstruction = `
You name Louie Mae products using grounded source facts.
Return JSON only. Do not return Markdown or prose outside JSON.

Goal: a short boutique name that feels personal and specific, while keeping Louie Mae's format.
Preferred format: Feminine first name + grounded modifier + product type.
Acceptable fallback format: Feminine first name + product type.
Examples: "Poppy Ruffle Romper", "Willow Floral Dress", "Sienna Matching Sets", "Elma Curved Chair", "Linnea Storage Cabinet".

Strict rules:
- Use only the verified facts provided.
- Keep the name 2-4 words total.
- Do not start with "The".
- Do not repeat the marketplace/source title.
- Product type must be exactly or very close to: ${productType}.
- If the product is a matching/coordinated outfit, two-piece item, or source/category says sets, the final name must include "Sets".
- Do not reuse any exact name from AVOID_EXISTING_NAMES.
- If a similar product already uses the same first name + product type, choose a different first name from the pool.
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
            avoidExistingNames: (args.existingNames || []).slice(0, 40),
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
