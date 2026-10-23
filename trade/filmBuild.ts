/* eslint-disable */
// @ts-nocheck
// The room finished, painted live on scroll once the film's camera has come down into it.
//
//   the camera lands in the room, still all clay: its walls and floor and every piece in it
//   (the same pieces risen in the model, trade/filmModel.ts) → one sweep of light turns the clay
//   into the finished room, each piece becoming the real thing as the sweep reaches it → the
//   furnished room, the frame the film carries on from.
//
// Built from the layers scripts/build-film-layers.mjs cuts out of each film (the empty and
// furnished frames) and the outline of every object scripts/build-film-sketches.mjs finds.

export const BUILD = {
  enter: [0, 0.16],     // the clay room comes in as the camera lands
  finish: [0.3, 0.92],  // the sweep that finishes it
};

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function boxBlur(a, W, H, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[y * W + x] = s / n; s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / n; s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  return o;
}

const toCanvas = (data, W, H) => { const c = canvas(W, H); c.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0); return c; };

// the warm, matte cream of the film's own clay model
const CLAY_LO = hex('#B3A693'), CLAY_HI = hex('#F6F0E6'), SHADOW = hex('#3A2A1E'), ROOM_LO = hex('#8F806C');

/** The empty room in clay: its light and shade kept, its colours and fine texture gone. */
function clayRoom(src, W, H) {
  const N = W * H, L0 = new Float32Array(N);
  for (let i = 0; i < N; i++) L0[i] = (0.3 * src[i * 4] + 0.59 * src[i * 4 + 1] + 0.11 * src[i * 4 + 2]) / 255;
  const soft = boxBlur(L0, W, H, Math.max(1, Math.round(W / 320))), out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const c = ss(0.04, 0.82, 0.35 * L0[i] + 0.65 * soft[i]), k = i * 4;
    for (let e = 0; e < 3; e++) out[k + e] = ROOM_LO[e] + (CLAY_HI[e] - ROOM_LO[e]) * c;
    out[k + 3] = 255;
  }
  return out;
}
// key light from the upper left and slightly in front, as in a studio clay render
const LIGHT = (() => { const v = [-0.55, -0.62, 0.56], m = Math.hypot(...v); return v.map((c) => c / m); })();
const HALF = (() => { const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], m = Math.hypot(...v); return v.map((c) => c / m); })();

/**
 * One object as a sculpted study model, the kind an architect's clay model is furnished with.
 * The real piece's shading is kept (cushions, arms, folds, the fall of light) but its material
 * is divided out: each pixel against the object's own local brightness, so dark leather and
 * pale bouclé become the same matte clay, and fine texture is smoothed away. Thin bits (a leg's
 * reflection running down a glossy floor) are trimmed by opening the outline, so the model
 * stops cleanly at the piece. Plants and small things keep their own detail. Returns the clay, the
 * real piece cut out on the same outline, and a contact shadow for the floor beneath it.
 */
