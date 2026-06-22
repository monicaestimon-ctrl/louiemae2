export type SourcePlatform = '1688' | 'taobao' | 'alibaba' | 'shopify' | 'generic' | 'manual';
export type ProductCollection = 'kids' | 'fashion' | 'furniture' | 'decor' | 'home' | 'other';

export type VisualFact = {
    factType:
    | 'color'
    | 'shape'
    | 'pattern'
    | 'texture'
    | 'visible_detail'
    | 'silhouette'
    | 'closure'
    | 'storage'
    | 'size_chart_text'
    | 'warning';
    value: string;
    confidence: number;
    imageUrl: string;
    allowedForCopy: boolean;
    claimRisk: 'low' | 'medium' | 'high';
};

export type SourceImage = {
    url: string;
    role: 'primary' | 'gallery' | 'detail' | 'size_chart' | 'variant' | 'lifestyle' | 'unknown';
    altText?: string;
    width?: number;
    height?: number;
    visualFacts?: VisualFact[];
};

export type SourceVariant = {
    name: string;
    values: string[];
};

export type SourceAttribute = {
    key: string;
    value: string;
    source: 'otapi_property' | 'json_ld' | 'html_table' | 'meta_tag' | 'scraped_text' | 'admin_input' | 'manual';
    confidence: number;
};

export type SourceProductSnapshot = {
    sourceUrl?: string;
    sourceDomain?: string;
    sourcePlatform?: SourcePlatform;
    importedAt: number;
    rawTitle?: string;
    rawDescription?: string;
    rawHtmlDescription?: string;
    translatedTitle?: string;
    translatedDescription?: string;
    price?: {
        amount?: number;
        currency?: string;
        raw?: string;
    };
    images: SourceImage[];
    descriptionImages?: SourceImage[];
    variants?: SourceVariant[];
    attributes?: SourceAttribute[];
    categoryHints?: {
        sourceCategory?: string;
        selectedCategory?: string;
        selectedSubcategory?: string;
        selectedCollection?: ProductCollection;
    };
    seller?: {
        name?: string;
        rating?: number;
        salesCount?: number;
        location?: string;
    };
    sourceMetadata?: Record<string, unknown>;
};

export type EvidenceRef = {
    source: 'title' | 'description' | 'html_description' | 'attribute' | 'variant' | 'image' | 'json_ld' | 'admin_input';
    field?: string;
    value?: string;
    imageUrl?: string;
    excerpt?: string;
};

export type FactValue = {
    id: string;
    label: string;
    value: string;
    normalizedValue?: string;
    evidenceLevel:
    | 'source_structured'
    | 'source_text'
    | 'source_title'
    | 'source_variant'
    | 'source_image'
    | 'admin_input'
    | 'inferred_low_confidence';
    confidence: number;
    evidence: EvidenceRef[];
};

export type NormalizedProductFacts = {
    productType: {
        value: string;
        confidence: number;
        evidence: EvidenceRef[];
    };
    collection: {
        value: ProductCollection;
        confidence: number;
        evidence: EvidenceRef[];
    };
    titleFacts: {
        originalTitle?: string;
        cleanedTitle?: string;
        seoTitleCandidate?: string;
    };
    designDetails: FactValue[];
    materials: FactValue[];
    colors: FactValue[];
    patternOrFinish: FactValue[];
    fitOrSilhouette: FactValue[];
    functionalDetails: FactValue[];
    dimensions: FactValue[];
    careInstructions: FactValue[];
    ageOrSizeRange: FactValue[];
    roomOrUseCase: FactValue[];
    variants: FactValue[];
    certifications: FactValue[];
    avoidClaims: string[];
    missingImportantFacts: string[];
    sourceQuality: {
        score: number;
        reasons: string[];
    };
};

export type GeneratedDescriptionDraft = {
    openingSentence: string;
    detailLines: Array<{
        label: string;
        detail: string;
        supportedByFactIds: string[];
        riskLevel: 'low' | 'medium' | 'high';
    }>;
    seoKeywordsUsed: string[];
    avoidedClaims: string[];
    confidence: number;
    notesForAdmin?: string[];
};

