import type { FactValue, NormalizedProductFacts } from './smartDescription';

/** Editorial depth follows distinct evidence, never the product category or SKU count. */
export function planProductDescription(facts: NormalizedProductFacts) {
    const groups: Array<[string, FactValue[]]> = [
        ['Material', facts.materials], ['Finish', facts.patternOrFinish],
        ['Design', facts.designDetails], ['Fit', facts.fitOrSilhouette],
        ['Function', facts.functionalDetails], ['Dimensions', facts.dimensions],
        ['Care', facts.careInstructions], ['Palette', facts.colors],
    ];
    const seen = new Set<string>();
    const topics: Array<{ label: string; factIds: string[] }> = [];
    for (const [label, values] of groups) {
        const factIds: string[] = [];
        for (const fact of values) {
            const key = fact.value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (fact.confidence < .7 || fact.evidenceLevel === 'inferred_low_confidence' || seen.has(key)
                || !key || key === facts.productType.value || /^(unknown|n a|not confirmed)$/.test(key)) continue;
            if (['Material', 'Dimensions', 'Care'].includes(label) && fact.evidenceLevel === 'source_image') continue;
            seen.add(key);
            factIds.push(fact.id);
        }
        if (factIds.length) topics.push({ label, factIds });
    }
    const mode = seen.size >= 5 && topics.length >= 3 ? 'full' : seen.size >= 3 ? 'compact' : 'short';
    return {
        mode,
        preferredDetailLines: mode === 'full' ? { min: 3, max: 6 } : mode === 'compact' ? { min: 1, max: 3 } : { min: 0, max: 1 },
        topics,
        instruction: mode === 'full'
            ? 'Keep the rich labeled editorial breakdown: a brief evocative introduction, then 3–6 meaningful lines. Each line connects a supported detail to character, appearance, use, or feel.'
            : mode === 'compact'
                ? 'Use an evocative introduction and 1–3 labeled details that add something distinct. Do not repeat the opening just to fill a list.'
                : 'Let one or two beautiful, specific sentences carry the description. Add at most one labeled detail only if it contributes new information.',
    };
}
