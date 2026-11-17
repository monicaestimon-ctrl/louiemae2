import { expect, it } from 'vitest';
import type { HolmProduct } from './catalog';
import { frameAspect, studioGeometry, studioStyle } from './studioGeometry';

const item = (width: number, ar: number) => ({ id: 7, ar, cutAR: ar / 2, cutout: '/cutout.png', dimsCm: { w: width, d: 50, h: 80 } }) as HolmProduct;
it('keeps independent editor catalog dimensions isolated and reads current measurements', () => {
  const products = new Map([[7, item(120, 2)]]);
  const first = studioGeometry(products), second = studioGeometry(new Map([[7, item(240, 4)]]));
  const piece = { kind: 'img', pid: 7, style: 'room', w: 15 };
  const background = { img: '/room.jpg', widthM: 6 };
  expect(first.width(piece, background)).toBe(20);
  expect(second.width(piece, background)).toBe(40);
  products.set(7, item(180, 3));
  expect(first.width(piece, background)).toBe(30);
  expect(first.elementAspect(piece)).toBe(1.5);
});
it('preserves manual sizing when room scale or catalog dimensions are unavailable', () => {
  const geometry = studioGeometry(new Map());
  const piece = { kind: 'img', pid: 99, style: 'room', w: 17 };
  expect(geometry.hasCutout(99)).toBe(false);
  expect(geometry.width(piece, { img: '/room.jpg', widthM: 0 })).toBe(17);
  expect(geometry.width(piece, { img: '/room.jpg', widthM: 4 })).toBe(17);
  expect(geometry.width(piece, null)).toBe(17);
});
it('uses uploaded-photo and framed shapes independently of product cutout aspect', () => {
  const geometry = studioGeometry(new Map([[7, item(120, 2)]]));
  expect(geometry.elementAspect({ kind: 'inspo', shape: 'oval', ar: 3, w: 20 })).toBe(.8);
  expect(geometry.elementAspect({ kind: 'img', pid: 7, style: 'framed', w: 20 })).toBe(2);
  expect(geometry.elementAspect({ kind: 'img', pid: 7, style: 'cutout', w: 20 })).toBe(1);
  expect(frameAspect('circle', 3)).toBe(1);
  expect(studioStyle({ room: true })).toBe('room');
});

it('uses the selected option image and clears assets that belong to the default option', () => {
  const base = { ...item(120, 2), lid: 'source', vid: 'default', imgs: ['/default.jpg'], imageMedia: { sourceUrl: '/default.jpg' }, model: '/default.glb', modelLow: '/default-low.glb', variants: [{ id: 'alternate', name: 'Alternate', image: '/alternate.jpg', retail: 10000, trade: null, minimum: 1, increment: 1 }] } as unknown as HolmProduct;
  const geometry = studioGeometry(new Map([[7, base]]));
  const piece = { kind: 'img', pid: 7, lid: 'source', vid: 'alternate', w: 20 };
  expect(geometry.product(piece)).toMatchObject({ img: '/alternate.jpg', imgs: ['/alternate.jpg'], cutout: null, cutAR: null, model: null, modelLow: null });
  expect(geometry.product(piece).imageMedia).toBeUndefined();
  expect(geometry.hasCutout(piece)).toBe(false);
  expect(geometry.elementAspect(piece)).toBe(1);
  expect(geometry.product({ ...piece, vid: 'withdrawn' }).lid).toBe('');
});
