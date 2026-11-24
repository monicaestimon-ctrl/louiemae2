// Product dimensions in centimetres, read from a listing's facts text, e.g.
// "Overall dimensions (W × D × H): 92.5 × 39 × 26.4 in" or `84" W x 38" D x 33" H`.
export type DimsCm = { w: number; d: number; h: number; seatH?: number; armH?: number };

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const toCm = (n: number, unit: string) => Math.round((/^c/i.test(unit) ? n : n * 2.54) * 10) / 10;
const unitOf = (u: string | undefined) => (u && /^c/i.test(u) ? 'cm' : 'in');

function single(facts: string, label: string) {
  const m = facts.match(new RegExp(`${label}[^0-9]{0,24}${NUM}\\s*(cm|in|"|”|inches)?`, 'i'));
  return m ? toCm(parseFloat(m[1]), unitOf(m[2])) : undefined;
}

export function parseDims(facts: string | null | undefined): DimsCm | null {
  const text = String(facts ?? '').replace(/[″”]/g, '"');
  if (!text) return null;
  let dims: { w: number; d: number; h: number } | null = null;
  // "a × b × c unit", in the order the label gives (W × D × H by default).
  const triple = text.match(new RegExp(`${NUM}\\s*"?\\s*[×xX*]\\s*${NUM}\\s*"?\\s*[×xX*]\\s*${NUM}\\s*(cm|in|inches|")?`));
  // A triple with no unit is ambiguous (cm or inches), so it never counts as a true size.
  const tripleUnit = triple && (triple[4] ?? text.slice(triple.index! + triple[0].length).match(/^\s*(cm|in)/i)?.[1]);
  if (triple && tripleUnit) {
    const order = (text.match(/\(\s*([WDHL])\s*[×xX*]\s*([WDHL])\s*[×xX*]\s*([WDHL])\s*\)/i)?.slice(1) ?? ['W', 'D', 'H']).map((k) =>
      k.toUpperCase() === 'L' ? 'W' : k.toUpperCase()
    );
    const unit = unitOf(tripleUnit);
    const v: Record<string, number> = {};
    order.forEach((k, i) => (v[k] = toCm(parseFloat(triple[i + 1]), unit)));
    if (v.W && v.D && v.H) dims = { w: v.W, d: v.D, h: v.H };
  }
  // `84" W x 38" D x 33" H` — each number tagged with its axis.
  if (!dims) {
    const tagged: Record<string, number> = {};
    for (const m of text.matchAll(new RegExp(`${NUM}\\s*(cm|in|"|inches)?\\s*\\(?\\s*(W|D|H|L|width|depth|height|length)\\b`, 'gi'))) {
      const k = m[3][0].toUpperCase();
      tagged[k === 'L' ? 'W' : k] ??= toCm(parseFloat(m[1]), unitOf(m[2]));
    }
    if (tagged.W && tagged.D && tagged.H) dims = { w: tagged.W, d: tagged.D, h: tagged.H };
  }
  if (!dims || [dims.w, dims.d, dims.h].some((n) => !(n > 0) || n > 2000)) return null;
  const seatH = single(text, 'seat height');
  const armH = single(text, 'arm height');
  return { ...dims, ...(seatH ? { seatH } : {}), ...(armH ? { armH } : {}) };
}
