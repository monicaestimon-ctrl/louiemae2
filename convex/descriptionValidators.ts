import {
    ClaimCheck,
    DescriptionValidationIssue,
    DescriptionValidationResult,
    GeneratedDescriptionDraft,
    NormalizedProductFacts,
    SourceProductSnapshot,
} from '../lib/smartDescription';
import { BrandVoiceConfig } from './brandVoice';

const MATERIAL_CLAIMS = ['cotton', 'linen', 'silk', 'wool', 'rattan', 'oak', 'walnut', 'marble', 'brass', 'ceramic', 'leather', 'bamboo', 'solid wood'];
const CERT_CLAIMS = ['organic', 'oeko-tex', 'gots', 'fsc', 'non-toxic', 'bpa-free', 'food-safe'];
const CARE_CLAIMS = ['machine washable', 'machine wash', 'tumble dry', 'wipe clean', 'dishwasher safe', 'outdoor safe', 'spot clean', 'dry clean'];
const SAFETY_CLAIMS = ['baby-safe', 'child-safe', 'hypoallergenic', 'flame-retardant'];
const CONSTRUCTION_CLAIMS = ['handmade', 'handcrafted', 'handwoven', 'kiln-dried', 'artisan-made'];
const MOJIBAKE_PATTERN = /Â|â€“|â€”|â€™|â€œ|â€|Ã—/;
const GENERIC_OPENING = /\b(beautiful|stylish|premium|perfect|versatile|high-quality|comfortable|elegant|unique|charming)\b/gi;

const VALID_LABELS = new Set([
    'Design', 'Feel', 'Fit', 'Details', 'Wear', 'Care', 'Sizing',
    'Fabric', 'Styling', 'Length', 'Closure', 'Material', 'Finish',
    'Function', 'Storage', 'Dimensions', 'Placement', 'Texture', 'Scale',
]);

function draftText(draft: GeneratedDescriptionDraft): string {
    return [draft.openingSentence, ...draft.detailLines.map(line => `${line.label} · ${line.detail}`)].join('\n');
}

function issue(code: DescriptionValidationIssue['code'], message: string, severity: 'error' | 'warning' = 'error', text?: string): DescriptionValidationIssue {
    return { code, message, severity, text };
}

