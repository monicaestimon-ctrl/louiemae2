import {
    EvidenceRef,
    FactValue,
    NormalizedProductFacts,
    ProductCollection,
    SourceAttribute,
    SourceProductSnapshot,
    VisualFact,
    normalizeCollection,
} from '../lib/smartDescription';
import { calculateSourceQuality } from './sourceProductNormalizer';

const MATERIAL_TERMS = [
    'cotton', 'linen', 'silk', 'wool', 'rattan', 'oak', 'walnut', 'marble',
    'brass', 'ceramic', 'leather', 'bamboo', 'denim', 'velvet', 'polyester',
    'wood', 'metal', 'glass', 'jute', 'wicker',
];
const CERTIFICATION_TERMS = ['organic', 'OEKO-TEX', 'GOTS', 'FSC', 'BPA-free', 'non-toxic', 'food-safe'];
const CARE_PATTERNS = [/machine wash/i, /tumble dry/i, /wipe clean/i, /spot clean/i, /dry clean/i, /dishwasher safe/i, /outdoor safe/i];
const DIMENSION_PATTERN = /\b(\d+(?:\.\d+)?\s?(?:in|inch|inches|cm|mm|ft|feet|x|×)\b[\w\s.,x×-]*)/gi;
const COLOR_TERMS = [
    'ivory', 'cream', 'white', 'black', 'brown', 'tan', 'beige', 'sage', 'green',
    'blue', 'navy', 'pink', 'rose', 'red', 'yellow', 'gold', 'brass', 'natural',
    'oak', 'walnut', 'gray', 'grey', 'charcoal',
];
const DESIGN_DETAIL_PATTERN = /\b(ruffle|scalloped|ribbed|quilted|woven|drawer|door|button|pocket|gathered|pleated|floral|striped|bow|lace|embroidered|sleeve|neckline|collar|curved|rounded|low-profile|cushion|tufted|tiered|smocked|ruffled|storage|cabinet|shelf)\b/i;

function evidence(source: EvidenceRef['source'], value: string, field?: string): EvidenceRef {
    return { source, field, value, excerpt: value.slice(0, 180) };
}

