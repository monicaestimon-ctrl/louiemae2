import { expect, it } from 'vitest';
import { plannerGeometry, clampRug, footprintCovered, type PlannerLayout, type PlannerPiece } from './plannerGeometry';
import type { HolmProduct } from './catalog';

const product = (width: number) => ({ id: 1, lid: 'source', dimsCm: { w: width, d: 100, h: 80 } } as HolmProduct);
const item = (uid: string, x = 0): PlannerPiece => ({ uid, pid: 1, x, z: 0, rot: 0 });
it('keeps independently resolved catalogs isolated and reads current measurements', () => {
  const browse = new Map([[1, product(100)]]), project = new Map([[1, product(200)]]);
  const a = plannerGeometry(browse), b = plannerGeometry(project);
  expect(a.dimensions(1).w).toBe(1); expect(b.dimensions(1).w).toBe(2);
  project.set(1, product(300));
  expect(b.extents({ ...item('a'), rot: 90 })[1]).toBeCloseTo(1.5);
  expect(a.widthCm(1)).toBe(100);
  expect(a.ready(999)).toBe(false);
  project.delete(1); expect(b.ready(1)).toBe(false); expect(a.ready(1)).toBe(true);
});
it('separates colliding pieces without mutating saved source identities or layout', () => {
  const geometry = plannerGeometry(new Map([[1, product(100)]]));
  const doc = { W: 8, D: 6, title: 'Saved room', items: [{ ...item('a'), lid: 'source', vid: 'first' }, { ...item('b'), lid: 'source', vid: 'second' }] };
  const before = globalThis.structuredClone(doc);
  const result = geometry.reflow(doc);
  expect(doc).toEqual(before);
  expect(result.title).toBe('Saved room');
  expect(result.items.map(piece => piece.vid)).toEqual(['first', 'second']);
  for (const piece of result.items) expect(geometry.collides(result, piece, piece.x, piece.z)).toBe(false);
  const [x, z] = geometry.clamp(doc, item('new'), 20, -20);
  expect([x, z]).toEqual([3.5, -2.5]);
});
it('honors floor-plan exclusions while hanging objects do not collide with floor pieces', () => {
  const geometry = plannerGeometry(new Map([[1, product(100)]]));
  const doc: PlannerLayout = { W: 8, D: 6, items: [item('a')], zones: [{ poly: [[-4, -3], [4, -3], [4, 3], [-4, 3]] }], blocks: [{ x: 2, z: 0, w: 1, d: 1 }] };
  expect(geometry.collides(doc, item('b'), 2, 0)).toBe(true);
  expect(geometry.collides(doc, item('b'), 5, 0)).toBe(true);
  expect(geometry.collides(doc, { ...item('b'), hang: true }, 0, 0)).toBe(false);
  expect(clampRug(doc, { uid: 'rug', x: 0, z: 0, w: 2, d: 4, rot: 90 }, 20, -20)).toEqual([2, -2]);
});

it('rejects concave notches and union holes but permits adjacent zones covering the footprint', () => {
  const notch: PlannerLayout['zones'] = [{poly:[[-2,-2],[2,-2],[2,2],[.6,2],[.6,0],[.4,0],[.4,2],[-2,2]]}];
  expect(footprintCovered(notch,-1,1,-1,1)).toBe(false);
  const rectangle=(left:number,right:number,bottom:number,top:number)=>({poly:[[left,bottom],[right,bottom],[right,top],[left,top]] as [number,number][]});
  expect(footprintCovered([rectangle(-1,0,-1,1),rectangle(0,1,-1,1)],-1,1,-1,1)).toBe(true);
  expect(footprintCovered([rectangle(-1,1,-1,-.2),rectangle(-1,1,.2,1),rectangle(-1,-.2,-1,1),rectangle(.2,1,-1,1)],-1,1,-1,1)).toBe(false);
});
it('honors blocks without zones and reports impossible placement while retaining saved pieces', () => {
  const geometry=plannerGeometry(new Map([[1,product(100)]]));
  expect(geometry.collides({W:4,D:4,items:[],blocks:[{x:0,z:0,w:1,d:1}]},item('a'),0,0)).toBe(true);
  const doc={W:1,D:1,items:[item('a'),item('b')]};
  expect(geometry.place(doc,item('new'),0,0)).toBeNull();
  const result=geometry.reflow(doc);
  expect(result.items.map(i=>i.uid)).toEqual(['a','b']);
  expect(result.placementConflicts).toEqual(['b']);
  expect(geometry.place({W:.5,D:.5,items:[]},item('new'),0,0)).toBeNull();
});
