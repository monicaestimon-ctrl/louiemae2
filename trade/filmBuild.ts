/* eslint-disable */
// @ts-nocheck
// The hero's build sequence: a room assembled on scroll, in one continuous take.
//
//   plan → the empty room is drawn up out of the plan → every piece of furniture is drawn in its
//   place, all at once, each as its own pencil drawing → one sweep of light turns the drawing into
//   the finished room, each piece becoming the real thing as the sweep reaches it.
//
// Built from the layers scripts/build-film-layers.mjs cuts out of each film (the plan, the empty
// room, the furnished room and a mask of every piece) and the drawings
// scripts/build-film-sketches.mjs makes of them: one line drawing per object and one of the room.

export const BUILD = {
  plan: [0, 0.1],        // the drawing alone
  lines: [0.06, 0.27],   // the empty room draws up from the floor
  shell: [0.14, 0.32],   // a light wash of tone under it
  pieces: [0.3, 0.58],   // every piece drawn at once, each on its own
  finish: [0.6, 0.93],   // the sweep that finishes the room
  dress: [0.6, 0.95],    // and each piece in it
};

const PAPER = '#EEE8DF';
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const CLAY_LO = hex('#A39A8F'), CLAY_HI = hex('#F7F3EC');

function boxBlur(a, W, H, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[y * W + x] = s / n; s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / n; s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  return o;
}

/** The image as smooth clay: the form's shading kept, terrazzo speckle and dappled light flattened. */
function clayOf(src, W, H) {
  const N = W * H, L0 = new Float32Array(N);
  for (let i = 0; i < N; i++) L0[i] = (0.3 * src[i * 4] + 0.59 * src[i * 4 + 1] + 0.11 * src[i * 4 + 2]) / 255;
  const soft = boxBlur(L0, W, H, Math.round(W / 320)), clay = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const c = Math.pow(0.35 * L0[i] + 0.65 * soft[i], 0.6), k = i * 4;
    for (let e = 0; e < 3; e++) clay[k + e] = CLAY_LO[e] + (CLAY_HI[e] - CLAY_LO[e]) * c;
    clay[k + 3] = 255;
  }
  return clay;
}

const toCanvas = (data, W, H) => { const c = canvas(W, H); c.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0); return c; };

const WASH = 0.4; // how much tone the drawn room carries
const BODY = hex('#F8F4EC'); // the lit paper of a drawn piece
const GRAPHITE = hex('#342E28');
// key light from the upper left and slightly in front: the shaded side is hatched
const LIGHT = (() => { const v = [-0.55, -0.62, 0.56], m = Math.hypot(...v); return v.map((c) => c / m); })();
// a cheap per-pixel hash, for the grain of graphite on paper
const grain = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * The tone of one object (a chair, the sofa, a table) as a solid pencil study: an opaque body of
 * paper shaded to its form and deepening toward its edges as it turns away, so it hides the room's
 * lines and anything behind it and reads as its own solid piece; hatching that follows its volume, cross-hatched
 * where darkest; and a soft shadow on the floor. Its lines come from
 * its own drawing (sketch.png). The real object supplies the shading, not its look: its material
 * is divided out (each pixel against the object's own local brightness, so dark leather and pale
 * bouclé shade the same) and fine texture is smoothed away.
 */
