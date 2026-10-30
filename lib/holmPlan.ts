// Floor plans for the Space Planner: rooms are polygons in metres (x across, z down the page).
export type Pt = [number, number];
export type PlanRead = {
  rooms: { name: string; points: Pt[] }[];
  blocks: { name: string; points: Pt[] }[];
  scale: { a: Pt; b: Pt; meters: number } | null;
};

const clamp01 = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));
const pts = (p: unknown): Pt[] =>
  Array.isArray(p) ? p.filter((q) => Array.isArray(q) && q.length >= 2).slice(0, 64).map((q) => [clamp01(q[0]), clamp01(q[1])] as Pt) : [];

/** Keeps only well-formed shapes from an AI reading: 3 to 64 points each, coordinates within the image. */
export function cleanPlanRead(raw: unknown): PlanRead {
  const r = (raw ?? {}) as { rooms?: unknown[]; blocks?: unknown[]; scale?: { a?: unknown; b?: unknown; meters?: unknown } | null };
  const shapes = (list: unknown[] | undefined, fallback: string) =>
    (Array.isArray(list) ? list : [])
      .slice(0, 12)
      .map((x, i) => {
        const o = (x ?? {}) as { name?: unknown; points?: unknown };
        return { name: String(o.name || `${fallback} ${i + 1}`).slice(0, 40), points: pts(o.points) };
      })
      .filter((x) => x.points.length >= 3 && Math.abs(area(x.points)) > 1e-4);
  const s = r.scale;
  const sa = pts([s?.a])[0], sb = pts([s?.b])[0], m = Number(s?.meters);
  return {
    rooms: shapes(r.rooms, 'Room'),
    blocks: shapes(r.blocks, 'Block'),
    scale: sa && sb && m > 0 && m < 500 && (sa[0] !== sb[0] || sa[1] !== sb[1]) ? { a: sa, b: sb, meters: m } : null,
  };
}

/** Signed area (shoelace); positive when the points run clockwise on screen (y down). */
export function area(p: Pt[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function inside(p: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export const centroid = (p: Pt[]): Pt => {
  const a = area(p);
  if (Math.abs(a) < 1e-9) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
};

export const bounds = (polys: Pt[][]) => {
  const all = polys.flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...ys), maxZ: Math.max(...ys) };
};

/** Sets one wall to a new length by moving its end point along the wall's own direction. */
export function setWallLength(poly: Pt[], i: number, length: number): Pt[] {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(d > 0) || !(length > 0)) return poly;
  const k = length / d;
  const out = poly.slice();
  out[(i + 1) % poly.length] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  return out;
}