export type DescriptionValidationIssue = {
    code:
    | 'MISSING_OPENING'
    | 'TOO_FEW_DETAIL_LINES'
    | 'INVALID_SEPARATOR'
    | 'BANNED_PHRASE'
    | 'UNSUPPORTED_MATERIAL_CLAIM'
    | 'UNSUPPORTED_CERTIFICATION_CLAIM'
    | 'UNSUPPORTED_CARE_CLAIM'
    | 'UNSUPPORTED_DIMENSION_CLAIM'
    | 'UNSUPPORTED_SAFETY_CLAIM'
    | 'GENERIC_COPY'
    | 'TOO_SIMILAR'
    | 'MOJIBAKE_DETECTED'
    | 'INVALID_LABEL'
    | 'OVERLY_LONG'
    | 'SOURCE_QUALITY_LOW';
    message: string;
    text?: string;
    severity: 'error' | 'warning';
};

export type ClaimCheck = {
    claim: string;
    supported: boolean;
    issueCode?: DescriptionValidationIssue['code'];
    evidence?: EvidenceRef[];
};

export type DescriptionValidationResult = {
    passed: boolean;
    errors: DescriptionValidationIssue[];
    warnings: DescriptionValidationIssue[];
    claimChecks: ClaimCheck[];
    repaired: boolean;
};

export type SmartDescriptionRequest = {
    productId?: string;
    importSessionId?: string;
    sourceSnapshot: SourceProductSnapshot;
    adminContext?: {
        selectedCategory?: string;
        selectedSubcategory?: string;
        selectedCollection?: string;
        desiredTone?: 'default' | 'softer' | 'more_elevated' | 'more_minimal' | 'more_playful';
        requiredKeywords?: string[];
        bannedWords?: string[];
        notes?: string;
    };
    generationMode: 'import_auto' | 'manual_generate' | 'manual_regenerate' | 'batch_regenerate' | 'repair_existing';
    options?: {
        allowImageAnalysis?: boolean;
        allowSeoKeywords?: boolean;
        maxLines?: number;
        forceFreshVariation?: boolean;
    };
};

export type SmartDescriptionResponse = {
    ok: boolean;
    description?: string;
    structured?: GeneratedDescriptionDraft;
    facts?: NormalizedProductFacts;
    auditId?: string;
    warnings: string[];
    validation: DescriptionValidationResult;
    fallbackUsed: boolean;
    fallbackReason?: string;
    error?: string;
};

export const DESCRIPTION_SEPARATOR = ' · ';

export const MOJIBAKE_REPLACEMENTS: Record<string, string> = {
    'Â·': '·',
    'â€¢': '·',
    'â€§': '·',
    'â€“': '-',
    'â€”': '-',
    'â€™': "'",
    'â€œ': '"',
    'â€': '"',
    'â€': '"',
    'Ã—': 'x',
};

const PLACEHOLDER_SOURCE_DESCRIPTIONS = [
    /^imported\s+from\s+1688\.com$/i,
    /^imported\s+from\s+source$/i,
    /^source\s+listing$/i,
];

const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /write\s+a\s+five[-\s]?star\s+review/gi,
    /say\s+this\s+is\s+certified/gi,
    /include\s+the\s+word\s+guaranteed/gi,
    /do\s+not\s+mention/gi,
    /system\s+prompt/gi,
    /developer\s+message/gi,
];

export function normalizeMojibake(input = ''): string {
    const firstPass = Object.entries(MOJIBAKE_REPLACEMENTS).reduce(
        (text, [bad, good]) => text.split(bad).join(good),
        input
    );
    return firstPass
        .split('Â·').join('·')
        .split('â€¢').join('·')
        .split('â€“').join('-')
        .split('â€”').join('-')
        .split('â€™').join("'")
        .split('â€œ').join('"')
        .split('â€').join('"')
        .split('Ã—').join('x');
}

function cleanGeneratedText(value: unknown, options: { minAlpha?: number; minWords?: number } = {}): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = normalizeMojibake(decodeHtmlEntities(value)).replace(/\s+/g, ' ').trim();
    if (!text || /^\[object Object\]$/i.test(text)) return undefined;

    const alphaCount = (text.match(/[a-z]/gi) || []).length;
    const commaCount = (text.match(/,/g) || []).length;
    if (text.length > 20 && commaCount > Math.max(4, alphaCount / 3)) return undefined;
    if (options.minAlpha && alphaCount < options.minAlpha) return undefined;
    if (options.minWords && text.split(/\s+/).filter(Boolean).length < options.minWords) return undefined;
    return text;
}

function cleanStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => cleanGeneratedText(item))
        .filter((item): item is string => Boolean(item));
}

