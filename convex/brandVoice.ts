export const SMART_DESCRIPTION_PROMPT_VERSION = 'smart-description-v2.3.0';
export const BRAND_VOICE_VERSION = 'louie-mae-v1.3.0';

export const LOUIE_MAE_HOME_VOICE_REFERENCE = 'An antique-inspired clay table lamp with a rounded vessel base and wabi-sabi character. Its earthy texture gives bedside tables and consoles a quiet, collected feel.';

export type BrandVoiceConfig = {
    brandName: 'Louie Mae';
    voicePrinciples: string[];
    bannedPhrases: string[];
    bannedClaimsWithoutEvidence: string[];
    collectionVocabulary: Record<string, {
        preferredWords: string[];
        avoidWords: string[];
        toneNotes: string[];
    }>;
    descriptionFormat: {
        openingSentenceMinWords: number;
        openingSentenceMaxWords: number;
        minDetailLines: number;
        maxDetailLines: number;
        separator: ' · ';
    };
};

export const LOUIE_MAE_BRAND_VOICE: BrandVoiceConfig = {
    brandName: 'Louie Mae',
    voicePrinciples: [
        'Warm but polished',
        'Specific, not generic',
        'Boutique and elevated without sounding expensive for no reason',
        'Clean and readable for ecommerce',
        'Grounded in actual product details',
        'Soft, intentional, curated, and modern',
        'Connect supported shape, texture, and detail to an evocative styling suggestion or sense of place.',
        'Sparse evidence deserves one beautiful, specific sentence, not padded specifications.',
        'Preserve rich labeled descriptions when there are meaningful details: Material, Design, Texture, Function, Fit, or Details should each carry specific, expressive copy.',
        'Choose full, compact, or short descriptions by the depth of verified information, not by product category. The short lamp reference defines the voice, not a mandatory length.',
        'For home pieces, favor two connected sentences: first the object, its form and aesthetic character; then how its texture or silhouette makes a space feel.',
        'Prefer descriptive atmosphere over styling commands: "Its earthy texture gives ... a quiet, collected feel" rather than repeatedly telling shoppers "Style it" or "Pair it".',
        'Keep precise supported language such as rounded vessel base and earthy texture instead of flattening it into rounded base and textural finish.',
    ],
    bannedPhrases: [
        'high quality',
        'premium quality',
        'must-have',
        'perfect for any occasion',
        'elevate your style',
        'add a touch of elegance',
        'crafted to perfection',
        'beautiful design',
        'stylish and comfortable',
        'unique and fashionable',
        'made with love',
        'boutique favorite',
        'timeless elegance',
        'designed with comfort and style in mind',
    ],
    bannedClaimsWithoutEvidence: [
        'organic',
        'OEKO-TEX',
        'GOTS',
        'FSC-certified',
        'non-toxic',
        'hypoallergenic',
        'sustainably sourced',
        'handmade',
        'handcrafted',
        'handwoven',
        'solid oak',
        'solid wood',
        'machine washable',
        'waterproof',
        'food safe',
        'child safe',
        'baby-safe',
        'BPA-free',
        'flame-retardant',
    ],
    collectionVocabulary: {
        kids: {
            preferredWords: ['soft', 'sweet', 'gentle', 'easygoing', 'play-ready', 'cozy', 'everyday'],
            avoidWords: ['sexy', 'sultry', 'luxurious', 'seductive'],
            toneNotes: [
                'Parent-friendly and tender, but not baby-talk.',
                'Do not make safety claims unless proven.',
            ],
        },
        fashion: {
            preferredWords: ['effortless', 'softly structured', 'flowing', 'refined', 'easy', 'romantic', 'polished'],
            avoidWords: ['sexy', 'cheap', 'viral', 'dupe'],
            toneNotes: [
                'Modern boutique fashion voice.',
                'Mention fit or silhouette only when source or images support it.',
            ],
        },
        furniture: {
            preferredWords: ['grounded', 'earthy texture', 'warm', 'sculptural', 'considered', 'antique-inspired', 'quiet, collected feel'],
            avoidWords: ['cheap', 'indestructible', 'heirloom-quality'],
            toneNotes: [
                'Interior-design language, calm and elevated.',
                'Do not claim solid wood or artisan construction unless proven.',
            ],
        },
        decor: {
            preferredWords: ['antique-inspired', 'rounded vessel base', 'wabi-sabi character', 'earthy texture', 'organic shape', 'quiet', 'collected'],
            avoidWords: ['random', 'mass-produced', 'luxury'],
            toneNotes: [
                'Home styling language.',
                'Antique-inspired and wabi-sabi describe a supported aesthetic, not verified age, origin, or handmade construction. Use them selectively, not for every product.',
                'Use organic only for shape or texture, not material certification, unless proven.',
            ],
        },
        home: {
            preferredWords: ['antique-inspired', 'earthy texture', 'warm', 'considered', 'grounded', 'quiet, collected feel'],
            avoidWords: ['random', 'mass-produced', 'luxury'],
            toneNotes: ['Home styling language with practical clarity.'],
        },
        other: {
            preferredWords: ['clean', 'easy', 'polished', 'quietly detailed'],
            avoidWords: ['viral', 'cheap', 'luxury'],
            toneNotes: ['Conservative copy when source data is weak.'],
        },
    },
    descriptionFormat: {
        openingSentenceMinWords: 12,
        openingSentenceMaxWords: 60,
        minDetailLines: 0,
        maxDetailLines: 6,
        separator: ' · ',
    },
};
