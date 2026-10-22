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

/** Loads a film's layers and returns a painter for any point u ∈ [0,1] of the build. */
export async function loadBuild(base) {
  const [meta, plan, room, full, mask] = await Promise.all([
    fetch(base + 'meta.json').then((r) => { if (!r.ok) throw new Error('no build'); return r.json(); }),
    img(base + 'plan.webp'), img(base + 'room.webp'), img(base + 'full.webp'), img(base + 'mask.png'),
  ]);
  const W = meta.w, H = meta.h;
  const px = (im) => { const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
  const roomPx = px(room), fullPx = px(full), maskPx = px(mask);
  // yield between the heavy passes so scrolling stays smooth while this runs
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  const R = derive(roomPx, W, H); await breathe();
  const F = derive(fullPx, W, H); await breathe();
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
    return { ...b, full: layer(fullPx), clay: layer(F.clay), wood: layer(F.wood), ink: layer(F.ink) };
  });
  const roomC = canvas(W, H); roomC.getContext('2d').drawImage(room, 0, 0, W, H);
  const fullC = canvas(W, H); fullC.getContext('2d').drawImage(full, 0, 0, W, H);
  const planC = canvas(W, H); planC.getContext('2d').drawImage(plan, 0, 0, W, H);
  const scratch = canvas(W, H), sg = scratch.getContext('2d');

  /** Draws src (cropped to x,y,w,h) revealed up to k along dir, with a soft leading edge. */
  const wipe = (g, src, x, y, w, h, k, dir, alpha = 1) => {
    if (k <= 0 || alpha <= 0) return;
    g.globalAlpha = alpha;
    if (k >= 1) { g.drawImage(src, x, y, w, h); g.globalAlpha = 1; return; }
    sg.globalCompositeOperation = 'copy'; sg.drawImage(src, 0, 0, w, h);
    sg.globalCompositeOperation = 'destination-in';
    const f = 0.22, e = k * (1 + f); // edge travels past the end so k=1 is fully shown
    let gr;
    if (dir === 'up') { const y0 = h * (1 - e), y1 = y0 + f * h; gr = sg.createLinearGradient(0, y0, 0, y1); }
    else if (dir === 'down') { const y1 = h * e, y0 = y1 - f * h; gr = sg.createLinearGradient(0, y1, 0, y0); }
    else { const x1 = w * e, x0 = x1 - f * w; gr = sg.createLinearGradient(x1, h * 0.25, x0, h * -0.15); }
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    sg.fillStyle = gr; sg.fillRect(0, 0, w, h);
    g.drawImage(scratch, 0, 0, w, h, x, y, w, h);
    g.globalAlpha = 1;
  };

  const n = pieces.length;
  const at = (span, i, len) => span[0] + (span[1] - span[0] - len) * (n > 1 ? i / (n - 1) : 0.5);

  /** Paints the build at u into a 2D context of W×H. */
  const paint = (g, u) => {
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (u >= BUILD.dress[1]) { g.drawImage(fullC, 0, 0); return; }
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
    // the plan, fading as the walls rise out of it
    const planA = 1 - ss(BUILD.plan[1], BUILD.lines[1] - 0.04, u);
    if (planA > 0) { g.globalAlpha = planA; g.drawImage(planC, 0, 0); g.globalAlpha = 1; }
    // the shell: clay from the floor up, then the real materials sweeping across it
    wipe(g, shellClay, 0, 0, W, H, ss(...BUILD.shell, u), 'up');
    wipe(g, roomC, 0, 0, W, H, ss(...BUILD.finish, u), 'right');
    // the line drawing of the walls leads the clay and lingers until the materials arrive
    const lineA = 1 - 0.55 * ss(BUILD.shell[1], BUILD.pieces[0] + 0.08, u) - 0.45 * ss(BUILD.finish[0], BUILD.finish[1] - 0.04, u);
    wipe(g, shellInk, 0, 0, W, H, ss(...BUILD.lines, u), 'up', lineA);
    // each piece, back of the room first
    const len = 0.13, dlen = 0.085;
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      const k = (u - at(BUILD.pieces, i, len)) / len;
      if (k <= 0) continue;
      const kd = ss(0, 1, (u - at(BUILD.dress, i, dlen)) / dlen);
      if (kd < 1) {
        wipe(g, p.wood, p.x, p.y, p.w, p.h, ss(0.22, 0.7, k), 'up');
        const kc = ss(0.62, 1, k);
        if (kc > 0) { g.globalAlpha = kc; g.drawImage(p.clay, p.x, p.y); g.globalAlpha = 1; }
      }
      wipe(g, p.full, p.x, p.y, p.w, p.h, kd, 'down');
      // the outline leads, stays as a pencil line on the clay and goes once the piece is dressed
      const inkA = (1 - 0.6 * ss(0.7, 1, k)) * (1 - kd);
      wipe(g, p.ink, p.x, p.y, p.w, p.h, ss(0, 0.45, k), 'up', inkA);
    }
    // settle onto the exact frame the film carries on from
    const end = ss(BUILD.dress[1] - 0.05, BUILD.dress[1], u);
    if (end > 0) { g.globalAlpha = end; g.drawImage(fullC, 0, 0); g.globalAlpha = 1; }
  };
  return { W, H, full: meta.full, paint };
}