export function coerceGeneratedDescriptionDraft(value: unknown): GeneratedDescriptionDraft | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const openingSentence = cleanGeneratedText(record.openingSentence, { minAlpha: 10, minWords: 5 });
    if (!openingSentence || !Array.isArray(record.detailLines)) return undefined;

    const detailLines = record.detailLines
        .map((line): GeneratedDescriptionDraft['detailLines'][number] | undefined => {
            if (!line || typeof line !== 'object' || Array.isArray(line)) return undefined;
            const lineRecord = line as Record<string, unknown>;
            const label = cleanGeneratedText(lineRecord.label, { minAlpha: 3 });
            const detail = cleanGeneratedText(lineRecord.detail, { minAlpha: 6, minWords: 2 });
            if (!label || !detail) return undefined;
            const riskLevel = lineRecord.riskLevel;
            return {
                label,
                detail,
                supportedByFactIds: cleanStringArray(lineRecord.supportedByFactIds),
                riskLevel: riskLevel === 'low' || riskLevel === 'medium' || riskLevel === 'high' ? riskLevel : 'medium',
            };
        })
        .filter((line): line is GeneratedDescriptionDraft['detailLines'][number] => Boolean(line));

    return {
        openingSentence,
        detailLines,
        seoKeywordsUsed: cleanStringArray(record.seoKeywordsUsed),
        avoidedClaims: cleanStringArray(record.avoidedClaims),
        confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.5,
        notesForAdmin: Array.isArray(record.notesForAdmin) ? cleanStringArray(record.notesForAdmin) : undefined,
    };
}

export function decodeHtmlEntities(input = ''): string {
    return input
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

export function sanitizeSourceText(input = '', maxChars = 20000): { text: string; warnings: string[] } {
    const warnings: string[] = [];
    let text = normalizeMojibake(decodeHtmlEntities(input));
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<(br|\/p|\/li|\/tr)\b[^>]*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\b(shipping|payment|returns?|refunds?|wholesale|dropshipping)\b[\s\S]{0,300}/gi, ' ');
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
            warnings.push('Potential source prompt injection removed from source description.');
            pattern.lastIndex = 0;
            text = text.replace(pattern, ' ');
        }
    }
    text = text
        .replace(/[•·]/g, ' · ')
        .replace(/\s+/g, ' ')
        .replace(/\s+·\s+/g, ' · ')
        .trim();
    if (text.length > maxChars) {
        warnings.push(`Source text was truncated to ${maxChars} characters.`);
        text = text.slice(0, maxChars).trim();
    }
    text = normalizeMojibake(text)
        .replace(/\s*(?:Â·|·)\s*/g, DESCRIPTION_SEPARATOR)
        .replace(/\s+/g, ' ')
        .trim();
    return { text, warnings: [...new Set(warnings)] };
}

export function isPlaceholderSourceText(input?: string): boolean {
    const text = sanitizeSourceText(input || '', 500).text;
    return PLACEHOLDER_SOURCE_DESCRIPTIONS.some(pattern => pattern.test(text));
}

export function inferSourceDomain(url?: string): string | undefined {
    if (!url) return undefined;
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return undefined;
    }
}

export function inferSourcePlatform(url?: string): SourcePlatform {
    const domain = inferSourceDomain(url) || '';
    if (domain.includes('1688.com')) return '1688';
    if (domain.includes('taobao.com')) return 'taobao';
    if (domain.includes('alibaba.com') || domain.includes('alicdn.com')) return 'alibaba';
    if (domain.includes('myshopify.com') || domain.includes('shopify.com')) return 'shopify';
    return url ? 'generic' : 'manual';
}

function imageFromUrl(url: string, role: SourceImage['role'], altText?: string): SourceImage | null {
    const normalized = typeof url === 'string' && url.startsWith('//') ? `https:${url}` : url;
    if (!normalized || typeof normalized !== 'string') return null;
    return { url: normalized, role, altText };
}

export function normalizeImageList(images: unknown, role: SourceImage['role']): SourceImage[] {
    const raw = Array.isArray(images) ? images : images ? [images] : [];
    const result: SourceImage[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        const url = typeof item === 'string'
            ? item
            : (item as any)?.url || (item as any)?.src || (item as any)?.Large?.Url || (item as any)?.Medium?.Url;
        const image = imageFromUrl(url, result.length === 0 && role === 'gallery' ? 'primary' : role, (item as any)?.altText);
        if (image && !seen.has(image.url)) {
            seen.add(image.url);
            result.push(image);
        }
    }
    return result;
}

