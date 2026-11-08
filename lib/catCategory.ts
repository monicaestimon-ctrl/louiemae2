// Explicit commission categories (spec S08, v2 §5). Navigation can be more detailed; each nav
// category maps deliberately to one commission category. All lighting is décor. Anything not
// confidently mapped is review_required, which blocks referral eligibility.

export type CommissionCategory = 'furniture' | 'decor' | 'clothing' | 'review_required';

const LIGHTING = /\b(light(?:ing)?|lamps?|pendants?|chandeliers?|sconces?|lanterns?|flush ?mounts?)\b/;
const FURNITURE = /\b(furniture|sofas?|sectionals?|loveseats?|chairs?|tables?|desks?|dressers?|cabinets?|sideboards?|credenzas?|consoles?|beds?|headboards?|benches?|stools?|barstools?|counterstools?|ottomans?|nightstands?|bookcases?|shelv(?:es|ing)|buffets?|armoires?|daybeds?|chaises?)\b/;
const CLOTHING = /\b(fashion|kids|cloth(?:es|ing)?|apparel|wear|dress(?:es)?|outfits?|rompers?|tops?|bottoms?|leggings?|footwear|shoes?)\b/;
const DECOR = /\b(d[eé]cor|vases?|candles?|pillows?|throws?|rugs?|art|wall art|mirrors?|baskets?|tabletop|frames?|planters?|bowls?|sculptures?|objects?|clocks?|trays?)\b/;

/**
 * Proposed commission category for a navigation category or product text. Lighting is checked
 * first so a "table lamp" is décor, not furniture. Returns review_required when nothing matches
 * or when furniture and clothing both match.
 */
export function proposeCategory(text: string): { category: CommissionCategory; reason: string } {
  const t = ` ${text.toLowerCase()} `;
  if (LIGHTING.test(t)) return { category: 'decor', reason: 'lighting is décor' };
  const furniture = FURNITURE.test(t);
  const clothing = CLOTHING.test(t);
  if (furniture && clothing) return { category: 'review_required', reason: 'matches furniture and clothing' };
  if (furniture) return { category: 'furniture', reason: 'furniture term' };
  if (clothing) return { category: 'clothing', reason: 'clothing term' };
  if (DECOR.test(t)) return { category: 'decor', reason: 'décor term' };
  return { category: 'review_required', reason: 'no confident match' };
}

/** The legacy product type for the same text (lib/holmPartners productTypeFor puts lighting in furniture). */
export const isLighting = (text: string) => LIGHTING.test(` ${text.toLowerCase()} `);

export const referralEligibleCategory = (c: CommissionCategory): c is Exclude<CommissionCategory, 'review_required'> => c !== 'review_required';