function words(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function allFacts(facts: NormalizedProductFacts) {
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

function hasDirectEvidenceFor(term: string, facts: NormalizedProductFacts, groups: Array<keyof NormalizedProductFacts>): boolean {
    const lower = term.toLowerCase();
    return groups.some(group => {
        const values = facts[group];
        return Array.isArray(values) && values.some((fact: any) =>
            `${fact.value} ${fact.label}`.toLowerCase().includes(lower) &&
            ['source_structured', 'source_text', 'source_title', 'source_variant', 'admin_input'].includes(fact.evidenceLevel)
        );
    });
}

function claimCodeForTerm(term: string): DescriptionValidationIssue['code'] {
    const lower = term.toLowerCase();
    if (CARE_CLAIMS.some(claim => lower.includes(claim))) return 'UNSUPPORTED_CARE_CLAIM';
    if (SAFETY_CLAIMS.some(claim => lower.includes(claim))) return 'UNSUPPORTED_SAFETY_CLAIM';
    if (CERT_CLAIMS.some(claim => lower.includes(claim)) || /certified|fsc|oeko|gots|organic/.test(lower)) {
        return 'UNSUPPORTED_CERTIFICATION_CLAIM';
    }
    return 'UNSUPPORTED_MATERIAL_CLAIM';
}

function checkClaims(text: string, facts: NormalizedProductFacts, brandVoice: BrandVoiceConfig): ClaimCheck[] {
    const lower = text.toLowerCase();
    const checks: ClaimCheck[] = [];
    const seen = new Set<string>();
    const add = (terms: string[], groups: Array<keyof NormalizedProductFacts>, issueCode: DescriptionValidationIssue['code']) => {
        for (const term of terms) {
            if (!lower.includes(term.toLowerCase())) continue;
            const supported = hasDirectEvidenceFor(term, facts, groups);
            seen.add(term.toLowerCase());
            checks.push({ claim: term, supported, issueCode: supported ? undefined : issueCode });
        }
    };
    add(MATERIAL_CLAIMS, ['materials'], 'UNSUPPORTED_MATERIAL_CLAIM');
    add(CERT_CLAIMS, ['certifications'], 'UNSUPPORTED_CERTIFICATION_CLAIM');
    add(CARE_CLAIMS, ['careInstructions'], 'UNSUPPORTED_CARE_CLAIM');
    add(SAFETY_CLAIMS, ['certifications'], 'UNSUPPORTED_SAFETY_CLAIM');
    add(CONSTRUCTION_CLAIMS, ['functionalDetails', 'materials'], 'UNSUPPORTED_MATERIAL_CLAIM');
    if (/\b\d+(?:\.\d+)?\s?(?:in|inch|inches|cm|mm|ft|feet|x|×)\b/i.test(text)) {
        checks.push({
            claim: 'dimension',
            supported: facts.dimensions.length > 0,
            issueCode: facts.dimensions.length > 0 ? undefined : 'UNSUPPORTED_DIMENSION_CLAIM',
        });
    }
    for (const term of brandVoice.bannedClaimsWithoutEvidence) {
        const normalized = term.toLowerCase();
        if (seen.has(normalized) || !lower.includes(normalized)) continue;
        const supported = hasDirectEvidenceFor(term, facts, ['materials', 'certifications', 'careInstructions', 'dimensions', 'functionalDetails']);
        checks.push({ claim: term, supported, issueCode: supported ? undefined : claimCodeForTerm(term) });
    }
    return checks;
}

function normalizeForSimilarity(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a: string, b: string): number {
    const aWords = new Set(normalizeForSimilarity(a).split(' ').filter(Boolean));
    const bWords = new Set(normalizeForSimilarity(b).split(' ').filter(Boolean));
    if (aWords.size === 0 || bWords.size === 0) return 0;
    const overlap = [...aWords].filter(word => bWords.has(word)).length;
    return overlap / Math.max(aWords.size, bWords.size);
}

export function validateGeneratedDescription(args: {
    draft: GeneratedDescriptionDraft;
    facts: NormalizedProductFacts;
    brandVoice: BrandVoiceConfig;
    similarDescriptions?: string[];
}): DescriptionValidationResult {
    const { draft, facts, brandVoice } = args;
    const errors: DescriptionValidationIssue[] = [];
    const warnings: DescriptionValidationIssue[] = [];
    const text = draftText(draft);
    const validFactIds = new Set(getFactIds(facts));

    if (!draft.openingSentence?.trim()) errors.push(issue('MISSING_OPENING', 'Opening sentence is required.'));
    const openingWords = words(draft.openingSentence || '');
    if (openingWords > 0 && (openingWords < brandVoice.descriptionFormat.openingSentenceMinWords || openingWords > brandVoice.descriptionFormat.openingSentenceMaxWords)) {
        warnings.push(issue('OVERLY_LONG', 'Opening sentence is outside the preferred word count.', 'warning', draft.openingSentence));
    }
    if (!Array.isArray(draft.detailLines) || draft.detailLines.length < brandVoice.descriptionFormat.minDetailLines) {
        errors.push(issue('TOO_FEW_DETAIL_LINES', 'Description needs at least three detail lines.'));
    }
    if (draft.detailLines?.length > brandVoice.descriptionFormat.maxDetailLines) {
        warnings.push(issue('OVERLY_LONG', 'Description has more detail lines than preferred.', 'warning'));
    }
    for (const line of draft.detailLines || []) {
        if (!VALID_LABELS.has(line.label)) errors.push(issue('INVALID_LABEL', `Invalid label: ${line.label}`, 'error', line.label));
        if (!line.detail?.trim() || /^(n\/?a|none|unknown|tbd|-)\.?$/i.test(line.detail.trim())) {
            errors.push(issue('GENERIC_COPY', 'Detail line is empty or filler.', 'error', `${line.label} · ${line.detail}`));
        }
        const hasSupportedFacts = line.supportedByFactIds.some(factId => validFactIds.has(factId));
        if (line.label === 'Material' && !hasSupportedFacts) {
            errors.push(issue('UNSUPPORTED_MATERIAL_CLAIM', 'Material label requires a supporting material fact.', 'error', line.detail));
        }
        if (line.label === 'Care' && !hasSupportedFacts) {
            errors.push(issue('UNSUPPORTED_CARE_CLAIM', 'Care label requires direct care evidence.', 'error', line.detail));
        }
        if (line.label === 'Dimensions' && !hasSupportedFacts) {
            errors.push(issue('UNSUPPORTED_DIMENSION_CLAIM', 'Dimensions label requires direct dimension evidence.', 'error', line.detail));
        }
    }
    for (const phrase of brandVoice.bannedPhrases) {
        if (text.toLowerCase().includes(phrase.toLowerCase())) {
            errors.push(issue('BANNED_PHRASE', `Banned phrase found: ${phrase}`, 'error', phrase));
        }
    }
    if (MOJIBAKE_PATTERN.test(text)) errors.push(issue('MOJIBAKE_DETECTED', 'Mojibake characters detected.', 'error'));
    const genericMatches = text.match(GENERIC_OPENING) || [];
    if (genericMatches.length >= 4) warnings.push(issue('GENERIC_COPY', 'Copy relies on too many generic adjectives.', 'warning'));

    const claimChecks = checkClaims(text, facts, brandVoice);
    for (const check of claimChecks) {
        if (!check.supported && check.issueCode) {
            errors.push(issue(check.issueCode, `Unsupported claim lacks direct evidence: ${check.claim}`, 'error', check.claim));
        }
    }
    for (const existing of args.similarDescriptions || []) {
        if (similarity(draft.openingSentence, existing.split(/\r?\n/)[0] || existing) > 0.75) {
            errors.push(issue('TOO_SIMILAR', 'Opening sentence is too similar to existing product copy.', 'error', draft.openingSentence));
            break;
        }
    }
    if (facts.sourceQuality.score < 30) {
        warnings.push(issue('SOURCE_QUALITY_LOW', 'Source quality is low; admin review is required.', 'warning'));
    }

    return {
        passed: errors.length === 0,
        errors,
        warnings,
        claimChecks,
        repaired: false,
    };
}

export function isRepairableValidationIssue(issue: DescriptionValidationIssue): boolean {
    return [
        'BANNED_PHRASE',
        'GENERIC_COPY',
        'TOO_SIMILAR',
        'MOJIBAKE_DETECTED',
        'INVALID_LABEL',
        'OVERLY_LONG',
        'UNSUPPORTED_MATERIAL_CLAIM',
        'UNSUPPORTED_CERTIFICATION_CLAIM',
        'UNSUPPORTED_CARE_CLAIM',
        'UNSUPPORTED_DIMENSION_CLAIM',
        'UNSUPPORTED_SAFETY_CLAIM',
    ].includes(issue.code);
}

export function buildSafeFallbackDescription(facts: NormalizedProductFacts, _snapshot: SourceProductSnapshot): GeneratedDescriptionDraft {
    const detailLines: GeneratedDescriptionDraft['detailLines'] = [];
    const safeFacts = [
        ...facts.designDetails,
        ...facts.colors,
        ...facts.patternOrFinish,
        ...facts.fitOrSilhouette,
        ...facts.functionalDetails,
        ...facts.variants,
        ...facts.roomOrUseCase,
    ].filter(fact => fact.evidenceLevel !== 'inferred_low_confidence');
    for (const factValue of safeFacts.slice(0, 4)) {
        const label = VALID_LABELS.has(factValue.label) ? factValue.label : 'Details';
        detailLines.push({
            label,
            detail: factValue.value,
            supportedByFactIds: [factValue.id],
            riskLevel: factValue.evidenceLevel === 'source_image' ? 'low' : 'medium',
        });
    }
    if (detailLines.length === 0) {
        detailLines.push({
            label: 'Design',
            detail: 'Source imagery or listing data should be reviewed before publishing.',
            supportedByFactIds: [],
            riskLevel: 'low',
        });
    }
    detailLines.push({
        label: 'Details',
        detail: facts.missingImportantFacts.length
            ? `${facts.missingImportantFacts.join(', ')}.`
            : 'Additional source details should be confirmed before publishing.',
        supportedByFactIds: [],
        riskLevel: 'low',
    });
    while (detailLines.length < 3) {
        detailLines.push({
            label: 'Details',
            detail: 'Available source options should be reviewed before publishing.',
            supportedByFactIds: [],
            riskLevel: 'low',
        });
    }

    return {
        openingSentence: `A clean, easy-to-style ${facts.productType.value} with understated detail and a polished Louie Mae feel.`,
        detailLines: detailLines.slice(0, 4),
        seoKeywordsUsed: [],
        avoidedClaims: facts.missingImportantFacts,
        confidence: Math.min(0.55, facts.sourceQuality.score / 100),
        notesForAdmin: facts.missingImportantFacts,
    };
}

export function getFactIds(facts: NormalizedProductFacts): Set<string> {
    return new Set(allFacts(facts).map(factValue => factValue.id));
}
