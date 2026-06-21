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
    return Object.entries(MOJIBAKE_REPLACEMENTS).reduce(
        (text, [bad, good]) => text.split(bad).join(good),
        input
    );
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
        if (pattern.test(text)) {
            warnings.push('Potential source prompt injection removed from source description.');
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
    return { text, warnings: [...new Set(warnings)] };
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
    description?: string;
    htmlDescription?: string;
    price?: number;
    currency?: string;
    images?: unknown;
    descriptionImages?: unknown;
    variants?: unknown;
    attributes?: SourceAttribute[] | Record<string, unknown>;
    category?: string;
    subcategory?: string;
    collection?: string;
    sellerName?: string;
    sellerRating?: number;
    salesCount?: number;
    sourceMetadata?: Record<string, unknown>;
}): SourceProductSnapshot {
    const sourceUrl = input.sourceUrl;
    const rawDescription = sanitizeSourceText(input.description || '').text;
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
        rawTitle: sanitizeSourceText(input.title || input.name || '').text,
        rawDescription,
        rawHtmlDescription,
        price: {
            amount: input.price,
            currency: input.currency || 'USD',
            raw: typeof input.price === 'number' ? String(input.price) : undefined,
        },
        images: normalizeImageList(input.images, 'gallery'),
        descriptionImages: normalizeImageList(input.descriptionImages, 'detail'),
        variants: normalizeVariants(input.variants),
        attributes,
        categoryHints: {
            selectedCategory: input.category,
            selectedSubcategory: input.subcategory,
            selectedCollection: normalizeCollection(input.collection),
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
    ].join('\n').trim();
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