function fact(
    group: string,
    label: string,
    value: string,
    evidenceLevel: FactValue['evidenceLevel'],
    confidence: number,
    evidenceRefs: EvidenceRef[]
): FactValue {
    return {
        id: `${group}:${label}:${value}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80),
        label,
        value,
        normalizedValue: value.toLowerCase(),
        evidenceLevel,
        confidence,
        evidence: evidenceRefs,
    };
}

function detectProductType(snapshot: SourceProductSnapshot): { value: string; confidence: number; evidence: EvidenceRef[] } {
    const text = [snapshot.rawTitle, snapshot.rawDescription, snapshot.categoryHints?.selectedCategory].filter(Boolean).join(' ').toLowerCase();
    const pairs: Array<[RegExp, string]> = [
        [/romper|onesie|bodysuit/, 'romper'],
        [/dress/, 'dress'],
        [/cardigan|sweater|knit/, 'knitwear'],
        [/blouse|top|shirt/, 'top'],
        [/pants|trouser|jeans/, 'pants'],
        [/chair|seat/, 'chair'],
        [/stool|barstool|counterstool/, 'stool'],
        [/cabinet|buffet|sideboard|storage/, 'storage furniture'],
        [/table|desk|console/, 'table'],
        [/lamp|light/, 'lighting'],
        [/vase|planter|pot/, 'vase'],
        [/rug|carpet/, 'rug'],
        [/basket/, 'basket'],
    ];
    for (const [regex, type] of pairs) {
        if (regex.test(text)) return { value: type, confidence: 0.85, evidence: [evidence('title', text.slice(0, 180), 'combined_text')] };
    }
    const collection = snapshot.categoryHints?.selectedCollection || 'other';
    return { value: collection === 'furniture' ? 'furniture piece' : collection === 'kids' ? 'kids item' : 'product', confidence: 0.45, evidence: [] };
}

function detectCollection(snapshot: SourceProductSnapshot): { value: ProductCollection; confidence: number; evidence: EvidenceRef[] } {
    const collection = normalizeCollection(snapshot.categoryHints?.selectedCollection);
    if (collection !== 'other') {
        return { value: collection, confidence: 0.95, evidence: [evidence('admin_input', collection, 'selectedCollection')] };
    }
    const text = [snapshot.rawTitle, snapshot.rawDescription, snapshot.categoryHints?.selectedCategory].filter(Boolean).join(' ').toLowerCase();
    if (/baby|toddler|kid|girl|boy|child/.test(text)) return { value: 'kids', confidence: 0.65, evidence: [evidence('title', text.slice(0, 160))] };
    if (/dress|blouse|shirt|top|pants|skirt|cardigan/.test(text)) return { value: 'fashion', confidence: 0.6, evidence: [evidence('title', text.slice(0, 160))] };
    if (/chair|table|cabinet|stool|sofa|sideboard/.test(text)) return { value: 'furniture', confidence: 0.6, evidence: [evidence('title', text.slice(0, 160))] };
    return { value: 'other', confidence: 0.3, evidence: [] };
}

function attrFacts(attrs: SourceAttribute[] | undefined, keys: string[], group: string, label: string): FactValue[] {
    return (attrs || [])
        .filter(attr => keys.some(key => attr.key.toLowerCase().includes(key)))
        .map(attr => fact(group, label, attr.value, 'source_structured', attr.confidence, [evidence('attribute', `${attr.key}: ${attr.value}`, attr.key)]));
}

function textFacts(text: string, terms: string[], group: string, label: string): FactValue[] {
    const lower = text.toLowerCase();
    return terms
        .filter(term => lower.includes(term.toLowerCase()))
        .map(term => fact(group, label, term, 'source_text', 0.7, [evidence('description', term)]));
}

function sourceDetailFacts(text: string): FactValue[] {
    return text
        .split(/(?<=[.!?])\s+|\s+[•·]\s+|\n+/)
        .map(part => part.replace(/\s+/g, ' ').trim())
        .filter(part => part.length >= 18 && part.length <= 180 && DESIGN_DETAIL_PATTERN.test(part))
        .slice(0, 8)
        .map(part => fact('source-detail', 'Details', part, 'source_text', 0.72, [evidence('description', part)]));
}

function variantFacts(snapshot: SourceProductSnapshot): FactValue[] {
    return (snapshot.variants || []).map(variant =>
        fact('variants', variant.name, `${variant.name}: ${variant.values.join(', ')}`, 'source_variant', 0.9, [
            evidence('variant', `${variant.name}: ${variant.values.join(', ')}`, variant.name),
        ])
    );
}

function visualFacts(snapshot: SourceProductSnapshot): FactValue[] {
    const facts: FactValue[] = [];
    for (const visual of ((snapshot as SourceProductSnapshot & { visualFacts?: VisualFact[] }).visualFacts || [])) {
        if (!visual.allowedForCopy || visual.claimRisk === 'high') continue;
        facts.push(fact(
            'visual',
            visual.factType,
            visual.value,
            'source_image',
            visual.confidence,
            [{ source: 'image', imageUrl: visual.imageUrl, value: visual.value, excerpt: visual.value.slice(0, 180) }]
        ));
    }
    const images = [...(snapshot.images || []), ...(snapshot.descriptionImages || [])];
    for (const image of images) {
        for (const visual of image.visualFacts || []) {
            if (!visual.allowedForCopy || visual.claimRisk === 'high') continue;
            facts.push(fact(
                'visual',
                visual.factType,
                visual.value,
                'source_image',
                visual.confidence,
                [{ source: 'image', imageUrl: image.url, value: visual.value, excerpt: visual.value.slice(0, 180) }]
            ));
        }
    }
    return facts;
}

function dimensionsFromText(text: string): FactValue[] {
    const matches = [...text.matchAll(DIMENSION_PATTERN)].map(match => match[0].trim()).filter(Boolean);
    return [...new Set(matches)].slice(0, 8).map(value =>
        fact('dimensions', 'Dimensions', value, 'source_text', 0.75, [evidence('description', value)])
    );
}

function careFromText(text: string): FactValue[] {
    return CARE_PATTERNS
        .flatMap(pattern => text.match(pattern) || [])
        .map(value => fact('care', 'Care', value, 'source_text', 0.8, [evidence('description', value)]));
}

function colorsFromTextAndVariants(snapshot: SourceProductSnapshot, combinedText: string): FactValue[] {
    const facts = textFacts(combinedText, COLOR_TERMS, 'colors', 'Color');
    for (const variant of snapshot.variants || []) {
        if (/color|colour/i.test(variant.name)) {
            facts.push(fact('colors', 'Color', variant.values.join(', '), 'source_variant', 0.85, [
                evidence('variant', `${variant.name}: ${variant.values.join(', ')}`, variant.name),
            ]));
        }
    }
    return facts;
}

export function extractNormalizedProductFacts(snapshot: SourceProductSnapshot & { visualFacts?: VisualFact[] }): NormalizedProductFacts {
    const combinedText = [snapshot.rawTitle, snapshot.rawDescription, snapshot.rawHtmlDescription]
        .filter(Boolean)
        .join(' ');
    const productType = detectProductType(snapshot);
    const collection = detectCollection(snapshot);
    const sourceQuality = calculateSourceQuality(snapshot);
    const attrs = snapshot.attributes || [];

    const materials = [
        ...attrFacts(attrs, ['material', 'fabric', 'composition'], 'materials', 'Material'),
        ...textFacts(combinedText, MATERIAL_TERMS, 'materials', 'Material'),
    ];
    const certifications = [
        ...attrFacts(attrs, ['certification', 'certified'], 'certifications', 'Certification'),
        ...textFacts(combinedText, CERTIFICATION_TERMS, 'certifications', 'Certification'),
    ];
    const variants = variantFacts(snapshot);
    const visuals = visualFacts(snapshot);
    const designDetails = [
        ...sourceDetailFacts(combinedText),
        ...visuals,
        ...textFacts(combinedText, ['ruffle', 'scalloped', 'ribbed', 'quilted', 'woven', 'drawer', 'door', 'button', 'pocket'], 'design', 'Design'),
        ...attrFacts(attrs, ['style', 'design', 'feature', 'decoration', 'craft', 'shape'], 'design', 'Design'),
    ];
    const colors = colorsFromTextAndVariants(snapshot, combinedText);
    const dimensions = [
        ...attrFacts(attrs, ['dimension', 'size', 'height', 'width', 'depth'], 'dimensions', 'Dimensions'),
        ...dimensionsFromText(combinedText),
    ];
    const careInstructions = [
        ...attrFacts(attrs, ['care', 'wash', 'clean'], 'care', 'Care'),
        ...careFromText(combinedText),
    ];
    const fitOrSilhouette = [
        ...attrFacts(attrs, ['fit', 'silhouette', 'sleeve', 'neckline', 'length'], 'fit', 'Fit'),
        ...textFacts(combinedText, ['relaxed', 'a-line', 'midi', 'maxi', 'flutter sleeve', 'puff sleeve', 'square neck'], 'fit', 'Fit'),
    ];
    const functionalDetails = [
        ...attrFacts(attrs, ['closure', 'function', 'storage', 'feature'], 'function', 'Function'),
        ...textFacts(combinedText, ['zipper', 'button', 'snap', 'drawer', 'shelf', 'door', 'storage'], 'function', 'Function'),
    ];

    const missingImportantFacts: string[] = [];
    if (materials.length === 0) missingImportantFacts.push('material not confirmed');
    if (careInstructions.length === 0 && ['kids', 'fashion'].includes(collection.value)) missingImportantFacts.push('care instructions not confirmed');
    if (dimensions.length === 0 && collection.value === 'furniture') missingImportantFacts.push('dimensions not confirmed');

    return {
        productType,
        collection,
        titleFacts: {
            originalTitle: snapshot.rawTitle,
            cleanedTitle: snapshot.translatedTitle || snapshot.rawTitle,
            seoTitleCandidate: snapshot.translatedTitle || snapshot.rawTitle,
        },
        designDetails: dedupeFacts(designDetails),
        materials: dedupeFacts(materials),
        colors: dedupeFacts(colors),
        patternOrFinish: dedupeFacts([
            ...attrFacts(attrs, ['pattern', 'finish'], 'finish', 'Finish'),
            ...textFacts(combinedText, ['floral', 'striped', 'matte', 'glossy', 'natural finish', 'washed'], 'finish', 'Finish'),
        ]),
        fitOrSilhouette: dedupeFacts(fitOrSilhouette),
        functionalDetails: dedupeFacts(functionalDetails),
        dimensions: dedupeFacts(dimensions),
        careInstructions: dedupeFacts(careInstructions),
        ageOrSizeRange: dedupeFacts([
            ...attrFacts(attrs, ['age', 'size'], 'size', 'Sizing'),
            ...textFacts(combinedText, ['newborn', '3-6m', '6-12m', '12-18m', 'xs', 'small', 'medium', 'large'], 'size', 'Sizing'),
        ]),
        roomOrUseCase: dedupeFacts(textFacts(combinedText, ['entryway', 'dining room', 'living room', 'nursery', 'playroom'], 'use', 'Placement')),
        variants: dedupeFacts(variants),
        certifications: dedupeFacts(certifications),
        avoidClaims: [],
        missingImportantFacts,
        sourceQuality,
    };
}

function dedupeFacts(facts: FactValue[]): FactValue[] {
    const seen = new Set<string>();
    return facts.filter(factValue => {
        const key = `${factValue.label}:${factValue.normalizedValue}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 20);
}
