import type { HolmProduct } from './catalog';
import { projectItemKey, resolveProjectProduct, type SavedProductIdentity } from './projectIdentity';
import { useProjectCatalog } from './useProjectCatalog';

type Board = { pins: SavedProductIdentity[] };
type Collage = { els: { kind: string; pid?: number; lid?: string; vid?: string }[] };

/** Saved covers and pins resolve independently without changing the browse catalog. */
export function useSavedBoardShelf(boards: readonly Board[], collages: readonly Collage[], catalog: ReadonlyMap<number, HolmProduct>) {
  const references: SavedProductIdentity[] = [...boards.flatMap(board => board.pins),
    ...collages.flatMap(collage => collage.els.flatMap(element =>
      element.kind === 'img' && element.pid !== undefined
        ? [{ pid: element.pid, lid: element.lid, vid: element.vid }] : []))];
  const savedCatalog = useProjectCatalog(references, catalog);
  const productFor = (identity: SavedProductIdentity) => resolveProjectProduct(identity, savedCatalog.products);
  const seen = new Set<string>();
  const allPins = boards.flatMap(board => board.pins).flatMap(pin => {
    const key = projectItemKey(pin);
    if (seen.has(key)) return [];
    seen.add(key);
    const product = productFor(pin);
    return product ? [product] : [];
  });
  return { ...savedCatalog, productFor, allPins,
    reviewCount: references.filter(identity => !productFor(identity)).length };
}
