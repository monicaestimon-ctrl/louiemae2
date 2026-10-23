// Cuts the film's clay model (seen from above, before the camera dives into the room) into the
// layers the hero raises it from: the flat floor, the walls and every piece of furniture.
//
//   node scripts/build-film-model.mjs [film-key ...]
//
// Run after `CLAY=1 node scripts/build-film-layers.mjs`, which saves the frame (clay.webp). At
// build time only (nothing is shipped to the site), with two of the models
// build-film-sketches.mjs uses:
//   - SlimSAM outlines each piece of furniture from the points that mark it in
//     scripts/film-model-hints.json (a clay model is too even for anything to name its pieces
//     reliably), and the table the model stands on from the frame's corners;
//   - Depth Anything V2 tells the floor (it comes nearer row by row) from the walls standing on it.
//
// Writes public/trade/f/<film>/b/model/flat.webp (the floor and the table with the walls and the
// furniture taken away), walls.webp (the clay frame, alpha = walls, filled in behind the pieces),
// mobjects.png (R = object number, G = alpha) and model.json ({w, h, objects: [{x, y, w, h, kind,
// name}]}, back of the room first). Models are cached in node_modules/.cache/film-models.
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env, SamModel, AutoProcessor, RawImage, pipeline } from '@huggingface/transformers';
import sharp from 'sharp';

const root = path.resolve('public/trade/f');
env.cacheDir = path.resolve('node_modules/.cache/film-models');
const hints = JSON.parse(readFileSync(path.resolve('scripts/film-model-hints.json'), 'utf8'));
const films = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, 'b', 'clay.webp'))).map((d) => d.name);

const SAM = 'Xenova/slimsam-77-uniform';
const sam = await SamModel.from_pretrained(SAM, { dtype: 'fp32' });
const processor = await AutoProcessor.from_pretrained(SAM);
const depth = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' });


function boxBlur(a, W, H, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[y * W + x] = s / n; s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / n; s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  return o;
}
const open = (m, W, H, r) => boxBlur(boxBlur(m, W, H, r).map((v) => (v > 0.92 ? 1 : 0)), W, H, r).map((v) => (v > 0.08 ? 1 : 0));
const close = (m, W, H, r) => boxBlur(boxBlur(m, W, H, r).map((v) => (v > 0.08 ? 1 : 0)), W, H, r).map((v) => (v > 0.92 ? 1 : 0));

/** Fills the pixels where keep is 0 from those around them (pull-push), so a hole reads as the surface around it. */
function inpaint(px, keep, W, H) {
  const levels = [{ w: W, h: H, c: new Float32Array(W * H * 3), a: new Float32Array(W * H) }];
  for (let i = 0; i < W * H; i++) if (keep[i]) { levels[0].a[i] = 1; for (let e = 0; e < 3; e++) levels[0].c[i * 3 + e] = px[i * 4 + e]; }
  while (levels.at(-1).w > 2 && levels.at(-1).h > 2) {
    const L = levels.at(-1), w = Math.ceil(L.w / 2), h = Math.ceil(L.h / 2), c = new Float32Array(w * h * 3), a = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sa = 0; const sc = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const X = Math.min(L.w - 1, 2 * x + dx), Y = Math.min(L.h - 1, 2 * y + dy), j = Y * L.w + X, aa = L.a[j]; sa += aa; for (let e = 0; e < 3; e++) sc[e] += L.c[j * 3 + e] * aa; }
      const i = y * w + x; a[i] = Math.min(1, sa); if (sa > 0) for (let e = 0; e < 3; e++) c[i * 3 + e] = sc[e] / sa;
    }
    levels.push({ w, h, c, a });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x, a = L.a[i]; if (a >= 1) continue;
      // the coarser level, sampled smoothly
      const fx = Math.min(U.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(U.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(U.w - 1, x0 + 1), y1 = Math.min(U.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      for (let e = 0; e < 3; e++) {
        const v = (U.c[(y0 * U.w + x0) * 3 + e] * (1 - tx) + U.c[(y0 * U.w + x1) * 3 + e] * tx) * (1 - ty) + (U.c[(y1 * U.w + x0) * 3 + e] * (1 - tx) + U.c[(y1 * U.w + x1) * 3 + e] * tx) * ty;
        L.c[i * 3 + e] = L.c[i * 3 + e] * a + v * (1 - a);
      }
      L.a[i] = 1;
    }
  }
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) out[i] = Math.round(levels[0].c[i]);
  return out;
}