function tone(fullPx, objPx, W, id, b) {
  const { x, y, w, h } = b, N = w * h;
  const a = new Float32Array(N), La = new Float32Array(N);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const s = ((y + yy) * W + x + xx) * 4, i = yy * w + xx;
    if (objPx[s] !== id) continue;
    a[i] = objPx[s + 1] / 255; La[i] = a[i] * (0.3 * fullPx[s] + 0.59 * fullPx[s + 1] + 0.11 * fullPx[s + 2]) / 255;
  }
  const r1 = Math.max(1, Math.round(W / 500));
  const shape = boxBlur(boxBlur(a, w, h, r1), w, h, r1);
  // normalised blurs, inside the object only, so the floor around it never bleeds in
  const nblur = (r, n) => { let v = La, m = a; for (let k = 0; k < n; k++) { v = boxBlur(v, w, h, r); m = boxBlur(m, w, h, r); } return [v, m]; };
  const at = ([v, m], i, d = 0) => (m[i] > 0.02 ? v[i] / m[i] : d);
  const S = nblur(Math.max(1, Math.round(W / 640)), 2);   // shading, texture smoothed away
  const A = nblur(Math.max(4, Math.round(W / 48)), 2);    // the material's own brightness
  const rV = Math.max(2, Math.round(W / 200)), hgt = boxBlur(boxBlur(a, w, h, rV), w, h, rV), kN = W / 48;
  const P = Math.max(5, Math.round(W / 170)); // hatch spacing
  // how far in from the silhouette each pixel is, softly: the form turning away near its edges
  const rE = Math.max(3, Math.round(W / 160)), deep = boxBlur(boxBlur(a, w, h, rE), w, h, rE);
  // things on the wall (sconces, art, shelf pieces) stay lighter, so they sit back against it,
  // and so do rugs and anything else lying flat on the floor
  const solid = y + h <= (b.H || W * 0.5625) * 0.55 ? 0.55 : h < w * 0.45 ? 0.4 : 1;
  const hatch = (u, t, wob) => { const q = (((u + wob) % P) + P) % P, d = Math.min(q, P - q), half = 0.2 + 0.55 * t; return 1 - ss(half, half + 0.8, d); };
  const fill = new Uint8ClampedArray(N * 4), shadow = new Uint8ClampedArray(N * 4), body = new Uint8ClampedArray(N * 4);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = yy * w + xx, o = i * 4;
    const xl = Math.max(0, xx - 1), xr = Math.min(w - 1, xx + 1), yu = Math.max(0, yy - 1), yd = Math.min(h - 1, yy + 1);
    const g = 0.6 + 0.4 * grain(xx + x, yy + y);
    // the object's shade with its material divided out, plus the key light on its roundness and
    // a little weight at the base
    const nx = -(hgt[yy * w + xr] - hgt[yy * w + xl]) * kN, ny = -(hgt[yd * w + xx] - hgt[yu * w + xx]) * kN;
    const lam = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / Math.hypot(nx, ny, 1)) / LIGHT[2];
    const form = Math.min(1.45, Math.max(0.3, at(S, i) / Math.max(0.04, at(A, i, 1))));
    const t = Math.min(1, Math.max(0, 1 - ss(0.55, 1.1, form) + 0.35 * (1 - Math.min(1, lam)) + 0.2 * ss(0.75, 1, yy / h)));
    const wob = 0.7 * Math.sin(yy * 0.19 + xx * 0.03);
    const h1 = hatch(xx + yy, t, wob) * 0.3 * ss(0.4, 0.7, t);
    const h2 = hatch(xx - yy, t - 0.4, -wob) * 0.24 * ss(0.75, 1, t);
    for (let e = 0; e < 3; e++) fill[o + e] = GRAPHITE[e];
    fill[o + 3] = 255 * Math.max(h1, h2) * g * ss(0.45, 0.6, shape[i]);
    // the solid body: lit paper on the light side, a graphite wash deepening into the shade and
    // toward the edges, where the form turns away
    const d = 0.03 + 0.34 * t * (0.85 + 0.15 * g) + 0.16 * (1 - ss(0.45, 0.95, deep[i]));
    for (let e = 0; e < 3; e++) body[o + e] = BODY[e] + (GRAPHITE[e] - BODY[e]) * d;
    body[o + 3] = 255 * solid * ss(0.3, 0.55, shape[i]);
  }
  // cast shadow on the floor: the silhouette, dropped and spread, a soft smudge of graphite
  const rS = Math.max(4, Math.round(W / 110)), drop = Math.round(h * 0.03);
  const sh = boxBlur(boxBlur(a, w, h, rS), w, h, rS);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const o = (yy * w + xx) * 4, sa = sh[Math.max(0, yy - drop) * w + xx] * (0.3 + 0.7 * ss(0.5, 1, yy / h)) * (1 - ss(0.4, 0.6, shape[yy * w + xx]));
    for (let e = 0; e < 3; e++) shadow[o + e] = GRAPHITE[e];
    shadow[o + 3] = 255 * Math.min(1, sa * 0.42 * (0.8 + 0.2 * grain(xx + x, yy + y)));
  }
  return { fill: toCanvas(fill, w, h), shadow: toCanvas(shadow, w, h), body: toCanvas(body, w, h) };
}

