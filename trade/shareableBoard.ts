type Board = { bg?: { img?: string; color?: string; grid?: boolean }; els: { src?: unknown }[] };
const localPhoto = (value: unknown) => typeof value === 'string' && /^(data:|blob:)/i.test(value);
/** Use this same filtered document for hosted layout and cover; local downloads keep the original. */
export function shareableBoard<T extends Board>(doc: T): T {
  return { ...doc, bg: localPhoto(doc.bg?.img) ? { color: '#EFE6D8', grid: doc.bg?.grid } : doc.bg,
    els: doc.els.filter(element => !localPhoto(element.src)) };
}
