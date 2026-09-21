import type { GeneratedDescriptionDraft, NormalizedProductFacts } from './smartDescription';
import { planProductDescription } from './productDescriptionPlan';

/** Offline copy uses curated phrases, never raw supplier fragments or invented specifications. */
export function buildEditorialFallback(facts: NormalizedProductFacts): GeneratedDescriptionDraft {
    const plan = planProductDescription(facts);
    const type = facts.productType.value;
    const home = ['home', 'decor', 'furniture'].includes(facts.collection.value)
        || /lamp|light|table|chair|vase|rug|basket|mirror|cabinet|console|sofa|stool|pillow/.test(type);
    const available = [...facts.designDetails, ...facts.patternOrFinish, ...facts.fitOrSilhouette]
        .filter(f => f.confidence >= .7 && f.evidenceLevel !== 'inferred_low_confidence' && !/\b(?:not|no|without)\b/i.test(f.value));
    const phrases: Array<[RegExp, string, string, string]> = [
        [/\b(?:rounded|round) vessel base\b/i, 'a rounded vessel base', 'Design', 'A rounded vessel base gives the silhouette a quiet, sculptural presence.'],
        [/\b(?:rounded|round) (?:vessel |urn )?base\b/i, 'a rounded base', 'Design', 'A rounded base gives the silhouette a quiet, sculptural presence.'],
        [/\b(?:urn|vessel)[- ](?:shaped |style )?base\b/i, 'a vessel-shaped base', 'Design', 'The vessel-shaped base brings a sculptural note to a collected interior.'],
        [/\bearthy texture\b/i, 'earthy texture', 'Texture', 'Earthy texture gives the surface a quiet depth and a collected feel.'],
        [/\b(?:earthy|textured|rough|mottled)\b/i, 'a textural finish', 'Texture', 'The surface texture adds depth to the silhouette.'],
        [/\bwoven (?:visual )?texture\b/i, 'woven visual texture', 'Texture', 'Woven visual texture brings a softly layered look to the design.'],
        [/\b(?:curved|rounded)\b/i, 'softly curved lines', 'Design', 'Softly curved lines bring a gentle rhythm to the silhouette.'],
        [/\b(?:ruffle|ruffled|ruffles)\b/i, 'ruffle detailing', 'Design', 'Ruffle detailing gives the silhouette a softly romantic finish.'],
        [/\bfloral\b/i, 'a floral pattern', 'Design', 'A floral pattern lends an expressive note to simple styling.'],
        [/\bscalloped\b/i, 'scalloped detailing', 'Design', 'Scalloped edges add a quietly decorative finish.'],
        [/\bribbed\b/i, 'ribbed texture', 'Texture', 'Ribbed texture adds visual depth without overwhelming the silhouette.'],
        [/\bpleated\b/i, 'pleated detailing', 'Design', 'Pleated detailing adds a considered rhythm to the design.'],
        [/\bstriped\b/i, 'a striped pattern', 'Design', 'A striped pattern adds definition to an understated pairing.'],
        [/\bmatte\b/i, 'a matte finish', 'Finish', 'The matte finish offers a restrained counterpoint to glossy accents.'],
    ];
    const selected: Array<{ phrase: string; label: string; detail: string; id: string }> = [];
    for (const [pattern, phrase, label, detail] of phrases) {
        const evidence = available.find(f => pattern.test(f.value));
        if (!evidence || selected.some(item => item.label === label)) continue;
        selected.push({ phrase, label, detail, id: evidence.id });
        if (selected.length === 4) break;
    }
    const material = facts.materials.find(f => f.confidence >= .7
        && ['source_structured', 'source_text', 'source_title', 'admin_input'].includes(f.evidenceLevel)
        && /^(?:ceramic|clay|cotton|linen|silk|wool|rattan|oak|walnut|marble|brass|leather|bamboo|wood|metal|glass|jute|wicker|velvet|polyester|denim)$/i.test(f.value));
    const antiqueInspired = home && available.some(f => /\bantique[- ]inspired\b/i.test(f.value));
    const wabiSabi = home && available.some(f => /\bwabi[- ]sabi\b/i.test(f.value));
    const noun = [antiqueInspired ? 'antique-inspired' : undefined, material?.value.toLowerCase(), type === 'set' ? 'set' : type].filter(Boolean).join(' ');
    const article = /^[aeiou]/i.test(noun) ? 'An' : 'A';
    const styling = home
        ? /lamp|light/.test(type) ? 'Style it beside a favorite reading chair for a quiet, collected corner.' : 'Pair it with contrasting textures for a room that feels considered and collected.'
        : 'Pair it with understated favorites for a thoughtful everyday look.';
    const earthyLamp = ['table lamp', 'desk lamp'].includes(type) && selected.some(item => item.phrase === 'earthy texture');
    const openingPhrases = selected.filter(item => !earthyLamp || item.phrase !== 'earthy texture').slice(0, 2).map(item => item.phrase);
    if (wabiSabi) openingPhrases.push('wabi-sabi character');
    const atmosphere = earthyLamp ? 'Its earthy texture gives bedside tables and consoles a quiet, collected feel.' : styling;
    const opening = openingPhrases.length
        ? `${article} ${noun} with ${openingPhrases.join(' and ')}. ${atmosphere}`
        : `Make this ${noun} part of a ${home ? 'considered interior' : 'thoughtfully composed wardrobe'}. ${atmosphere}`;
    const detailLines: GeneratedDescriptionDraft['detailLines'] = selected.map(item => ({ label: item.label, detail: item.detail, supportedByFactIds: [item.id], riskLevel: 'low' }));
    if (material && plan.mode !== 'short') detailLines.unshift({ label: 'Material', detail: `Made from ${material.value.toLowerCase()}, the ${type} offers a considered starting point for ${home ? 'layered interiors' : 'everyday styling'}.`, supportedByFactIds: [material.id], riskLevel: 'low' });
    return {
        openingSentence: opening,
        // Offline templates may use fewer lines than the target, but never pad to reach it.
        detailLines: plan.mode === 'short' ? [] : detailLines.slice(0, plan.preferredDetailLines.max),
        seoKeywordsUsed: [], avoidedClaims: facts.missingImportantFacts,
        confidence: Math.min(.65, facts.productType.confidence), notesForAdmin: facts.missingImportantFacts,
    };
}