for (const fk of films) {
  const dir = path.join(root, fk, 'b'), out = path.join(dir, 'model');
  mkdirSync(out, { recursive: true });
  const file = path.join(dir, 'clay.webp');
  const { data: px, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;

  const image = await RawImage.read(file);
  const emb = await sam.get_image_embeddings(await processor(image));
  const S = 1024 / Math.max(W, H) / 4;
  const logit = (c, x, y) => {
    const fx = Math.min(c.MW - 1, Math.max(0, (x + 0.5) * S - 0.5)), fy = Math.min(c.MW - 1, Math.max(0, (y + 0.5) * S - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(c.MW - 1, x0 + 1), y1 = Math.min(c.MW - 1, y0 + 1), tx = fx - x0, ty = fy - y0, d = c.md, o = c.off;
    return (d[o + y0 * c.MW + x0] * (1 - tx) + d[o + y0 * c.MW + x1] * tx) * (1 - ty) + (d[o + y1 * c.MW + x0] * (1 - tx) + d[o + y1 * c.MW + x1] * tx) * ty;
  };

  // ---------- the model and the table it stands on ----------
  // SAM finds the table from points in the frame's corners; the model is everything else
  let model;
  {
    const m = Math.round(W / 60), pts = [[m, m], [W - m, m], [m, H - m], [W - m, H - m], [W / 2, m]];
    const p = await processor(image, { input_points: [[pts]], input_labels: [[pts.map(() => 1)]] });
    const o = await sam({ ...emb, input_points: p.input_points, input_labels: p.input_labels });
    const [, , M, MH, MW] = o.pred_masks.dims, sc = o.iou_scores.data;
    let best = 0; for (let k = 1; k < M; k++) if (sc[k] > sc[best]) best = k;
    const c = { md: o.pred_masks.data, off: best * MH * MW, MW };
    const table = new Float32Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) table[y * W + x] = logit(c, x, y) > 0 ? 1 : 0;
    model = close(open(table.map((v) => 1 - v), W, H, Math.round(W / 320)), W, H, Math.round(W / 320));
  }

  // ---------- every piece of furniture ----------
  // Each is marked by a few points (scripts/film-model-hints.json); SAM outlines it from them.
  // Where two overlap, the one nearer the front (lower in the frame) takes the pixel.
  const lab = new Uint16Array(N), names = [];
  const marks = (hints[fk] || []).map((hm, n) => ({ ...hm, n: n + 1, low: Math.max(...hm.pts.map((q) => q[1])) })).sort((p, q) => p.low - q.low);
  for (const hm of marks) {
    const pr = await processor(image, { input_points: [[hm.pts]], input_labels: [[hm.pts.map(() => 1)]] });
    const o = await sam({ ...emb, input_points: pr.input_points, input_labels: pr.input_labels });
    const [, , M, MH, MW] = o.pred_masks.dims, sc = o.iou_scores.data;
    // the largest confident guess is the whole piece (a chair, not its back)...
    const opts = [];
    for (let k = 0; k < M; k++) { let area = 0; const off = k * MH * MW; for (let i = 0; i < MH * MW; i++) if (o.pred_masks.data[off + i] > 0) area++; opts.push({ k, area, score: sc[k], off }); }
    // ...but never the room around it
    const cap = MH * MW * 0.1, fits = opts.filter((q) => q.area < cap);
    const okk = fits.filter((q) => q.score > 0.8).sort((p, q) => (hm.pick === 'smallest' ? p.area - q.area : q.area - p.area)), pick = okk[0] || fits.sort((p, q) => q.score - p.score)[0];
    if (!pick) { console.warn(`  ${fk}: no outline for ${hm.name}`); continue; }
    const cm = { md: o.pred_masks.data, off: pick.off, MW };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (model[i] && logit(cm, x, y) > 0) lab[i] = hm.n; }
    names[hm.n] = hm.name;
  }

  // ---------- floor and walls ----------
  const { predicted_depth: t } = await depth(image);
  const [dh, dw] = t.dims.slice(-2), dd = t.data, dep = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dep[y * W + x] = dd[Math.min(dh - 1, Math.floor((y * dh) / H)) * dw + Math.min(dw - 1, Math.floor((x * dw) / W))];
  let mx = 0; for (let i = 0; i < N; i++) mx = Math.max(mx, dep[i]);
  const gs = Math.max(3, Math.round(H / 90)), ds = boxBlur(dep, W, H, gs);
  // the floor comes nearer row by row; a wall seen from above keeps its distance or recedes
  const floorish = new Float32Array(N);
  for (let y = gs; y < H - gs; y++) for (let x = 0; x < W; x++) { const i = y * W + x; floorish[i] = (ds[i + gs * W] - ds[i - gs * W]) / mx > Number(process.env.FLOOR_SLOPE || 0.0012) * gs ? 1 : 0; }
  let floor = close(open(floorish, W, H, Math.round(W / 200)), W, H, Math.round(W / 160));
  {
    // the room's floor is one piece; the tops of the walls, flat too, are not floor
    const comp = new Int32Array(N).fill(-1), sizes = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!floor[s0] || !model[s0] || comp[s0] >= 0) continue;
      const c = sizes.length, q = [s0]; comp[s0] = c;
      for (let k = 0; k < q.length; k++) { const p = q[k], x = p % W; for (const r of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) if (r >= 0 && r < N && floor[r] && model[r] && comp[r] < 0) { comp[r] = c; q.push(r); } }
      sizes.push(q.length);
    }
    const big = sizes.indexOf(Math.max(...sizes));
    floor = floor.map((v, i) => (v && comp[i] === big ? 1 : 0));
  }
  const objMask = new Float32Array(N), wallMask = new Float32Array(N);
  for (let i = 0; i < N; i++) { if (!model[i]) continue; if (lab[i]) objMask[i] = 1; else if (!floor[i]) wallMask[i] = 1; }
  const walls = open(wallMask, W, H, Math.max(2, Math.round(W / 400)));

  // ---------- the furniture, back of the room first ----------
  const objs = [];
  for (let id = 1; id < names.length; id++) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    for (let i = 0; i < N; i++) if (lab[i] === id) { n++; const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (n) objs.push({ id, x0, y0, x1, y1, n });
  }
  objs.sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0);
  const pad = Math.round(W / 120), boxes = [], OL = new Uint8Array(N);
  objs.forEach((o, n) => {
    for (let i = 0; i < N; i++) if (lab[i] === o.id) OL[i] = n + 1;
    const x = Math.max(0, o.x0 - pad), y = Math.max(0, o.y0 - pad);
    boxes.push({ x, y, w: Math.min(W, o.x1 + 1 + pad) - x, h: Math.min(H, o.y1 + 1 + pad) - y, kind: /plant|tree|olive|palm/.test(names[o.id]) ? 'plant' : 'piece', name: names[o.id] });
  });

  // ---------- the flat model: what is left with the walls and the furniture taken away ----------
  // the floor fills where the furniture stood (its shadows and all); where the walls stood, the
  // table behind them shows
  const nearObj = boxBlur(objMask, W, H, Math.round(W / 120));
  const floorKeep = Uint8Array.from({ length: N }, (_, i) => (floor[i] && nearObj[i] < 0.01 ? 1 : 0));
  const onFloor = inpaint(px, floorKeep, W, H);
  const onTable = inpaint(px, Uint8Array.from({ length: N }, (_, i) => (model[i] ? 0 : 1)), W, H);
  // the floor's far edge, column by column: where it meets a wall it is seen; behind a sofa
  // against the wall it is not, and is carried across from the columns either side
  const far = new Float32Array(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = 1; y < H; y++) { const i = y * W + x; if (floor[i] && nearObj[i] < 0.01) { if (walls[i - W] || !model[i - W]) far[x] = y; break; } }
  { let last = -1; for (let x = 0; x < W; x++) if (far[x] >= 0) { if (last >= 0) for (let k = last + 1; k < x; k++) far[k] = far[last] + ((far[x] - far[last]) * (k - last)) / (x - last); last = x; }
    const first = far.findIndex((v) => v >= 0); for (let k = 0; k < first; k++) far[k] = far[first]; for (let k = last + 1; k < W; k++) far[k] = far[last]; }
  const flat = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const y = (i / W) | 0, seen = floor[i] && nearObj[i] < 0.01 && y >= far[i % W] - 2;
    const src = !model[i] || seen ? null : y < far[i % W] - 2 ? onTable : onFloor;
    for (let e = 0; e < 3; e++) flat[i * 3 + e] = src ? src[i * 3 + e] : px[i * 4 + e];
  }

  // the wall behind a piece standing against it, filled in from the wall around it, so the wall
  // rises whole and the piece rises in front of it
  const behind = Uint8Array.from({ length: N }, (_, i) => (model[i] && (objMask[i] || nearObj[i] >= 0.01) && ((i / W) | 0) < far[i % W] - 2 ? 1 : 0));
  const wallFill = inpaint(px, Uint8Array.from(walls), W, H);
  const wallsPx = Buffer.alloc(N * 4), objPx = Buffer.alloc(N * 4);
  const wSoft = boxBlur(walls, W, H, 1), oSoft = boxBlur(Float32Array.from(OL, (v) => (v ? 1 : 0)), W, H, 1);
  for (let i = 0; i < N; i++) {
    for (let e = 0; e < 3; e++) wallsPx[i * 4 + e] = behind[i] && !walls[i] ? wallFill[i * 3 + e] : px[i * 4 + e];
    wallsPx[i * 4 + 3] = walls[i] ? Math.round(255 * Math.min(1, wSoft[i] * 1.3)) : behind[i] ? 255 : 0;
    objPx[i * 4] = OL[i]; objPx[i * 4 + 1] = OL[i] ? Math.round(255 * Math.min(1, oSoft[i] * 1.4)) : 0; objPx[i * 4 + 3] = 255;
  }
  await sharp(flat, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 88 }).toFile(path.join(out, 'flat.webp'));
  await sharp(wallsPx, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 88, alphaQuality: 100 }).toFile(path.join(out, 'walls.webp'));
  await sharp(objPx, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(out, 'mobjects.png'));
  writeFileSync(path.join(out, 'model.json'), JSON.stringify({ w: W, h: H, objects: boxes }));
  if (process.env.MODEL_DEBUG) {
    const o = Buffer.alloc(N * 3);
    for (let i = 0; i < N; i++) { o[i * 3] = OL[i] ? 255 : 0; o[i * 3 + 1] = walls[i] ? 220 : 0; o[i * 3 + 2] = floor[i] && model[i] ? 200 : model[i] ? 60 : 0; }
    await sharp(o, { raw: { width: W, height: H, channels: 3 } }).jpeg().toFile(path.join(process.env.MODEL_DEBUG, fk + '-model.jpg'));
  }
  console.log(`${fk}: ${boxes.length} pieces in the clay model`);
}
