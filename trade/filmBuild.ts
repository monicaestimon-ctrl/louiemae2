/* eslint-disable */
// @ts-nocheck
// The hero's build sequence: a room assembled on scroll, in one continuous take.
//
//   plan → the walls draw up out of the plan → the shell fills in clay → each piece is drawn,
//   framed in raw timber and formed in clay, back of the room first → plaster, stone and timber
//   sweep across the shell → each piece is upholstered into the real thing → the furnished room.
//
// Built from the layers scripts/build-film-layers.mjs cuts out of each film: the plan, the
// finished room before the furniture arrives, the furnished room and a mask of every piece.
// Clay, timber and line versions are derived here, once, so only three photos travel.

export const BUILD = {
  plan: [0, 0.1],        // the drawing alone
  lines: [0.08, 0.27],   // the walls draw up from the floor
  shell: [0.17, 0.34],   // and fill in clay
  pieces: [0.3, 0.62],   // each piece: drawn → timber → clay
  finish: [0.6, 0.75],   // materials sweep across the room
  dress: [0.72, 0.95],   // each piece finished
};

const PAPER = '#EEE8DF';
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const CLAY_LO = hex('#A39A8F'), CLAY_HI = hex('#F7F3EC');
const WOOD_LO = hex('#8A6845'), WOOD_HI = hex('#F0DEC2');
const INK = hex('#3B2D22');

function boxBlur(a, W, H, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[y * W + x] = s / n; s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / n; s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  return o;
}

/** Clay, timber and ink versions of an image, all at once (one pass over the pixels). */
function derive(src, W, H) {
  const N = W * H, L0 = new Float32Array(N);
  for (let i = 0; i < N; i++) L0[i] = (0.3 * src[i * 4] + 0.59 * src[i * 4 + 1] + 0.11 * src[i * 4 + 2]) / 255;
  // Clay and timber are smooth materials: flatten the terrazzo speckle and leaf-dappled light
  // (wide blur) but keep the form's shading. Lines come from a light blur so they trace edges,
  // not texture.
  const soft = boxBlur(L0, W, H, Math.round(W / 320)), Ls = boxBlur(L0, W, H, Math.round(W / 640));
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = 0.35 * L0[i] + 0.65 * soft[i];
  const clay = new Uint8ClampedArray(N * 4), wood = new Uint8ClampedArray(N * 4), ink = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, k = i * 4, l = L[i];
    const c = Math.pow(l, 0.6), w = Math.pow(l, 0.8);
    for (let e = 0; e < 3; e++) { clay[k + e] = CLAY_LO[e] + (CLAY_HI[e] - CLAY_LO[e]) * c; wood[k + e] = WOOD_LO[e] + (WOOD_HI[e] - WOOD_LO[e]) * w; ink[k + e] = INK[e]; }
    clay[k + 3] = wood[k + 3] = 255;
    if (x && y && x < W - 1 && y < H - 1) {
      const gx = Ls[i - W + 1] + 2 * Ls[i + 1] + Ls[i + W + 1] - Ls[i - W - 1] - 2 * Ls[i - 1] - Ls[i + W - 1];
      const gy = Ls[i + W - 1] + 2 * Ls[i + W] + Ls[i + W + 1] - Ls[i - W - 1] - 2 * Ls[i - W] - Ls[i - W + 1];
      ink[k + 3] = 255 * 0.8 * ss(0.2, 0.62, Math.abs(gx) + Math.abs(gy));
    }
  }
  return { clay, wood, ink };
}

const toCanvas = (data, W, H) => { const c = canvas(W, H); c.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0); return c; };