function sculpt(fullPx, objPx, W, id, b) {
  const { x, y, w, h } = b, N = w * h;
  // plants and small things (a vase, the pottery on a shelf, a coffee machine) keep their own
  // detail in clay; smoothed like a sofa they would read as lumps
  const plant = b.kind === 'plant' || Math.max(w, h) < W * 0.15 || w * h < W * (b.H || W * 0.5625) * 0.016;
  const a0 = new Float32Array(N);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const s = ((y + yy) * W + x + xx) * 4; if (objPx[s] === id) a0[yy * w + xx] = objPx[s + 1] / 255; }
  let a = a0;
  if (!plant) {
    const rO = Math.max(3, Math.round(W / 260));
    const opened = boxBlur(boxBlur(a0, w, h, rO).map((v) => (v > 0.92 ? 1 : 0)), w, h, rO).map((v) => (v > 0.08 ? 1 : 0));
    const sm = boxBlur(opened, w, h, Math.max(1, Math.round(W / 640)));
    a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = Math.min(a0[i], ss(0.3, 0.7, sm[i]));
  }
  const La = new Float32Array(N);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const s = ((y + yy) * W + x + xx) * 4, i = yy * w + xx; La[i] = a[i] * (0.3 * fullPx[s] + 0.59 * fullPx[s + 1] + 0.11 * fullPx[s + 2]) / 255; }
  // normalised blurs, inside the object only, so the floor around it never bleeds in
  const nblur = (r, n) => { let v = La, m = a; for (let k = 0; k < n; k++) { v = boxBlur(v, w, h, r); m = boxBlur(m, w, h, r); } return [v, m]; };
  const [sv, sm] = nblur(plant ? 1 : Math.max(1, Math.round(W / 640)), 2);   // texture smoothed away
  const [av, am] = nblur(Math.max(4, Math.round(W / 48)), 2);                // the material's own brightness
  // a little roundness at the silhouette
  // a detailed piece's own tonal range (a white jug on a white shelf still shows its form)
  let lo = 0.08, hi = 0.85;
  if (plant) { const v = []; for (let i = 0; i < N; i++) if (a[i] > 0.5) v.push(La[i] / a[i]); v.sort((p, q) => p - q); if (v.length > 20) { lo = v[Math.floor(v.length * 0.04)]; hi = Math.max(lo + 0.12, v[Math.floor(v.length * 0.97)]); } }
  const rV = Math.max(2, Math.round(W / 200)), hgt = boxBlur(boxBlur(a, w, h, rV), w, h, rV), k = W / 48;
  const clay = new Uint8ClampedArray(N * 4), real = new Uint8ClampedArray(N * 4), shadow = new Uint8ClampedArray(N * 4);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = yy * w + xx, o = i * 4, s = ((y + yy) * W + x + xx) * 4;
    const xl = Math.max(0, xx - 1), xr = Math.min(w - 1, xx + 1), yu = Math.max(0, yy - 1), yd = Math.min(h - 1, yy + 1);
    let nx = -(hgt[yy * w + xr] - hgt[yy * w + xl]) * k, ny = -(hgt[yd * w + xx] - hgt[yu * w + xx]) * k, nz = 1;
    const m = Math.hypot(nx, ny, nz); nx /= m; ny /= m; nz /= m;
    const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const spec = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 24);
    const sL = sm[i] > 0.02 ? sv[i] / sm[i] : 0, aL = am[i] > 0.02 ? av[i] / am[i] : 1;
    const form = Math.pow(Math.min(1.45, Math.max(0.3, sL / Math.max(0.04, aL))), 1.6);
    const occ = (1 - 0.22 * ss(0.7, 1, yy / h)) * (0.84 + 0.16 * ss(0.2, 0.6, hgt[i]));
    const shade = Math.min(1.12, (0.12 + 0.66 * form + 0.28 * lam) * occ);
    // plants and small things keep their detail: the real thing's own light and shade, in clay
    const raw = La[i] / Math.max(0.02, a[i]);
    const c = plant ? 0.15 + 0.85 * ss(lo, hi, raw) : ss(0.3, 1.1, shade);
    for (let e = 0; e < 3; e++) { clay[o + e] = CLAY_LO[e] + (CLAY_HI[e] - CLAY_LO[e]) * c + 255 * 0.06 * spec; real[o + e] = fullPx[s + e]; shadow[o + e] = SHADOW[e]; }
    clay[o + 3] = real[o + 3] = a[i] * 255;
  }
  // contact shadow: the silhouette, dropped a little and spread, darkest at the base
  const rS = Math.max(4, Math.round(W / 90)), drop = Math.round(h * 0.035);
  const sh = boxBlur(boxBlur(a, w, h, rS), w, h, rS);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) shadow[(yy * w + xx) * 4 + 3] = 255 * 0.4 * sh[Math.max(0, yy - drop) * w + xx] * (0.35 + 0.65 * ss(0.45, 1, yy / h));
  return { clay: toCanvas(clay, w, h), real: toCanvas(real, w, h), shadow: toCanvas(shadow, w, h) };
}

