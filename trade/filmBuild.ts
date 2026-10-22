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

const CLAY = hex('#E8E2D8'), TIMBER = hex('#D8B78C'), SHADOW = hex('#3A2A1E');
// key light from the upper left and slightly in front, as in a studio clay render
const LIGHT = (() => { const v = [-0.55, -0.62, 0.56], m = Math.hypot(...v); return v.map((c) => c / m); })();
const HALF = (() => { const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], m = Math.hypot(...v); return v.map((c) => c / m); })();

/**
 * A piece as a sculpted study model rather than a grey photo. The real piece's shading is
 * kept (its cushions, arms, folds and the way the light falls across it) but its material is
 * cancelled out: each pixel is divided by the piece's local average brightness, so dark leather
 * and pale bouclé become the same matte clay, and fine texture (weave, grain, print) is
 * smoothed away. A slight rounding at the silhouette, a key light sheen and occlusion at the
 * base finish the model. Returns clay, timber and a contact shadow for the floor beneath it.
 */
function sculpt(fullPx, maskPx, W, id, b) {
  const { x, y, w, h } = b, N = w * h;
  // blue channel: the object alone (see build-film-layers.mjs), so the clay follows its outline
  const a = new Float32Array(N), La = new Float32Array(N);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const s = ((y + yy) * W + x + xx) * 4, i = yy * w + xx;
    if (maskPx[s] !== id) continue;
    const al = maskPx[s + 2] / 255;
    a[i] = al; La[i] = al * (0.3 * fullPx[s] + 0.59 * fullPx[s + 1] + 0.11 * fullPx[s + 2]) / 255;
  }
  // normalised blurs, inside the object only, so the floor around it never bleeds in
  const nblur = (r, n) => { let v = La, m = a; for (let k = 0; k < n; k++) { v = boxBlur(v, w, h, r); m = boxBlur(m, w, h, r); } return [v, m]; };
  const [sv, sm] = nblur(Math.max(1, Math.round(W / 640)), 2);   // texture smoothed away
  const [av, am] = nblur(Math.max(4, Math.round(W / 48)), 2);    // the material's own brightness
  // a little roundness at the silhouette
  const rV = Math.max(2, Math.round(W / 200));
  const hgt = boxBlur(boxBlur(a, w, h, rV), w, h, rV);
  const k = W / 48;
  const clay = new Uint8ClampedArray(N * 4), wood = new Uint8ClampedArray(N * 4), shadow = new Uint8ClampedArray(N * 4);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = yy * w + xx, o = i * 4;
    const xl = Math.max(0, xx - 1), xr = Math.min(w - 1, xx + 1), yu = Math.max(0, yy - 1), yd = Math.min(h - 1, yy + 1);
    let nx = -(hgt[yy * w + xr] - hgt[yy * w + xl]) * k, ny = -(hgt[yd * w + xx] - hgt[yu * w + xx]) * k, nz = 1;
    const m = Math.hypot(nx, ny, nz); nx /= m; ny /= m; nz /= m;
    const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const spec = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 24);
    // the real piece's light and shade, with its material divided out
    const sL = sm[i] > 0.02 ? sv[i] / sm[i] : 0, aL = am[i] > 0.02 ? av[i] / am[i] : 1;
    const form = Math.pow(Math.min(1.45, Math.max(0.3, sL / Math.max(0.04, aL))), 1.6);
    const occ = (1 - 0.24 * ss(0.7, 1, yy / h)) * (0.84 + 0.16 * ss(0.2, 0.6, hgt[i]));
    const shade = Math.min(1.12, (0.1 + 0.68 * form + 0.28 * lam) * occ);
    const grain = 1 + 0.045 * Math.sin((xx * 0.9 + yy * 0.12) + 3 * Math.sin(yy * 0.05 + xx * 0.013));
    for (let e = 0; e < 3; e++) {
      clay[o + e] = CLAY[e] * shade + 255 * 0.22 * spec;
      wood[o + e] = TIMBER[e] * shade * grain + 255 * 0.12 * spec;
      shadow[o + e] = SHADOW[e];
    }
    clay[o + 3] = wood[o + 3] = a[i] * 255;
  }
  // contact shadow: the silhouette, dropped a little and spread, darkest at the base
  const rS = Math.max(4, Math.round(W / 90)), drop = Math.round(h * 0.035);
  const sh = boxBlur(boxBlur(a, w, h, rS), w, h, rS);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const src = Math.max(0, yy - drop) * w + xx;
    shadow[(yy * w + xx) * 4 + 3] = 255 * 0.42 * sh[src] * (0.35 + 0.65 * ss(0.45, 1, yy / h));
  }
  return { clay: toCanvas(clay, w, h), wood: toCanvas(wood, w, h), shadow: toCanvas(shadow, w, h) };
}

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
    return { ...b, full: layer(fullPx), ink: layer(F.ink), ...sculpt(fullPx, maskPx, W, id, b) };
  });
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
    sg.globalCompositeOperation = 'copy'; sg.drawImage(p.clay, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    const band = Math.sin(Math.PI * k);
    sg.fillStyle = edge('diag', p.w, p.h, k, 0.38, [[0, 'rgba(255,250,240,0)'], [0.18, `rgba(255,250,240,${0.85 * band})`], [0.55, 'rgba(255,250,240,0)']]);
    sg.fillRect(0, 0, p.w, p.h);
    g.globalCompositeOperation = 'screen'; g.drawImage(scratch, 0, 0, p.w, p.h, p.x, p.y, p.w, p.h); g.globalCompositeOperation = 'source-over';
  };

  const n = pieces.length;
  const at = (span, i, len) => span[0] + (span[1] - span[0] - len) * (n > 1 ? i / (n - 1) : 0.5);

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
    const lineA = 1 - 0.55 * ss(BUILD.shell[1], BUILD.pieces[0] + 0.08, u) - 0.45 * ss(BUILD.finish[0], BUILD.finish[1] - 0.04, u);
    wipe(g, shellInk, 0, 0, W, H, ss(...BUILD.lines, u), 'up', lineA);
    // each piece, back of the room first
    const len = 0.13, dlen = 0.11;
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      const k = (u - at(BUILD.pieces, i, len)) / len;
      if (k <= 0) continue;
      const kd = ss(0, 1, (u - at(BUILD.dress, i, dlen)) / dlen);
      if (kd < 1) {
        // the model sits on the floor: its shadow arrives with it and hands over to the real one
        const shA = ss(0.25, 0.7, k) * (1 - kd);
        if (shA > 0) { g.globalAlpha = shA; g.drawImage(p.shadow, p.x, p.y); g.globalAlpha = 1; }
        wipe(g, p.wood, p.x, p.y, p.w, p.h, ss(0.22, 0.7, k), 'up');
        wipe(g, p.clay, p.x, p.y, p.w, p.h, ss(0.55, 1, k), 'up', 1, 0.45);
      }
      reveal(g, p, kd);
      // the outline leads, then gives way to the clay form
      const inkA = (1 - ss(0.6, 0.95, k)) * (1 - kd);
      wipe(g, p.ink, p.x, p.y, p.w, p.h, ss(0, 0.45, k), 'up', inkA);
    }
    // settle onto the exact frame the film carries on from
    const end = ss(BUILD.dress[1] - 0.05, BUILD.dress[1], u);
    if (end > 0) { g.globalAlpha = end; g.drawImage(fullC, 0, 0); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  return { W, H, full: meta.full, paint };
}
