import { describe, expect, it } from 'vitest';
import { area, centroid, cleanPlanRead, inside, setWallLength, validRoomPolygon, type Pt } from './holmPlan';

const L: Pt[] = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 5], [0, 5]];

describe('floor plan geometry', () => {
  it('measures an L-shaped room', () => {
    expect(area(L)).toBe(24);
  });

  it('knows what is inside an L-shape', () => {
    expect(inside([1, 4], L)).toBe(true);
    expect(inside([5, 4], L)).toBe(false);
  });

  it('finds the centre of a rectangle', () => {
    expect(centroid([[0, 0], [4, 0], [4, 2], [0, 2]])).toEqual([2, 1]);
  });

  it('changes one wall length along its own direction', () => {
    expect(setWallLength(L, 0, 8)[1]).toEqual([8, 0]);
    expect(setWallLength(L, 0, 8)[2]).toEqual([6, 3]);
  });
});

describe('cleanPlanRead', () => {
  it('keeps well-formed rooms and clamps coordinates into the image', () => {
    const r = cleanPlanRead({ rooms: [{ name: 'Bar', points: [[0, 0], [1.4, 0], [1, 1], [0, 1]] }], blocks: [], scale: null });
    expect(r.rooms).toEqual([{ name: 'Bar', points: [[0, 0], [1, 0], [1, 1], [0, 1]] }]);
  });

  it('drops shapes with too few points or no area, and a scale with no length', () => {
    const r = cleanPlanRead({ rooms: [{ points: [[0, 0], [1, 1]] }, { points: [[0, 0], [0.5, 0], [1, 0]] }], scale: { a: [0, 0], b: [1, 0], meters: 0 } });
    expect(r.rooms).toEqual([]);
    expect(r.scale).toBeNull();
  });

  it('drops a shape with any corner that is not two finite numbers', () => {
    const bad = [[[0, 0], [1, 0], [1, null], [0, 1]], [[0, 0], [1, 0], [1, 'x'], [0, 1]], [[0, 0], [1, 0], [1, NaN], [0, 1]]];
    expect(cleanPlanRead({ rooms: bad.map((points) => ({ points })) }).rooms).toEqual([]);
  });

  it('survives anything', () => {
    expect(cleanPlanRead('nonsense')).toEqual({ rooms: [], blocks: [], scale: null });
    expect(cleanPlanRead(null)).toEqual({ rooms: [], blocks: [], scale: null });
  });
});

describe('editable room validation', () => {
  it('keeps rectangles, concave rooms and either winding', () => {
    expect(validRoomPolygon(L)).toBe(true); expect(validRoomPolygon([...L].reverse())).toBe(true);
    expect(validRoomPolygon([[0,0],[4,0],[4,3],[0,3]])).toBe(true);
  });
  it('rejects degenerate, intersecting, repeated and nonfinite corners', () => {
    for (const shape of [[], [[0,0],[1,0],[2,0]], [[0,0],[4,4],[0,4],[3,0]],
      [[0,0],[4,0],[4,0],[4,4],[0,4]], [[0,0],[4,0],[4,4],[0,0],[0,4]],
      [[0,0],[Infinity,0],[4,4]], [[0,0],[NaN,0],[4,4]], [[0,0],[4,null],[4,4]]]) expect(validRoomPolygon(shape)).toBe(false);
  });
  it('bounds geometry complexity and drops crossing AI shapes', () => {
    const many=Array.from({length:65},(_,i)=>[Math.cos(i/65*2*Math.PI),Math.sin(i/65*2*Math.PI)]);
    expect(validRoomPolygon(many)).toBe(false);
    expect(cleanPlanRead({rooms:[{points:[[0,0],[1,1],[0,1],[.8,0]]}]}).rooms).toEqual([]);
  });
});
