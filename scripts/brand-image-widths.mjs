const DEFAULT_WIDTHS = [480, 640, 800, 960, 1600];
/** This portrait's 200px mobile card needs 350 source pixels at DPR 1.75, not 480. */
export function brandImageWidths(source, width) {
  if (!Number.isSafeInteger(width) || width < 1) throw new Error('Invalid image width');
  const candidates =
    source === '/images/brand/girls-dress.png' ? [360, ...DEFAULT_WIDTHS] : DEFAULT_WIDTHS;
  return [...new Set(candidates.filter((value) => value < width).concat(Math.min(width, 1600)))];
}