const SHEET = hex('#F7F2E9'), GRAPHITE = hex('#342E28');
// key light from the upper left and slightly in front: the shaded side is hatched
const LIGHT = (() => { const v = [-0.55, -0.62, 0.56], m = Math.hypot(...v); return v.map((c) => c / m); })();
// a cheap per-pixel hash, for the grain of graphite on paper
const grain = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * One object (a chair, the sofa, a table) as its own 3D pencil study: a smooth, closed
 * outline of its silhouette, its construction lines (seams, cushion breaks, arms, legs)
 * drawn only inside it so they never run into a neighbour, and hatching that follows its
 * volume. Objects are drawn separately and together read as one drawing of the room.
 *
 * The real object supplies the drawing, not its look: its material is divided out (each pixel
 * against the object's own local brightness, so dark leather and pale bouclé shade the same),
 * fine texture is smoothed away before any line is traced, and lines are thinned to one
 * stroke. Darker form gets diagonal hatching, the darkest a cross-hatch.
 * Returns the outline and construction lines (lines), the hatching (fill) and a hatched shadow.
 */
function sketch(fullPx, objPx, W, id, b) {
  const { x, y, w, h } = b, N = w * h;
  const a = new Float32Array(N), La = new Float32Array(N), Lp = new Float32Array(N);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const s = ((y + yy) * W + x + xx) * 4, i = yy * w + xx;
    const l = (0.3 * fullPx[s] + 0.59 * fullPx[s + 1] + 0.11 * fullPx[s + 2]) / 255;
    Lp[i] = l;
    if (objPx[s] !== id) continue;
    a[i] = objPx[s + 1] / 255; La[i] = a[i] * l;
  }
  // the silhouette, smoothed into a clean shape: its 0.5 contour is the outline
  const r1 = Math.max(1, Math.round(W / 500));
  const shape = boxBlur(boxBlur(boxBlur(a, w, h, r1), w, h, r1), w, h, r1);
  const inside = boxBlur(shape.map((v) => (v > 0.5 ? 1 : 0)), w, h, Math.max(2, Math.round(W / 320)));
  // the object's own area for line work: its mask grown by a few pixels (so the true
  // silhouette edge, just outside a slightly tight mask, is caught) but never onto another object
  const grow = boxBlur(a, w, h, Math.max(2, Math.round(W / 280)));
  const own = new Uint8Array(N);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const s = ((y + yy) * W + x + xx) * 4, other = objPx[s] && objPx[s] !== id && objPx[s + 1] > 60;
    own[yy * w + xx] = grow[yy * w + xx] > 0.03 && !other ? 1 : 0;
  }
  // normalised blurs, inside the object only, so the floor around it never bleeds in
  const nblur = (r, n) => { let v = La, m = a; for (let k = 0; k < n; k++) { v = boxBlur(v, w, h, r); m = boxBlur(m, w, h, r); } return [v, m]; };
  const at = ([v, m], i, d = 0) => (m[i] > 0.02 ? v[i] / m[i] : d);
  const S = nblur(Math.max(1, Math.round(W / 640)), 2);   // shading, texture smoothed away
  const A = nblur(Math.max(4, Math.round(W / 48)), 2);    // the material's own brightness
  const rL = Math.max(1, Math.round(W / 560));
  const cL = boxBlur(boxBlur(Lp, w, h, rL), w, h, rL);    // what the construction lines trace
  const rV = Math.max(2, Math.round(W / 200)), hgt = boxBlur(boxBlur(a, w, h, rV), w, h, rV), kN = W / 48;
  const P = Math.max(5, Math.round(W / 170)); // hatch spacing
  const hatch = (u, t, wob) => { const q = (((u + wob) % P) + P) % P, d = Math.min(q, P - q), half = 0.2 + 0.55 * t; return 1 - ss(half, half + 0.8, d); };
  const grad = (f, i) => { const xx = i % w, yy = (i / w) | 0, l = Math.max(0, xx - 1), r = Math.min(w - 1, xx + 1), u = Math.max(0, yy - 1), d = Math.min(h - 1, yy + 1);
    return [(f[yy * w + r] - f[yy * w + l]) / 2, (f[d * w + xx] - f[u * w + xx]) / 2]; };
  const fill = new Uint8ClampedArray(N * 4), lines = new Uint8ClampedArray(N * 4), shadow = new Uint8ClampedArray(N * 4);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = yy * w + xx, o = i * 4;
    const xl = Math.max(0, xx - 1), xr = Math.min(w - 1, xx + 1), yu = Math.max(0, yy - 1), yd = Math.min(h - 1, yy + 1);
    const g = 0.6 + 0.4 * grain(xx + x, yy + y);
    // Line work traced from the real photo: its true silhouette against the room and its seams,
    // cushion breaks, arms and legs. Only pixels that belong to this object (own[] is the
    // object's area, a touch wider than its mask, minus any neighbour's) so lines never run
    // from one object into the next. The outline is the stronger edge at the boundary.
    let ink = 0;
    if (own[i]) {
      const [gx, gy] = grad(cL, i), mg = Math.hypot(gx, gy);
      const [p1, p2] = Math.abs(gx) > Math.abs(gy) ? [yy * w + xl, yy * w + xr] : [yu * w + xx, yd * w + xx];
      if (mg >= Math.hypot(...grad(cL, p1)) && mg >= Math.hypot(...grad(cL, p2))) {
        const edgeOfShape = 1 - ss(0.75, 0.98, inside[i]);
        ink = ss(0.006, 0.022, mg) * (0.7 + 0.3 * edgeOfShape);
      }
    }
    for (let e = 0; e < 3; e++) lines[o + e] = GRAPHITE[e];
    lines[o + 3] = 255 * ink * g;
    // tone: the object's shade with its material divided out, plus the key light on its
    // roundness and a little weight at the base; hatched, cross-hatched where darkest
    const nx = -(hgt[yy * w + xr] - hgt[yy * w + xl]) * kN, ny = -(hgt[yd * w + xx] - hgt[yu * w + xx]) * kN;
    const lam = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / Math.hypot(nx, ny, 1)) / LIGHT[2];
    const form = Math.min(1.45, Math.max(0.3, at(S, i) / Math.max(0.04, at(A, i, 1))));
    const t = Math.min(1, Math.max(0, 1 - ss(0.55, 1.1, form) + 0.35 * (1 - Math.min(1, lam)) + 0.2 * ss(0.75, 1, yy / h)));
    const wob = 0.7 * Math.sin(yy * 0.19 + xx * 0.03);
    const h1 = hatch(xx + yy, t, wob) * 0.32 * ss(0.4, 0.7, t);
    const h2 = hatch(xx - yy, t - 0.4, -wob) * 0.25 * ss(0.75, 1, t);
    for (let e = 0; e < 3; e++) fill[o + e] = GRAPHITE[e];
    fill[o + 3] = 255 * Math.max(h1, h2) * g * ss(0.45, 0.6, shape[i]);
  }
  // cast shadow on the floor: the silhouette, dropped and spread, drawn in light hatching
  const rS = Math.max(4, Math.round(W / 110)), drop = Math.round(h * 0.03);
  const sh = boxBlur(boxBlur(a, w, h, rS), w, h, rS);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const o = (yy * w + xx) * 4, sa = sh[Math.max(0, yy - drop) * w + xx] * (0.3 + 0.7 * ss(0.5, 1, yy / h)) * (1 - ss(0.4, 0.6, shape[yy * w + xx]));
    for (let e = 0; e < 3; e++) shadow[o + e] = GRAPHITE[e];
    shadow[o + 3] = 255 * Math.min(1, sa * 0.7 * hatch(xx + yy, 0.25, 0));
  }
  // a pencil line has some weight: widen each stroke by a soft pixel either side
  const thick = new Uint8ClampedArray(lines);
  for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
    const i = (yy * w + xx) * 4 + 3;
    thick[i] = Math.max(lines[i], 0.55 * Math.max(lines[i - 4], lines[i + 4], lines[i - w * 4], lines[i + w * 4]));
  }
  return { fill: toCanvas(fill, w, h), lines: toCanvas(thick, w, h), shadow: toCanvas(shadow, w, h) };
}

