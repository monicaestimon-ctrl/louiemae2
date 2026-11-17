import type { HolmProduct } from './catalog';
import { displayProduct } from './catalogLookup';

export type StudioPiece = {
  kind: string; pid?: number; shape?: string; style?: string; room?: boolean;
  ar?: number; w: number;
};
export type StudioBackground = { img?: string | null; widthM?: number };
export const studioStyle = (piece: Pick<StudioPiece, 'style' | 'room'>) => piece.style || (piece.room ? 'room' : 'framed');
export const frameAspect = (shape: string | undefined, aspect: number) =>
  shape === 'circle' ? 1 : shape === 'arch' || shape === 'oval' ? .8 : shape === 'pill' ? .75 : aspect;

/** Scope image and measurement geometry to the same verified catalog as its editor/export. */
export function studioGeometry(products: ReadonlyMap<number, HolmProduct>) {
  const product = (id: number) => displayProduct(products, id);
  const hasCutout = (id: number) => products.has(id) && !!product(id).cutout;
  const cutoutAspect = (id: number) => product(id).cutAR || product(id).ar || 1;
  const elementAspect = (piece: StudioPiece) => piece.kind === 'inspo'
    ? frameAspect(piece.shape, piece.ar || 1)
    : studioStyle(piece) === 'framed' ? frameAspect(piece.shape, product(piece.pid ?? 0).ar || 1)
      : cutoutAspect(piece.pid ?? 0);
  const lockedWidth = (piece: StudioPiece, background?: StudioBackground | null) => {
    const widthM = background?.widthM;
    if (piece.kind !== 'img' || studioStyle(piece) !== 'room' || !background?.img || !widthM || widthM <= 0) return null;
    const cm = product(piece.pid ?? 0).dimsCm?.w;
    return cm ? cm / widthM : null;
  };
  const width = (piece: StudioPiece, background?: StudioBackground | null) => lockedWidth(piece, background) ?? piece.w;
  return { hasCutout, cutoutAspect, elementAspect, lockedWidth, width };
}
