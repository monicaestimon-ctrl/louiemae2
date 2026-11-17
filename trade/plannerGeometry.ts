import { type Pt } from '../lib/holmPlan';
import { studioGeometry } from './studioGeometry';
import type { SavedProductIdentity, SavedProductMap } from './projectIdentity';

export type PlannerPiece = { uid: string; pid: number; lid?: string; vid?: string; x: number; z: number; rot?: number; hang?: boolean };
export type PlannerRug = { uid: string; x: number; z: number; w: number; d: number; rot?: number; round?: boolean };
export type PlannerLayout = {
  W: number; D: number; items: PlannerPiece[]; placementConflicts?: string[]; rugs?: PlannerRug[];
  zones?: { poly: Pt[] }[]; blocks?: { x: number; z: number; w: number; d: number }[];
};
const GAP = .02, SNAP = .12;
const round = (value: number) => Math.round(value * 100) / 100;

export function rugExtents(rug: PlannerRug): Pt {
  if (rug.round) return [rug.w / 2, rug.w / 2];
  const angle = (rug.rot || 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  return [c * rug.w / 2 + s * rug.d / 2, s * rug.w / 2 + c * rug.d / 2];
}
export function clampRug(doc: Pick<PlannerLayout, 'W' | 'D'>, rug: PlannerRug, x: number, z: number): Pt {
  const [ex, ez] = rugExtents(rug);
  const lx = Math.max(0, doc.W / 2 - ex), lz = Math.max(0, doc.D / 2 - ez);
  return [round(Math.max(-lx, Math.min(lx, x))), round(Math.max(-lz, Math.min(lz, z)))];
}

/** Sweep every edge-order/boundary event so concave notches and union holes cannot hide between samples. */
export function footprintCovered(zones: { poly: Pt[] }[], left: number, right: number, bottom: number, top: number) {
  const edges = zones.flatMap(zone => zone.poly.map((a, i) => [a, zone.poly[(i + 1) % zone.poly.length]] as [Pt, Pt]));
  const cuts = [left, right];
  const add = (x: number) => { if (x > left && x < right) cuts.push(x); };
  for (const [a, b] of edges) {
    add(a[0]);
    for (const y of [bottom, top]) if ((a[1] < y && b[1] > y) || (b[1] < y && a[1] > y)) add(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
  }
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i], [c, d] = edges[j];
    const dx = b[0] - a[0], dy = b[1] - a[1], ex = d[0] - c[0], ey = d[1] - c[1];
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-12) continue;
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / det;
    const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / det;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) add(a[0] + t * dx);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-10) continue;
    const x = (cuts[i] + cuts[i - 1]) / 2;
    const spans: Pt[] = [];
    for (const zone of zones) {
      const ys: number[] = [];
      for (let j = 0; j < zone.poly.length; j++) {
        const a = zone.poly[j], b = zone.poly[(j + 1) % zone.poly.length];
        if ((a[0] < x && b[0] > x) || (b[0] < x && a[0] > x)) ys.push(a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]));
      }
      ys.sort((a, b) => a - b);
      for (let j = 0; j + 1 < ys.length; j += 2) spans.push([ys[j], ys[j + 1]]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let covered = bottom;
    for (const [lo, hi] of spans) {
      if (hi < covered) continue;
      if (lo > covered + 1e-9) break;
      covered = Math.max(covered, hi);
    }
    if (covered < top - 1e-9) return false;
  }
  return true;
}

/** Each planner/export can own its verified product map without changing browse results. */
export function plannerGeometry(products: SavedProductMap) {
  const product = studioGeometry(products).product;
  const widthCm = (reference: number | SavedProductIdentity) => product(reference).dimsCm?.w;
  const ready = (reference: number | SavedProductIdentity) => !!product(reference).dimsCm;
  const dimensions = (reference: number | SavedProductIdentity) => {
    const p = product(reference);
    // Preserve the existing renderer's placeholder size. `ready` still prevents placement
    // without measurements; callers must review unresolved saved items before rendering.
    const dims = p.dimsCm || { w: 100, d: 100, h: 80 };
    return { p, w: dims.w / 100, d: dims.d / 100, hp: dims.h / 100, hb: dims.h / 100 };
  };
  const extents = (item: PlannerPiece): Pt => {
    const { w, d } = dimensions(item);
    const angle = (item.rot || 0) * Math.PI / 180;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    return [c * w / 2 + s * d / 2, s * w / 2 + c * d / 2];
  };
  const clamp = (doc: PlannerLayout, item: PlannerPiece, x: number, z: number): Pt => {
    const [ex, ez] = extents(item);
    const lx = doc.W / 2 - ex, lz = doc.D / 2 - ez;
    x = Math.max(-lx, Math.min(lx, x)); z = Math.max(-lz, Math.min(lz, z));
    if (lx - Math.abs(x) < SNAP) x = (x < 0 ? -1 : 1) * lx;
    if (z < 0 && lz + z < SNAP) z = -lz;
    return [x, z];
  };
  const outsidePlan = (doc: PlannerLayout, x: number, z: number, ex: number, ez: number) => {
    return x - ex < -doc.W / 2 - 1e-9 || x + ex > doc.W / 2 + 1e-9 || z - ez < -doc.D / 2 - 1e-9 || z + ez > doc.D / 2 + 1e-9
      || (!!doc.zones?.length && !footprintCovered(doc.zones, x - ex, x + ex, z - ez, z + ez))
      || (doc.blocks || []).some(block => Math.abs(block.x - x) < block.w / 2 + ex + GAP && Math.abs(block.z - z) < block.d / 2 + ez + GAP);
  };
  const collides = (doc: PlannerLayout, item: PlannerPiece, x: number, z: number) => {
    if (item.hang) return false;
    const [ex, ez] = extents(item);
    if (outsidePlan(doc, x, z, ex, ez)) return true;
    return doc.items.some(other => {
      if (other.uid === item.uid || other.hang) return false;
      const [ox, oz] = extents(other);
      return Math.abs(other.x - x) < ex + ox + GAP - 1e-6 && Math.abs(other.z - z) < ez + oz + GAP - 1e-6;
    });
  };
  const place = (doc: PlannerLayout, item: PlannerPiece, x: number, z: number): Pt | null => {
    const [cx, cz] = clamp(doc, item, x, z);
    if (!collides(doc, item, cx, cz)) return [cx, cz];
    for (let radius = .05; radius < 5; radius += .05) {
      const count = Math.max(8, Math.round(radius * 40));
      for (let step = 0; step < count; step++) {
        const angle = step / count * Math.PI * 2;
        const [px, pz] = clamp(doc, item, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
        if (!collides(doc, item, px, pz)) return [px, pz];
      }
    }
    return null;
  };
  const reflow = <T extends PlannerLayout>(doc: T): T & { placementConflicts: string[] } => {
    const placed: PlannerPiece[] = [];
    const placementConflicts: string[] = [];
    for (const item of doc.items) {
      const position = place({ ...doc, items: placed }, item, item.x, item.z);
      if (!position) { placementConflicts.push(item.uid); placed.push({ ...item }); continue; }
      const [x, z] = position;
      placed.push({ ...item, x: round(x), z: round(z) });
    }
    return { ...doc, items: placed, placementConflicts, rugs: (doc.rugs || []).map(rug => {
      const [x, z] = clampRug(doc, rug, rug.x, rug.z); return { ...rug, x, z };
    }) };
  };
  return { widthCm, ready, dimensions, extents, clamp, collides, place, reflow };
}