/**
 * A drawing as the hand makes it: STAGES cumulative canvases, the k-th holding every stroke
 * drawn by k/STAGES of the way (R of the source is the order a pixel is drawn in, A its ink).
 */
const STAGES = 7;
function strokes(srcPx, SW, sx, sy, w, h, weight = 1) {
  const out = [];
  for (let k = 1; k <= STAGES; k++) {
    const d = new Uint8ClampedArray(w * h * 4), lim = k / STAGES;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const s = ((sy + yy) * SW + sx + xx) * 4, o = (yy * w + xx) * 4, ink = srcPx[s + 3];
      if (!ink) continue;
      const shown = Math.min(1, Math.max(0, (lim - srcPx[s] / 255) * STAGES * 1.5 + 1));
      if (shown <= 0) continue;
      d[o] = GRAPHITE[0]; d[o + 1] = GRAPHITE[1]; d[o + 2] = GRAPHITE[2]; d[o + 3] = Math.min(255, ink * shown * weight);
    }
    out.push(toCanvas(d, w, h));
  }
  return out;
}

/** Loads a film's layers and returns a painter for any point u ∈ [0,1] of the build. */
export async function loadBuild(base) {
  const [meta, plan, room, full, mask, objs, atlas, roomLines] = await Promise.all([
    fetch(base + 'meta.json').then((r) => { if (!r.ok) throw new Error('no build'); return r.json(); }),
    img(base + 'plan.webp'), img(base + 'room.webp'), img(base + 'full.webp'), img(base + 'mask.png'), img(base + 'objects.png'),
    img(base + 'sketch.png'), img(base + 'roomlines.png'),
  ]);
  const W = meta.w, H = meta.h;
  const px = (im, w = W, h = H) => { const c = canvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const roomPx = px(room), fullPx = px(full), maskPx = px(mask), objPx = px(objs), atlasPx = px(atlas, atlas.naturalWidth, atlas.naturalHeight), linePx = px(roomLines);
  // yield between the heavy passes so scrolling stays smooth while this runs
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  const shellClay = toCanvas(clayOf(roomPx, W, H), W, H); await breathe();
  // the empty room's own drawing, in graphite
  const roomInk = (() => { const d = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { d[i * 4] = GRAPHITE[0]; d[i * 4 + 1] = GRAPHITE[1]; d[i * 4 + 2] = GRAPHITE[2]; d[i * 4 + 3] = linePx[i * 4 + 3]; } return toCanvas(d, W, H); })();
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
    return { ...b, full: layer(fullPx) };
  });
  await breathe();
  // every object drawn on its own: its own line drawing, stroke by stroke, then its tone. All
  // start together; each is a beat ahead of or behind the others, like several hands at work.
  const objects = [];
  for (const [n, o] of (meta.objects || []).entries()) {
    if (!pieces[o.piece - 1]) continue;
    objects.push({ ...o, p: pieces[o.piece - 1], lines: strokes(atlasPx, atlas.naturalWidth, o.ax, o.ay, o.w, o.h, 1.35), ...tone(fullPx, objPx, W, n + 1, { ...o, H }), beat: grain(n * 7.1, 3.3) });
    if (n % 8 === 7) await breathe();
  }
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
  /**
   * The real piece arriving under the sweep: the same soft edge as the room's, in the frame's
   * coordinates, so drawing turns into the finished room along one clean line.
   */
  const SWEEP = 0.22;
  const reveal = (g, p, e) => {
    const x1 = W * e - p.x;
    if (x1 <= 0) return;
    if (x1 - SWEEP * W >= p.w) { g.drawImage(p.full, p.x, p.y); return; }
    sg.globalCompositeOperation = 'copy'; sg.drawImage(p.full, 0, 0);
    sg.globalCompositeOperation = 'destination-in';
    const gr = sg.createLinearGradient(x1, 0, x1 - SWEEP * W, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    sg.fillStyle = gr; sg.fillRect(0, 0, p.w, p.h);
    g.drawImage(scratch, 0, 0, p.w, p.h, p.x, p.y, p.w, p.h);
  };

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
    // the empty room: its drawing rises from the floor with a light wash of tone under it, and
    // steps back once the furniture is drawn over it
    wipe(g, shellClay, 0, 0, W, H, ss(...BUILD.shell, u), 'up', WASH);
    wipe(g, roomInk, 0, 0, W, H, ss(...BUILD.lines, u), 'up', 1 - 0.45 * ss(BUILD.pieces[0], BUILD.pieces[0] + 0.1, u), 0.12);
    // then one sweep of light, left to right, turns the drawing into the finished room; each
    // piece becomes the real thing as the sweep crosses it
    const sweep = ss(...BUILD.finish, u);
    wipe(g, roomC, 0, 0, W, H, sweep, 'right');
    const e = sweep * (1 + SWEEP), front = e - SWEEP / 2;
    // how far the sweep is across each piece: its drawing gives way as the real piece arrives
    for (const p of pieces) p.kd = ss(p.x / W - 0.04, (p.x + p.w) / W + 0.04, front);
    // every piece drawn at once, each on its own: its strokes in the order a hand makes them,
    // then its hatching and its shadow
    const [p0, p1] = BUILD.pieces, len = (p1 - p0) * 0.78;
    for (const o of objects) {
      const fade = 1 - o.p.kd;
      const k = (u - (p0 + (p1 - p0 - len) * o.beat)) / len;
      if (k <= 0 || fade <= 0) continue;
      const shA = ss(0.55, 0.95, k) * fade;
      if (shA > 0) { g.globalAlpha = shA; g.drawImage(o.shadow, o.x, o.y); g.globalAlpha = 1; }
      // the piece turns solid as its outline closes, so it stands clear of the room and of its
      // neighbours (back of the room first, so nearer pieces cover farther ones)
      wipe(g, o.body, o.x, o.y, o.w, o.h, ss(0.2, 0.75, k), 'up', fade, 0.4);
      wipe(g, o.fill, o.x, o.y, o.w, o.h, ss(0.5, 1, k), 'diag', fade, 0.5);
      const f = ss(0, 0.7, k) * STAGES;
      if (f > 0) {
        const s0 = Math.floor(f);
        g.globalAlpha = fade;
        if (s0 > 0) g.drawImage(o.lines[Math.min(STAGES, s0) - 1], o.x, o.y);
        if (s0 < STAGES) { g.globalAlpha = fade * (f - s0); g.drawImage(o.lines[s0], o.x, o.y); }
        g.globalAlpha = 1;
      }
    }
    if (sweep > 0) {
      for (const p of pieces) reveal(g, p, e);
      // a soft band of light riding the sweep's edge
      const band = 0.3 * Math.sin(Math.PI * sweep);
      if (band > 0.01) {
        const gr = g.createLinearGradient(W * e, 0, W * (e - SWEEP), 0);
        gr.addColorStop(0, 'rgba(255,248,236,0)'); gr.addColorStop(0.35, `rgba(255,248,236,${band})`); gr.addColorStop(1, 'rgba(255,248,236,0)');
        g.globalCompositeOperation = 'screen'; g.fillStyle = gr; g.fillRect(W * (e - SWEEP), 0, W * SWEEP, H); g.globalCompositeOperation = 'source-over';
      }
    }
    // settle onto the exact frame the film carries on from
    const end = ss(BUILD.dress[1] - 0.05, BUILD.dress[1], u);
    if (end > 0) { g.globalAlpha = end; g.drawImage(fullC, 0, 0); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  return { W, H, full: meta.full, paint };
}