/** Loads a film's layers and returns a painter for any point u ∈ [0,1] of the furnishing. */
export async function loadBuild(base) {
  const [meta, room, full, objs] = await Promise.all([
    fetch(base + 'meta.json').then((r) => { if (!r.ok) throw new Error('no build'); return r.json(); }),
    img(base + 'room.webp'), img(base + 'full.webp'), img(base + 'objects.png'),
  ]);
  if (!meta.objects || !meta.objects.length) throw new Error('no objects');
  const W = meta.w, H = meta.h;
  const px = (im) => { const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
  const roomPx = px(room), fullPx = px(full), objPx = px(objs);
  // yield between the heavy passes so scrolling stays smooth while this runs
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  const shellClay = toCanvas(clayRoom(roomPx, W, H), W, H); await breathe();
  const objects = [];
  for (const [i, o] of meta.objects.entries()) {
    objects.push({ ...o, ...sculpt(fullPx, objPx, W, i + 1, { ...o, H }) });
    if (i % 6 === 5) await breathe();
  }
  const roomC = canvas(W, H); roomC.getContext('2d').drawImage(room, 0, 0, W, H);
  const fullC = canvas(W, H); fullC.getContext('2d').drawImage(full, 0, 0, W, H);
  const scratch = canvas(W, H), sg = scratch.getContext('2d'), comp = canvas(W, H), cg = comp.getContext('2d');

  /** A gradient whose leading edge sits at k along dir; the edge travels past the end so k=1 shows all. */
  const edge = (dir, w, h, k, f, stops) => {
    const e = k * (1 + f);
    let gr;
    if (dir === 'up') { const y0 = h * (1 - e); gr = sg.createLinearGradient(0, y0, 0, y0 + f * h); }
    else { const d = Math.hypot(w, h), ux = w / d, uy = h / d, p = d * e; gr = sg.createLinearGradient(ux * p, uy * p, ux * (p - f * d), uy * (p - f * d)); }
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  };
  /** Draws src revealed up to k along dir, with a soft leading edge, into the rect x,y,w,h. */
  const wipe = (g, src, x, y, w, h, k, dir, f) => {
    if (k <= 0) return;
    if (k >= 1) { g.drawImage(src, x, y, w, h); return; }
    sg.globalCompositeOperation = 'copy'; sg.drawImage(src, 0, 0);
    sg.globalCompositeOperation = 'destination-in';
    sg.fillStyle = edge(dir, src.width, src.height, k, f, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]); sg.fillRect(0, 0, src.width, src.height);
    g.drawImage(scratch, 0, 0, src.width, src.height, x, y, w, h);
  };

  /**
   * Draws src (cropped to x,y,w,h, placed there in the frame) behind the sweep: the frame's own
   * soft edge at e, so the whole room finishes along one clean line.
   */
  const SWEEP = 0.22;
  const behind = (g, src, x, y, w, h, e) => {
    const x1 = W * e - x;
    if (x1 <= 0) return;
    if (x1 - SWEEP * W >= w) { g.drawImage(src, x, y); return; }
    sg.globalCompositeOperation = 'copy'; sg.drawImage(src, 0, 0);
    sg.globalCompositeOperation = 'destination-in';
    const gr = sg.createLinearGradient(x1, 0, x1 - SWEEP * W, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    sg.fillStyle = gr; sg.fillRect(0, 0, w, h);
    g.drawImage(scratch, 0, 0, w, h, x, y, w, h);
  };

  /** Paints the finishing at u into a 2D context of W×H; transparent while the camera lands. */
  const paint = (g, u) => {
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.setTransform(1, 0, 0, 1, 0, 0);
    if (u >= 1) { g.drawImage(fullC, 0, 0); return; }
    // the room in clay, every piece in it
    cg.globalAlpha = 1; cg.globalCompositeOperation = 'source-over';
    cg.drawImage(shellClay, 0, 0);
    for (const o of objects) { cg.globalAlpha = 0.8; cg.drawImage(o.shadow, o.x, o.y); cg.globalAlpha = 1; cg.drawImage(o.clay, o.x, o.y); }
    // one sweep of light, left to right: the room and each piece in it become the real thing
    const sweep = ss(...BUILD.finish, u), e = sweep * (1 + SWEEP);
    if (sweep > 0) {
      behind(cg, roomC, 0, 0, W, H, e);
      for (const o of objects) behind(cg, o.real, o.x, o.y, o.w, o.h, e);
      const band = 0.32 * Math.sin(Math.PI * sweep);
      if (band > 0.01) {
        const gr = cg.createLinearGradient(W * e, 0, W * (e - SWEEP), 0);
        gr.addColorStop(0, 'rgba(255,248,236,0)'); gr.addColorStop(0.35, `rgba(255,248,236,${band})`); gr.addColorStop(1, 'rgba(255,248,236,0)');
        cg.globalCompositeOperation = 'screen'; cg.fillStyle = gr; cg.fillRect(W * (e - SWEEP), 0, W * SWEEP, H); cg.globalCompositeOperation = 'source-over';
      }
    }
    // settle onto the exact frame the film carries on from (its reflections and shadows too)
    const end = ss(BUILD.finish[1] - 0.02, 1, u);
    if (end > 0) { cg.globalAlpha = end; cg.drawImage(fullC, 0, 0); cg.globalAlpha = 1; }
    // the clay room comes in over the film as the camera lands, settling into place
    const a = ss(...BUILD.enter, u), k = 1 + 0.05 * (1 - a);
    g.clearRect(0, 0, W, H);
    g.globalAlpha = a; g.setTransform(k, 0, 0, k, (W / 2) * (1 - k), H * 0.62 * (1 - k)); g.drawImage(comp, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  };
  return { W, H, paint };
}