export function normalizeVariants(variants: unknown): SourceVariant[] {
    const raw = Array.isArray(variants) ? variants : [];
    const groups = new Map<string, Set<string>>();
    for (const variant of raw) {
        const name = String((variant as any)?.name || '').trim();
        if (!name) continue;
        const parts = name.split('/').map(part => part.trim()).filter(Boolean);
        for (const part of parts.length ? parts : [name]) {
            const [keyRaw, valueRaw] = part.includes(':') ? part.split(/:(.+)/) : ['Option', part];
            const key = keyRaw.trim() || 'Option';
            const value = valueRaw?.trim() || part;
            if (!groups.has(key)) groups.set(key, new Set());
            groups.get(key)!.add(value);
        }
    }
    return [...groups.entries()].map(([name, values]) => ({ name, values: [...values].slice(0, 30) }));
}

export function buildSourceProductSnapshot(input: {
    sourceUrl?: string;
    name?: string;
    title?: string;
    rawTitle?: string;
    description?: string;
    rawDescription?: string;
    htmlDescription?: string;
    price?: number | { amount?: number; currency?: string; raw?: string };
    currency?: string;
    images?: unknown;
    descriptionImages?: unknown;
    variants?: unknown;
    attributes?: SourceAttribute[] | Record<string, unknown>;
    category?: string;
    subcategory?: string;
    collection?: string;
    categoryHints?: {
        selectedCategory?: string;
        selectedSubcategory?: string;
        selectedCollection?: string;
    };
    sellerName?: string;
    sellerRating?: number;
    salesCount?: number;
    sourceMetadata?: Record<string, unknown>;
}): SourceProductSnapshot {
    const sourceUrl = input.sourceUrl;
    const priceAmount = typeof input.price === 'number' ? input.price : input.price?.amount;
    const priceCurrency = typeof input.price === 'object' ? input.price.currency : input.currency;
    const priceRaw = typeof input.price === 'object' ? input.price.raw : undefined;
    const descriptionInput = input.rawDescription || input.description || '';
    const rawDescription = isPlaceholderSourceText(descriptionInput)
        ? ''
        : sanitizeSourceText(descriptionInput).text;
    const rawHtmlDescription = sanitizeSourceText(input.htmlDescription || '').text;
    const attributes = Array.isArray(input.attributes)
        ? input.attributes
        : Object.entries(input.attributes || {}).map(([key, value]) => ({
            key,
            value: String(value),
            source: 'admin_input' as const,
            confidence: 0.8,
        }));
    return {
        sourceUrl,
        sourceDomain: inferSourceDomain(sourceUrl),
        sourcePlatform: inferSourcePlatform(sourceUrl),
        importedAt: Date.now(),
        rawTitle: sanitizeSourceText(input.rawTitle || input.title || input.name || '').text,
        rawDescription,
        rawHtmlDescription,
        price: {
            amount: priceAmount,
            currency: priceCurrency || 'USD',
            raw: priceRaw || (typeof priceAmount === 'number' ? String(priceAmount) : undefined),
        },
        images: normalizeImageList(input.images, 'gallery'),
        descriptionImages: normalizeImageList(input.descriptionImages, 'detail'),
        variants: normalizeVariants(input.variants),
        attributes,
        categoryHints: {
            selectedCategory: input.categoryHints?.selectedCategory || input.category,
            selectedSubcategory: input.categoryHints?.selectedSubcategory || input.subcategory,
            selectedCollection: normalizeCollection(input.categoryHints?.selectedCollection || input.collection),
        },
        seller: {
            name: input.sellerName,
            rating: input.sellerRating,
            salesCount: input.salesCount,
        },
        sourceMetadata: input.sourceMetadata,
    };
}

export function normalizeCollection(collection?: string): ProductCollection {
    const normalized = (collection || '').toLowerCase();
    if (['kids', 'fashion', 'furniture', 'decor', 'home'].includes(normalized)) {
        return normalized as ProductCollection;
    }
    if (normalized.includes('mae')) return 'fashion';
    if (normalized.includes('child') || normalized.includes('baby')) return 'kids';
    return 'other';
}

export function formatDescription(draft: GeneratedDescriptionDraft): string {
    return [
        draft.openingSentence.trim(),
        '',
        ...draft.detailLines.map(line => `${line.label.trim()} · ${line.detail.trim()}`),
    ].join('\n').trim().replace(/\s*Â·\s*/g, DESCRIPTION_SEPARATOR);
}

export function createEmptyValidationResult(message = 'Not validated'): DescriptionValidationResult {
    return {
        passed: false,
        errors: [{ code: 'GENERIC_COPY', message, severity: 'error' }],
        warnings: [],
        claimChecks: [],
        repaired: false,
    };
}
