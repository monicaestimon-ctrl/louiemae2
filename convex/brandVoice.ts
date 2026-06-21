export const SMART_DESCRIPTION_PROMPT_VERSION = 'smart-description-v2.0.0';
export const BRAND_VOICE_VERSION = 'louie-mae-v1.0.0';

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
            preferredWords: ['grounded', 'textured', 'warm', 'clean-lined', 'sculptural', 'natural', 'considered'],
            avoidWords: ['cheap', 'indestructible', 'heirloom-quality'],
            toneNotes: [
                'Interior-design language, calm and elevated.',
                'Do not claim solid wood or artisan construction unless proven.',
            ],
        },
        decor: {
            preferredWords: ['curated', 'textural', 'organic shape', 'soft', 'quietly detailed', 'warm', 'collected'],
            avoidWords: ['random', 'mass-produced', 'luxury'],
            toneNotes: [
                'Home styling language.',
                'Use organic only for shape or texture, not material certification, unless proven.',
            ],
        },
        home: {
            preferredWords: ['curated', 'textural', 'warm', 'considered', 'grounded'],
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
        openingSentenceMaxWords: 28,
        minDetailLines: 3,
        maxDetailLines: 6,
        separator: ' · ',
    },
};
