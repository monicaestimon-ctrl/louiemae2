import type { ProductAudience, SourceProductSnapshot, NormalizedProductFacts } from './smartDescription';

// Specific phrases consume their words before broad nouns are considered.
const TYPES: Array<[RegExp, string]> = [
    [/\btable lamps?\b/gi, 'table lamp'], [/\bfloor lamps?\b/gi, 'floor lamp'],
    [/\bdesk lamps?\b/gi, 'desk lamp'], [/\bpendant lights?\b/gi, 'pendant light'],
    [/\b(?:lamp shades?|lampshades?)\b/gi, 'lampshade'],
    [/\bconsole tables?\b/gi, 'console'],
    [/\b(?:coffee|dining|side|end|bedside|accent) tables?\b/gi, 'table'],
    [/\b(?:rompers?|onesies?|bodysuits?|jumpsuits?)\b/gi, 'romper'],
    [/\bdress(?:es)?\b/gi, 'dress'], [/\bblouses?\b/gi, 'blouse'],
    [/\b(?:cardigans?|sweaters?|knitwear)\b/gi, 'cardigan'],
    [/\b(?:tops?|shirts?|tees?)\b/gi, 'top'], [/\b(?:pants|trousers?|jeans)\b/gi, 'pants'],
    [/\bskirts?\b/gi, 'skirt'], [/\b(?:barstools?|counterstools?|stools?)\b/gi, 'stool'],
    [/\b(?:chairs?|seats?)\b/gi, 'chair'], [/\b(?:sideboards?|buffets?|cabinets?)\b/gi, 'cabinet'],
    [/\bconsoles?\b/gi, 'console'], [/\b(?:tables?|desks?)\b/gi, 'table'],
    [/\b(?:lamps?|lights?|lighting)\b/gi, 'lamp'], [/\b(?:vases?|planters?|pots?)\b/gi, 'vase'],
    [/\b(?:rugs?|carpets?)\b/gi, 'rug'], [/\bbaskets?\b/gi, 'basket'],
    [/\bmirrors?\b/gi, 'mirror'], [/\b(?:pillows?|cushions?)\b/gi, 'pillow'],
    [/\b(?:sofas?|couches?)\b/gi, 'sofa'],
];

function candidates(input: string): string[] {
    // Placement suggestions and accessories must not rename the main product.
    let text = input.toLowerCase().replace(/[-_]/g, ' ').split(/\b(?:for|beside|alongside|paired with|on a|on the|with)\b/)[0];
    const found = new Set<string>();
    for (const [pattern, type] of TYPES) text = text.replace(pattern, () => { found.add(type); return ' '; });
    if (/\b(?:sets?|outfits?|two piece|2 piece|co ord)\b/.test(text)
        && [...found].every(type => ['romper', 'dress', 'top', 'blouse', 'pants', 'skirt', 'cardigan'].includes(type))) return ['set'];
    // A compound and its generic synonym agree; distinct products do not.
    if ([...found].some(type => / lamp$/.test(type))) found.delete('lamp');
    return [...found];
}

export function resolveProductIdentity(snapshot: SourceProductSnapshot, audience: ProductAudience): NormalizedProductFacts['productType'] {
    const hints = snapshot.categoryHints;
    const visuals = [...snapshot.images, ...(snapshot.descriptionImages || [])].flatMap(image =>
        (image.visualFacts || []).filter(f => f.allowedForCopy && f.claimRisk === 'low' && f.confidence >= .8).map(f => f.value));
    const tiers: Array<{ values: string[]; source: 'attribute' | 'title' | 'admin_input' | 'image' | 'description'; confidence: number }> = [
        { values: (snapshot.attributes || []).filter(a => /^(product type|item type|type)$/i.test(a.key)).map(a => a.value), source: 'attribute', confidence: .95 },
        { values: [snapshot.translatedTitle, snapshot.rawTitle].filter(Boolean) as string[], source: 'title', confidence: .9 },
        { values: [hints?.selectedSubcategory, ...(hints?.selectedSubcategories || []), ...(hints?.selectedSubcategoryIds || []), hints?.selectedCategory].filter(Boolean) as string[], source: 'admin_input', confidence: .85 },
        { values: visuals, source: 'image', confidence: .8 },
        { values: [snapshot.translatedDescription || snapshot.rawDescription || ''], source: 'description', confidence: .7 },
    ];
    for (const tier of tiers) {
        const types = new Set(tier.values.flatMap(candidates));
        if (!types.size) continue;
        if ([...types].some(type => / lamp$/.test(type))) types.delete('lamp');
        if (types.size !== 1) return { value: 'product', confidence: .2, evidence: [] };
        let value = [...types][0];
        if (value === 'romper' && ['boys', 'unisex'].includes(audience)) value = 'onesie';
        return { value, confidence: tier.confidence, evidence: [{ source: tier.source, value: tier.values.join('; '), field: 'product_identity' }] };
    }
    return { value: 'product', confidence: .2, evidence: [] };
}

export function displayProductType(type: string): string {
    if (type === 'set') return 'Sets';
    return type.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