/** Loads a film's layers and returns a painter for any point u ∈ [0,1] of the build. */
export async function loadBuild(base) {
  const [meta, plan, room, full, mask, objs] = await Promise.all([
    fetch(base + 'meta.json').then((r) => { if (!r.ok) throw new Error('no build'); return r.json(); }),
    img(base + 'plan.webp'), img(base + 'room.webp'), img(base + 'full.webp'), img(base + 'mask.png'), img(base + 'objects.png'),
  ]);
  const W = meta.w, H = meta.h;
  const px = (im) => { const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
  const roomPx = px(room), fullPx = px(full), maskPx = px(mask), objPx = px(objs);
  // yield between the heavy passes so scrolling stays smooth while this runs
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  const R = derive(roomPx, W, H); await breathe();
  const shellClay = toCanvas(R.clay, W, H), shellInk = toCanvas(R.ink, W, H);
  const pieces = meta.pieces.map((b, n) => {
    const id = n + 1, { x, y, w, h } = b;
    const layer = (srcPx, weight = 1) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const s = ((y + yy) * W + x + xx) * 4, o = (yy * w + xx) * 4;
        if (maskPx[s] !== id) continue;
        d[o] = srcPx[s]; d[o + 1] = srcPx[s + 1]; d[o + 2] = srcPx[s + 2];
        d[o + 3] = srcPx[s + 3] * (maskPx[s + 1] / 255) * weight;
      }
      return toCanvas(d, w, h);
    };
    // Until it is revealed, the room behind the piece stays as the sketched shell, so the
    // finished floor never shows through the drawing; feathered so it has no edge of its own.
    const hold = (() => {
      const m = new Float32Array(w * h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const s = ((y + yy) * W + x + xx) * 4; m[yy * w + xx] = maskPx[s] === id ? maskPx[s + 1] / 255 : 0; }
      const r = Math.max(3, Math.round(W / 160)), f = boxBlur(boxBlur(m, w, h, r), w, h, r);
      const c = canvas(w, h), cg = c.getContext('2d'); cg.drawImage(shellClay, x, y, w, h, 0, 0, w, h);
      const d = cg.getImageData(0, 0, w, h); for (let i = 0; i < w * h; i++) d.data[i * 4 + 3] = 255 * Math.min(1, f[i] * 1.6);
      cg.putImageData(d, 0, 0); return c;
    })();
    return { ...b, full: layer(fullPx), hold };
  });
  // each object drawn on its own, back of the room first (the build script sorts them)
  const objects = (meta.objects || []).map((o, n) => ({ ...o, p: pieces[o.piece - 1], ...sketch(fullPx, objPx, W, n + 1, o) })).filter((o) => o.p);
  const roomC = canvas(W, H); roomC.getContext('2d').drawImage(room, 0, 0, W, H);
  const fullC = canvas(W, H); fullC.getContext('2d').drawImage(full, 0, 0, W, H);
  const planC = canvas(W, H); planC.getContext('2d').drawImage(plan, 0, 0, W, H);
  const scratch = canvas(W, H), sg = scratch.getContext('2d');

  /** Draws src (cropped to x,y,w,h) revealed up to k along dir, with a soft leading edge. */
  const wipe = (g, src, x, y, w, h, k, dir, alpha = 1, f = 0.22) => {
    if (k <= 0 || alpha <= 0) return;
    g.globalAlpha = alpha;
    if (k >= 1) { g.drawImage(src, x, y, w, h); g.globalAlpha = 1; return; }
    sg.globalCompositeOperation = 'copy'; sg.drawImage(src, 0, 0, w, h);
    sg.globalCompositeOperation = 'destination-in';
    sg.fillStyle = edge(dir, w, h, k, f, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]); sg.fillRect(0, 0, w, h);
    g.drawImage(scratch, 0, 0, w, h, x, y, w, h);
    g.globalAlpha = 1;
  };
  /** A gradient whose leading edge sits at k along dir; the edge travels past the end so k=1 shows all. */
  const edge = (dir, w, h, k, f, stops) => {
    const e = k * (1 + f);
    let gr;
    if (dir === 'up') { const y0 = h * (1 - e); gr = sg.createLinearGradient(0, y0, 0, y0 + f * h); }
    else if (dir === 'down') { const y1 = h * e; gr = sg.createLinearGradient(0, y1, 0, y1 - f * h); }
    else if (dir === 'diag') {
      // along the key light: upper left to lower right, measured on the piece's diagonal
      const d = Math.hypot(w, h), ux = w / d, uy = h / d, p = d * e;
      gr = sg.createLinearGradient(ux * p, uy * p, ux * (p - f * d), uy * (p - f * d));
    } else { const x1 = w * e; gr = sg.createLinearGradient(x1, h * 0.25, x1 - f * w, h * -0.15); }
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  };
  /** The real piece arriving behind a band of light that travels across its clay form. */
  const reveal = (g, p, k) => {
    if (k <= 0) return;
    if (k >= 1) { g.drawImage(p.full, p.x, p.y); return; }
    // a slight settle into place, like a render resolving
    const s = 1 + 0.025 * (1 - k), cx = p.x + p.w / 2, cy = p.y + p.h;
    g.save(); g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy);
    wipe(g, p.full, p.x, p.y, p.w, p.h, k, 'diag', 1, 0.38);
    g.restore();
    // the band of light, shaped by the piece
    sg.globalCompositeOperation = 'copy'; sg.drawImage(p.full, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    const band = Math.sin(Math.PI * k);
    sg.fillStyle = edge('diag', p.w, p.h, k, 0.38, [[0, 'rgba(255,250,240,0)'], [0.18, `rgba(255,250,240,${0.85 * band})`], [0.55, 'rgba(255,250,240,0)']]);
    sg.fillRect(0, 0, p.w, p.h);
    g.globalCompositeOperation = 'screen'; g.drawImage(scratch, 0, 0, p.w, p.h, p.x, p.y, p.w, p.h); g.globalCompositeOperation = 'source-over';
  };

  const n = pieces.length;
  const at = (span, i, len, count = n) => span[0] + (span[1] - span[0] - len) * (count > 1 ? i / (count - 1) : 0.5);

  /** Paints the build at u into a 2D context of W×H. */
  const paint = (g, u) => {
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (u >= BUILD.dress[1]) { g.drawImage(fullC, 0, 0); return; }
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
    // camera: a gentle push in as the walls rise, then a slow pull back while the room is
    // furnished, so it starts on the plan and ends on the film's own frame
    const cam = 1 + 0.045 * ss(BUILD.plan[1], BUILD.shell[1], u) * (1 - ss(BUILD.shell[1], BUILD.dress[1] - 0.03, u));
    g.setTransform(cam, 0, 0, cam, (W / 2) * (1 - cam), H * 0.58 * (1 - cam));
    // the plan, fading as the walls rise out of it
    const planA = 1 - ss(BUILD.plan[1], BUILD.lines[1] - 0.04, u);
    if (planA > 0) { g.globalAlpha = planA; g.drawImage(planC, 0, 0); g.globalAlpha = 1; }
    // the shell: clay from the floor up, then the real materials sweeping across it
    wipe(g, shellClay, 0, 0, W, H, ss(...BUILD.shell, u), 'up');
    wipe(g, roomC, 0, 0, W, H, ss(...BUILD.finish, u), 'right');
    // the line drawing of the walls leads the clay and lingers until the materials arrive
    // and steps back to a faint guide while the furniture is drawn over it
    const lineA = 1 - 0.7 * ss(BUILD.shell[1], BUILD.pieces[0] + 0.06, u) - 0.3 * ss(BUILD.finish[0], BUILD.finish[1] - 0.04, u);
    wipe(g, shellInk, 0, 0, W, H, ss(...BUILD.lines, u), 'up', lineA);
    // how far each piece is through its reveal
    const dlen = 0.11;
    for (let i = 0; i < n; i++) pieces[i].kd = ss(0, 1, (u - at(BUILD.dress, i, dlen)) / dlen);
    // the sketched shell holds behind every piece still to be revealed
    if (u > BUILD.finish[0]) for (const p of pieces) if (p.kd < 1) { g.globalAlpha = 1 - p.kd; g.drawImage(p.hold, p.x, p.y); g.globalAlpha = 1; }
    // each object drawn on its own, back of the room first: outline, then hatching and shadow
    const len = 0.1, m = objects.length;
    for (let j = 0; j < m; j++) {
      const o = objects[j], fade = 1 - o.p.kd;
      const k = (u - at(BUILD.pieces, j, len, m)) / len;
      if (k <= 0 || fade <= 0) continue;
      const shA = ss(0.5, 0.9, k) * fade;
      if (shA > 0) { g.globalAlpha = shA; g.drawImage(o.shadow, o.x, o.y); g.globalAlpha = 1; }
      wipe(g, o.fill, o.x, o.y, o.w, o.h, ss(0.4, 0.95, k), 'diag', fade, 0.5);
      wipe(g, o.lines, o.x, o.y, o.w, o.h, ss(0, 0.55, k), 'up', fade, 0.3);
    }
    // then each piece becomes the real thing, behind a band of light
    for (const p of pieces) reveal(g, p, p.kd);
    // settle onto the exact frame the film carries on from
    const end = ss(BUILD.dress[1] - 0.05, BUILD.dress[1], u);
    if (end > 0) { g.globalAlpha = end; g.drawImage(fullC, 0, 0); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  return { W, H, full: meta.full, paint };
}
