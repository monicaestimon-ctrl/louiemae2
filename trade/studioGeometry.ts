import type { HolmProduct } from './catalog';
import { displayProduct } from './catalogLookup';
import { resolveProjectProduct, type SavedProductIdentity, type SavedProductMap } from './projectIdentity';

export type StudioPiece = {
  kind: string; pid?: number; lid?: string; vid?: string; shape?: string; style?: string; room?: boolean;
  ar?: number; w: number;
};
export type StudioBackground = { img?: string | null; widthM?: number };
export const studioStyle = (piece: Pick<StudioPiece, 'style' | 'room'>) => piece.style || (piece.room ? 'room' : 'framed');
export const frameAspect = (shape: string | undefined, aspect: number) =>
  shape === 'circle' ? 1 : shape === 'arch' || shape === 'oval' ? .8 : shape === 'pill' ? .75 : aspect;

/** Scope image and measurement geometry to the same verified catalog as its editor/export. */
export function studioGeometry(products: SavedProductMap) {
  const product = (reference: number | SavedProductIdentity): HolmProduct => {
    const identity = typeof reference === 'number' ? { pid: reference } : reference;
    return resolveProjectProduct(identity, products) ?? displayProduct(new Map(), identity.pid);
  };
  const selection = (piece: StudioPiece) => ({ pid: piece.pid ?? 0, lid: piece.lid, vid: piece.vid });
  const hasCutout = (reference: number | SavedProductIdentity) => !!product(reference).cutout;
  const cutoutAspect = (reference: number | SavedProductIdentity) => product(reference).cutAR || product(reference).ar || 1;
  const elementAspect = (piece: StudioPiece) => piece.kind === 'inspo'
    ? frameAspect(piece.shape, piece.ar || 1)
    : studioStyle(piece) === 'framed' ? frameAspect(piece.shape, product(selection(piece)).ar || 1)
      : cutoutAspect(selection(piece));
  const lockedWidth = (piece: StudioPiece, background?: StudioBackground | null) => {
    const widthM = background?.widthM;
    if (piece.kind !== 'img' || studioStyle(piece) !== 'room' || !background?.img || !widthM || widthM <= 0) return null;
    const cm = product(selection(piece)).dimsCm?.w;
    return cm ? cm / widthM : null;
  };
  const width = (piece: StudioPiece, background?: StudioBackground | null) => lockedWidth(piece, background) ?? piece.w;
  return { product, hasCutout, cutoutAspect, elementAspect, lockedWidth, width };
}
