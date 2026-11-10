// Finds every piece of furniture in each hero room as its own clean outline, for the clay
// furnishing the hero paints between the empty and the furnished frames (trade/filmBuild.ts).
//
//   node scripts/build-film-sketches.mjs [film-key ...]
//
// Run after build-film-layers.mjs. Four small models run here, at build time only (nothing is
// shipped to the site):
//   - SlimSAM (Xenova/slimsam-77-uniform) finds each object's outline: every chair, the sofa,
//     each table and lamp, prompted with a grid of points over the furniture mask.
//   - CLIP (Xenova/clip-vit-base-patch32) names each outline: furniture and things in the room,
//     plants, and what is only a reflection or a scrap, which is left out. It also tells a group
//     (a table with its chairs) from one piece, and joins the parts of one piece found apart.
//   - Depth Anything V2 (onnx-community/depth-anything-v2-small) cuts reflections in a polished
//     floor away from the pieces standing on it.
//   - "Informative drawings" (line-art.onnx) draws each object, cut out on white paper; its ink
//     also shows which filled-in areas are only texture.
// Each outline is then snapped to the photo's own edges.
//
// Writes public/trade/f/<film>/b/objects.png (R = object number, G = alpha), meta.objects (each
// with its kind, back of the room first), sketch.png (an atlas of every object's drawing: A =
// ink, R = stroke order) and roomlines.png (the empty room's drawing). The models are fetched
// from Hugging Face on first run and cached in node_modules/.cache/film-models.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env, SamModel, AutoProcessor, RawImage, pipeline } from '@huggingface/transformers';
import ort from 'onnxruntime-node';
import sharp from 'sharp';

const root = path.resolve('public/trade/f');
const cache = path.resolve('node_modules/.cache/film-models');
const lineArtPath = path.join(cache, 'line-art.onnx');
// rocca/informative-drawings-line-art-onnx, pinned by its hash
const LINE_ART = { url: 'https://huggingface.co/rocca/informative-drawings-line-art-onnx/resolve/main/model.onnx', sha256: '1fef40b8f7126d827e30fbebccf95ae9b0b391795df926bf9366a821bad4f498' };
if (!existsSync(lineArtPath)) {
  const r = await globalThis.fetch(LINE_ART.url);
  if (!r.ok) throw new Error(`line-art model download failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (createHash('sha256').update(buf).digest('hex') !== LINE_ART.sha256) throw new Error('line-art model hash mismatch');
  mkdirSync(cache, { recursive: true }); writeFileSync(lineArtPath, buf);
}
env.cacheDir = cache;

const films = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, 'b', 'meta.json'))).map((d) => d.name);

const SAM = 'Xenova/slimsam-77-uniform';
const sam = await SamModel.from_pretrained(SAM, { dtype: 'fp32' });
const processor = await AutoProcessor.from_pretrained(SAM);
const lineArt = await ort.InferenceSession.create(lineArtPath);
const clip = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { dtype: 'q8' });
const depth = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' });

/** Relative depth of an image (larger is nearer), at W×H. */
async function depthMap(file, W, H) {
  const { predicted_depth: t } = await depth(await RawImage.read(file));
  const [h, w] = t.dims.slice(-2), d = t.data, o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / W - 0.5)), fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / H - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    o[y * W + x] = (d[y0 * w + x0] * (1 - tx) + d[y0 * w + x1] * tx) * (1 - ty) + (d[y1 * w + x0] * (1 - tx) + d[y1 * w + x1] * tx) * ty;
  }
  return o;
}

/**
 * Edge-aware refinement of a mask p against a guide image I (He et al.'s guided filter): the
 * outline snaps to the photo's own edges, so leaves, spindles and rims are cut cleanly instead
 * of following SAM's coarse mask.
 */
function guided(I, p, w, h, r, eps) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r), mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r);
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i]; A[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps); B[i] = mp[i] - A[i] * mI[i]; }
  const mA = boxBlur(A, w, h, r), mB = boxBlur(B, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, mA[i] * I[i] + mB[i]));
  return q;
}

// What CLIP may call an outline, in three groups; the best single label decides
const KINDS = {
  piece: ['a chair', 'an armchair', 'a bar stool', 'a stool', 'a sofa', 'an ottoman', 'a pouf', 'a bench', 'a table', 'a coffee table', 'a side table',
    'a cushion', 'a rug', 'a lamp', 'a pendant light', 'a wall light', 'a shelf', 'a bowl', 'a cabinet', 'a counter', 'a mirror', 'a painting', 'books', 'a basket', 'a sculpture'],
  plant: ['a potted plant', 'a tree in a pot', 'a topiary', 'an olive tree', 'leaves', 'a bouquet of flowers'],
  none: ['a reflection on a shiny floor', 'a patch of floor', 'a shadow on the floor'],
};
const LABELS = Object.values(KINDS).flat();
// when SAM's widest outline might be a group of things rather than one
const GROUP = ['a group of chairs around a table', 'several chairs', 'a dining set', 'several vases on a shelf', 'a collection of objects', 'bottles and jars on a counter'];
const PART = ['a cushion', 'the back of a chair', 'the arm of a chair', 'a seat cushion', 'a chair leg', 'part of a sofa'];
const SINGLE = ['one armchair', 'one chair', 'one sofa', 'one table', 'one lamp', 'one vase', 'one bar stool', 'one cabinet', 'one plant'];
/**
 * Names an object cut out on white (m its mask): piece, plant or none. CLIP alone calls green
 * velvet an olive tree, so a plant must also be busy at a fine scale, leaf against leaf; and an
 * outline is only left out when CLIP is fairly sure it is a reflection or a shadow.
 */
async function kindOf(rgb, m, w, h) {
  const [top] = await clip(new RawImage(new Uint8ClampedArray(rgb), w, h, 3), LABELS);
  let kind = Object.keys(KINDS).find((k) => KINDS[k].includes(top.label));
  const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = (0.3 * rgb[i * 3] + 0.59 * rgb[i * 3 + 1] + 0.11 * rgb[i * 3 + 2]) / 255;
  const Lb = boxBlur(L, w, h, 2); let busy = 0, n = 0; for (let i = 0; i < w * h; i++) if (m[i]) { busy += Math.abs(L[i] - Lb[i]); n++; }
  busy /= Math.max(1, n);
  if (kind === 'plant' && busy < 0.055) kind = 'piece';
  if (kind === 'none' && top.score < 0.15) kind = 'piece';
  if (process.env.KIND_DEBUG) console.log('  ', top.label, top.score.toFixed(2), 'busy=' + busy.toFixed(3), kind);
  return kind;
}

// how far in front of the empty room's floor a pixel must stand, as a fraction of the floor's nearness
const RISE = Number(process.env.RISE || 0.05);
// how steeply (per pixel, in the depth range) the empty room must come nearer to count as floor
const FLOOR_SLOPE = Number(process.env.FLOOR_SLOPE || 0.0006);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgba = async (file) => { const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { px: data, W: info.width, H: info.height }; };

function boxBlur(a, W, H, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[y * W + x] = s / n; s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / n; s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
  return o;
}

/** Line drawing of an RGB image (w×h, 3 bytes a pixel): ink 0..1 per pixel. */
async function draw(rgb, w, h) {
  const n = w * h, t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) t[c * n + i] = rgb[i * 3 + c] / 255;
  const { output } = await lineArt.run({ input: new ort.Tensor('float32', t, [1, 3, h, w]) });
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) ink[i] = 1 - Math.min(1, Math.max(0, output.data[i]));
  return ink;
}

/** Resizes a w×h channel-interleaved buffer with sharp. */
const resize = (buf, w, h, ch, W2, H2) => sharp(Buffer.from(buf), { raw: { width: w, height: h, channels: ch } }).resize(W2, H2, { fit: 'fill' }).toColourspace(ch === 1 ? 'b-w' : 'srgb').raw().toBuffer();

/**
 * The order each stroke is drawn in, 0..1: longer strokes (the outline, the main edges) start
 * first, and every stroke runs from its top end along its length, so a drawing appears the way a
 * hand draws it rather than fading in.
 */
function strokeOrder(ink, w, h, topDown = true) {
  const n = w * h, comp = new Int32Array(n).fill(-1), dist = new Float32Array(n), sizes = [], maxD = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (ink[s0] < 0.12 || comp[s0] >= 0) continue;
    const id = sizes.length, q = [s0]; comp[s0] = id; dist[s0] = 0; let md = 0;
    for (let k = 0; k < q.length; k++) {
      const p = q[k], x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx; if (comp[r] >= 0 || ink[r] < 0.12) continue;
        comp[r] = id; dist[r] = dist[p] + 1; if (dist[r] > md) md = dist[r]; q.push(r);
      }
    }
    sizes.push(q.length); maxD.push(md || 1);
  }
  // rank strokes by length: the longest is drawn first
  const rank = new Float32Array(sizes.length), byLen = sizes.map((s, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  byLen.forEach((c, i) => { rank[c] = byLen.length > 1 ? i / (byLen.length - 1) : 0; });
  const order = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (comp[i] < 0) { order[i] = 1; continue; }
    const c = comp[i], along = dist[i] / maxD[c];
    order[i] = topDown ? 0.4 * rank[c] + 0.6 * along : along;
  }
  return order;
}

/** Drops specks: any run of ink shorter than minRun pixels is texture or a reflection, not a stroke. */
function despeck(ink, w, h, minRun) {
  const seen = new Uint8Array(w * h);
  for (let s0 = 0; s0 < w * h; s0++) {
    if (seen[s0] || ink[s0] < 0.12) continue;
    const q = [s0]; seen[s0] = 1;
    for (let k = 0; k < q.length; k++) {
      const p = q[k], x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx; if (!seen[r] && ink[r] >= 0.12) { seen[r] = 1; q.push(r); }
      }
    }
    if (q.length < minRun) for (const p of q) ink[p] = 0;
  }
}

/** Packs the boxes into an atlas, shelf by shelf. */
function pack(boxes, width = 2048, gap = 2) {
  let x = 0, y = 0, row = 0;
  const at = boxes.map((b) => {
    if (x + b.w > width) { x = 0; y += row + gap; row = 0; }
    const p = { ax: x, ay: y }; x += b.w + gap; row = Math.max(row, b.h); return p;
  });
  return { at, W: width, H: y + row };
}

for (const fk of films) {
  const dir = path.join(root, fk, 'b');
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const full = await rgba(path.join(dir, 'full.webp')), mask = await rgba(path.join(dir, 'mask.png'));
  const { W, H } = full, N = W * H;

  // ---------- every object's outline ----------
  const image = await RawImage.read(path.join(dir, 'full.webp'));
  const inputs = await processor(image);
  const emb = await sam.get_image_embeddings(inputs);
  // SAM's masks cover the image resized so its long side is 1024, at a quarter of that
  const S = 1024 / Math.max(W, H) / 4, LW = Math.ceil(W * S), LH = Math.ceil(H * S);
  const furn = (x, y) => mask.px[(y * W + x) * 4 + 1] / 255;
  const lowFurn = new Float32Array(LW * LH);
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) lowFurn[y * LW + x] = furn(Math.min(W - 1, Math.round((x + 0.5) / S)), Math.min(H - 1, Math.round((y + 0.5) / S)));
  // prompts: a grid of points over the furniture
  const step = Math.round(W / 56), points = [];
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) if (furn(x | 0, y | 0) > 0.5) points.push([x, y]);
  // is an outline (low-res cells) several things, or one? CLIP looks at it cut out on white
  const isGroup = async (cells) => {
    let x0 = LW, y0 = LH, x1 = -1, y1 = -1;
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) if (cells[y * LW + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const X0 = Math.floor(x0 / S), Y0 = Math.floor(y0 / S), X1 = Math.min(W - 1, Math.ceil((x1 + 1) / S)), Y1 = Math.min(H - 1, Math.ceil((y1 + 1) / S)), w = X1 - X0 + 1, h = Y1 - Y0 + 1;
    const rgb = new Uint8ClampedArray(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const on = cells[Math.min(LH - 1, Math.floor((Y0 + y) * S)) * LW + Math.min(LW - 1, Math.floor((X0 + x) * S))], s2 = ((Y0 + y) * W + X0 + x) * 4;
      for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = on ? full.px[s2 + c] : 255;
    }
    const out = await clip(new RawImage(rgb, w, h, 3), [...GROUP, ...SINGLE]);
    return out.filter((o) => GROUP.includes(o.label)).reduce((t, o) => t + o.score, 0) > 0.5;
  };
  const cands = [];
  for (let b = 0; b < points.length; b += 48) {
    const batch = points.slice(b, b + 48);
    const p = await processor(image, { input_points: [batch.map((q) => [q])], input_labels: [batch.map(() => [1])] });
    const out = await sam({ ...emb, input_points: p.input_points, input_labels: p.input_labels });
    const [, P, M, MH, MW] = out.pred_masks.dims, md = out.pred_masks.data, sc = out.iou_scores.data;
    for (let j = 0; j < P; j++) {
      // of SAM's three guesses (a part, the object, a group), take the largest that is still
      // confident and still sits on furniture, so a chair is a whole chair and not its cushion
      const opts = [];
      for (let k = 0; k < M; k++) {
        const off = (j * M + k) * MH * MW; let area = 0, onF = 0;
        const cells = new Uint8Array(LW * LH);
        for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) if (md[off + y * MW + x] > 0) { cells[y * LW + x] = 1; area++; onF += lowFurn[y * LW + x]; }
        opts.push({ k, off, area, onF: area ? onF / area : 0, score: sc[j * M + k], cells });
      }
      const ok = opts.filter((o) => o.score > 0.82 && o.onF > 0.55 && o.area > LW * LH * 0.0006 && o.area < LW * LH * 0.16).sort((a, c) => c.area - a.area);
      // ...but not a group: when the largest is several times the next (a table with its
      // chairs, a shelf of vases), the next is the object itself
      let pickO = ok[0];
      if (ok.length > 1 && ok[0].area > ok[1].area * 2.2 && ok[1].score > 0.86 && await isGroup(ok[0].cells)) pickO = ok[1];
      if (pickO) cands.push({ ...pickO, md, MW });
    }
  }
  // one mask per object: drop near-duplicates (the same chair found from several points),
  // keep the most confident, and fold parts into the whole they belong to
  cands.sort((a, c) => c.score - a.score);
  const kept = [];
  for (const c of cands) {
    let dup = false;
    for (const k of kept) {
      let inter = 0; for (let i = 0; i < c.cells.length; i++) if (c.cells[i] && k.cells[i]) inter++;
      const union = c.area + k.area - inter;
      if (inter / union > 0.55 || inter / Math.min(c.area, k.area) > 0.85) { dup = true; if (c.area > k.area * 1.15 && c.area < k.area * 2.2 && inter / k.area > 0.85 && c.score > k.score - 0.04) Object.assign(k, c); break; }
    }
    if (!dup) kept.push(c);
  }
  // full-resolution outlines (SAM's logits, upsampled); where outlines overlap, the smaller
  // object (the one in front, or sitting on top) takes the pixel
  kept.sort((a, c) => c.area - a.area);
  const lab = new Uint16Array(N), logit = (c, x, y) => {
    const fx = Math.min(c.MW - 1, Math.max(0, (x + 0.5) * S - 0.5)), fy = Math.min(c.MW - 1, Math.max(0, (y + 0.5) * S - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(c.MW - 1, x0 + 1), y1 = Math.min(c.MW - 1, y0 + 1), tx = fx - x0, ty = fy - y0, d = c.md, o = c.off;
    return (d[o + y0 * c.MW + x0] * (1 - tx) + d[o + y0 * c.MW + x1] * tx) * (1 - ty) + (d[o + y1 * c.MW + x0] * (1 - tx) + d[o + y1 * c.MW + x1] * tx) * ty;
  };
  kept.forEach((c, n) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (logit(c, x, y) > 0) lab[y * W + x] = n + 1; });
  // Anything SAM missed (open cane chairs, a table half hidden by its chairs) is still drawn:
  // each sizeable part of a piece no outline covers becomes an object of its own.
  let nLab = kept.length;
  {
    const near = boxBlur(Float32Array.from(lab, (v) => (v ? 1 : 0)), W, H, 2), seen = new Uint8Array(N);
    const free = (i) => mask.px[i * 4] && mask.px[i * 4 + 1] > 153 && near[i] < 0.05 && !seen[i];
    for (let s0 = 0; s0 < N; s0++) {
      if (!free(s0)) continue;
      const pc = mask.px[s0 * 4], q = [s0]; seen[s0] = 1;
      for (let k = 0; k < q.length; k++) {
        const p = q[k], x = p % W;
        for (const r of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) if (r >= 0 && r < N && mask.px[r * 4] === pc && free(r)) { seen[r] = 1; q.push(r); }
      }
      if (q.length < N * 0.0015) continue;
      nLab++; for (const p of q) lab[p] = nLab;
    }
  }
  // Floor reflections: SAM outlines a piece together with its reflection in a polished floor.
  // Depth tells them apart: a reflection lies at the depth of the empty room's floor there, while
  // the piece stands in front of it. What lies low under a solid part of the same object is cut
  // away (legs, poles and cords are thin, and kept: depth misses them), and an object that is
  // nearly all reflection goes.
  let reflected = 0;
  {
    const dF = await depthMap(path.join(dir, 'full.webp'), W, H), dR = await depthMap(path.join(dir, 'room.webp'), W, H);
    // the two depth maps are relative; fit one to the other where nothing stands
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0, mx = 0;
    for (let i = 0; i < N; i += 7) if (!lab[i]) { sx += dR[i]; sy += dF[i]; sxx += dR[i] * dR[i]; sxy += dR[i] * dF[i]; n++; }
    for (let i = 0; i < N; i++) mx = Math.max(mx, dF[i]);
    const ka = (n * sxy - sx * sy) / (n * sxx - sx * sx), kb = (sy - ka * sx) / n;
    const low = new Float32Array(N);
    // nearness is relative: a far chair stands only a little in front of the floor behind it
    // and only the floor reflects: in the empty room it comes nearer row by row, where a wall
    // (and a shelf, and the counter top) keeps its distance
    const gs = Math.max(3, Math.round(H / 90)), dRs = boxBlur(dR, W, H, gs);
    const floor = (i) => { const y = (i / W) | 0; if (y < gs || y >= H - gs) return y >= H - gs; return (dRs[i + gs * W] - dRs[i - gs * W]) / mx > FLOOR_SLOPE * gs; };
    for (let i = 0; i < N; i++) if (lab[i] && floor(i)) { const fl = Math.max(mx * 0.05, ka * dR[i] + kb); low[i] = (dF[i] - fl) / fl < RISE ? 1 : 0; }
    if (process.env.DEPTH_DEBUG) {
      const o = Buffer.alloc(N * 3); for (let i = 0; i < N; i++) { const f = floor(i); o[i * 3] = low[i] ? 255 : lab[i] ? 60 : 0; o[i * 3 + 1] = lab[i] && !low[i] ? 255 : 0; o[i * 3 + 2] = f ? 160 : 0; }
      await sharp(o, { raw: { width: W, height: H, channels: 3 } }).jpeg().toFile(path.join(process.env.DEPTH_DEBUG, fk + '-depth.jpg'));
    }
    const rO = Math.max(3, Math.round(W / 260));
    const wide = boxBlur(boxBlur(low, W, H, rO).map((v) => (v > 0.92 ? 1 : 0)), W, H, rO).map((v) => (v > 0.08 ? 1 : 0));
    const before = new Uint32Array(nLab + 1), lowN = new Uint32Array(nLab + 1);
    for (let i = 0; i < N; i++) if (lab[i]) { before[lab[i]]++; if (wide[i] && low[i]) lowN[lab[i]]++; }
    const gone = new Uint8Array(nLab + 1); for (let id = 1; id <= nLab; id++) if (before[id] && lowN[id] > before[id] * 0.7) { gone[id] = 1; reflected++; }
    const solid = new Uint8Array(nLab + 1);
    for (let x = 0; x < W; x++) {
      solid.fill(0);
      for (let y = 0; y < H; y++) {
        const i = y * W + x, id = lab[i]; if (!id) continue;
        if (gone[id]) { lab[i] = 0; continue; }
        if (!low[i]) solid[id] = 1; else if (wide[i] && solid[id]) lab[i] = 0;
      }
    }
    // what the cut leaves loose (a drop of a leg's reflection, a speck) goes with it
    const comp = new Int32Array(N).fill(-1), sizes = [], owner = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!lab[s0] || comp[s0] >= 0) continue;
      const id = lab[s0], c = sizes.length, q = [s0]; comp[s0] = c;
      for (let k = 0; k < q.length; k++) { const pI = q[k], x = pI % W; for (const r of [x > 0 ? pI - 1 : -1, x < W - 1 ? pI + 1 : -1, pI - W, pI + W]) if (r >= 0 && r < N && comp[r] < 0 && lab[r] === id) { comp[r] = c; q.push(r); } }
      sizes.push(q.length); owner.push(id);
    }
    const biggest = new Uint32Array(nLab + 1); sizes.forEach((z, c) => { if (z > biggest[owner[c]]) biggest[owner[c]] = z; });
    for (let i = 0; i < N; i++) if (lab[i] && sizes[comp[i]] < Math.max(N * 0.0002, biggest[lab[i]] * 0.04)) lab[i] = 0;
  }
  // Parts of one piece found apart (an armchair's back, its seat and an arm, split by its brass
  // frame) are joined again: neighbours that share a long border, at least one of them looking like
  // a part (a cushion, a chair back), become one object when CLIP sees them together as one piece.
  let joined = 0;
  {
    const area = new Uint32Array(nLab + 1), pairs = new Map();
    for (let i = 0; i < N; i++) {
      const a = lab[i]; if (!a) continue; area[a]++;
      const x = i % W;
      // across a seam or a thin frame between them, too
      for (const j of [1, 4, 8].flatMap((d) => [x < W - d ? i + d : -1, i + d * W < N ? i + d * W : -1])) { const b = j >= 0 ? lab[j] : 0; if (b && b !== a) { const k = a < b ? a * 65536 + b : b * 65536 + a; pairs.set(k, (pairs.get(k) || 0) + 1); } }
    }
    const root = Array.from({ length: nLab + 1 }, (_, i) => i), find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
    const cutOf = (ids) => {
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let i = 0; i < N; i++) if (ids.has(find(lab[i])) && lab[i]) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const w = x1 - x0 + 1, h = y1 - y0 + 1, rgb = new Uint8ClampedArray(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y0 + y) * W + x0 + x, on = lab[i] && ids.has(find(lab[i])); for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = on ? full.px[i * 4 + c] : 255; }
      return new RawImage(rgb, w, h, 3);
    };
    const cand = [...pairs].map(([k, n]) => [Math.floor(k / 65536), k % 65536, n]).filter(([a, b, n]) => n > 1.2 * Math.sqrt(Math.min(area[a], area[b]))).sort((p, q) => q[2] - p[2]);
    for (const [a, b] of cand) {
      const ra = find(a), rb = find(b); if (ra === rb) continue;
      const top = async (ids) => (await clip(cutOf(ids), [...GROUP, ...SINGLE, ...PART]))[0];
      const [ta, tb] = [await top(new Set([ra])), await top(new Set([rb]))];
      if (!PART.includes(ta.label) || !PART.includes(tb.label)) continue;
      const tu = await top(new Set([ra, rb]));
      if (!GROUP.includes(tu.label)) { root[rb] = ra; joined++; }
    }
    for (let i = 0; i < N; i++) if (lab[i]) lab[i] = find(lab[i]);
  }
  // each object belongs to the piece most of it sits on
  const objs = [];
  for (let id = 1; id <= nLab; id++) {
    const votes = new Map(); let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0;
    for (let i = 0; i < N; i++) {
      if (lab[i] !== id) continue; area++;
      const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const pc = mask.px[i * 4], a = mask.px[i * 4 + 1]; if (pc && a > 128) votes.set(pc, (votes.get(pc) || 0) + 1);
    }
    if (area < N * 0.0004) continue;
    const [piece, nv] = [...votes].sort((a, b) => b[1] - a[1])[0] || [0, 0];
    if (!piece || nv < area * 0.4) continue;
    // a wide, flat band across the floor is a run of reflections, not a piece
    if (x1 - x0 > W * 0.4 && y1 - y0 < (x1 - x0) * 0.3) continue;
    objs.push({ id, area, x0, y0, x1, y1, piece, filled: id > kept.length });
  }
  // back of the room first
  objs.sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0);
  const renum = new Map(objs.map((o, i) => [o.id, i + 1]));
  const OL = new Uint8Array(N); for (let i = 0; i < N; i++) OL[i] = renum.get(lab[i]) || 0;
  // ---------- each object drawn on its own ----------
  const pad = Math.round(W / 120), sheets = [], boxes = []; let dropped = 0;
  for (let n = 0; n < objs.length; n++) {
    const id = n + 1, o = objs[n];
    const x = Math.max(0, o.x0 - pad), y = Math.max(0, o.y0 - pad), w = Math.min(W, o.x1 + 1 + pad) - x, h = Math.min(H, o.y1 + 1 + pad) - y;
    // the object alone on white paper: a softened cut, so its silhouette is drawn as one line
    const m = new Float32Array(w * h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) m[yy * w + xx] = OL[(y + yy) * W + x + xx] === id ? 1 : 0;
    const mSoft = boxBlur(m, w, h, 1);
    // what it is: a reflection or a scrap is left out
    const cut = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { const s2 = (((y + ((i / w) | 0)) * W) + x + (i % w)) * 4, a = mSoft[i]; for (let c = 0; c < 3; c++) cut[i * 3 + c] = full.px[s2 + c] * a + 255 * (1 - a); }
    const kind = await kindOf(cut, m, w, h);
    if (process.env.KIND_DEBUG) console.log('    #' + id, x, y, w, h, kind);
    if (kind === 'none') { OL.forEach((v, i) => { if (v === id) OL[i] = 0; }); dropped++; continue; }
    // Dark materials (walnut, leather, black steel) would be drawn as solid shading; lift the
    // object's tones first so the drawing is its form, not its colour.
    let lum = 0, cnt = 0;
    for (let i = 0; i < w * h; i++) if (m[i]) { const s2 = (((y + ((i / w) | 0)) * W) + x + (i % w)) * 4; lum += (0.3 * full.px[s2] + 0.59 * full.px[s2 + 1] + 0.11 * full.px[s2 + 2]) / 255; cnt++; }
    lum = cnt ? lum / cnt : 0.6;
    const gamma = lum < 0.42 ? Math.log(0.5) / Math.log(Math.max(0.05, lum)) : 1;
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { const s2 = (((y + ((i / w) | 0)) * W) + x + (i % w)) * 4, a = mSoft[i]; for (let c = 0; c < 3; c++) rgb[i * 3 + c] = 255 * Math.pow(full.px[s2 + c] / 255, gamma) * a + 255 * (1 - a); }
    // drawn at a working size the model likes (long side 384..768, multiples of 8)
    const k = Math.min(768, Math.max(384, Math.max(w, h) * 2)) / Math.max(w, h);
    const dw = Math.max(8, Math.round((w * k) / 8) * 8), dh = Math.max(8, Math.round((h * k) / 8) * 8);
    const big = await resize(rgb, w, h, 3, dw, dh);
    const inkBig = await draw(big, dw, dh);
    const inkB = Buffer.alloc(dw * dh); for (let i = 0; i < dw * dh; i++) inkB[i] = Math.round(255 * inkBig[i]);
    const inkS = await resize(inkB, dw, dh, 1, w, h);
    // ink only on the object and its outline, never out on the floor
    const near = boxBlur(m, w, h, 2);
    const ink = new Float32Array(w * h);
    // Texture (bouclé, rug pile, a reflection in a glossy floor) draws as dense scribble. Ease
    // the ink off until the object reads as lines; an area that is only scribble even then is
    // a reflection or a shadow, not furniture, and is left out; so is a filled-in area lying flat
    // on the floor (reflections again: SAM itself outlines the rugs).
    let inside = 0, t0 = 0.12; for (let i = 0; i < w * h; i++) inside += m[i];
    const density = (t) => { let d = 0; for (let i = 0; i < w * h; i++) if (m[i]) d += ss(t, t + 0.6, inkS[i] / 255); return d / Math.max(1, inside); };
    if (o.filled && (density(t0) > 0.3 || o.y1 - o.y0 < (o.x1 - o.x0) * 0.4)) { OL.forEach((v, i) => { if (v === id) OL[i] = 0; }); continue; }
    while (t0 < 0.5 && density(t0) > 0.12) t0 += 0.06;
    for (let i = 0; i < w * h; i++) ink[i] = near[i] > 0.02 ? ss(t0, t0 + 0.6, inkS[i] / 255) : 0;
    despeck(ink, w, h, Math.max(16, Math.round(W / 60)));
    const order = strokeOrder(ink, w, h);
    const sheet = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) { if (!ink[i]) continue; sheet[i * 4] = Math.round(255 * order[i]); sheet[i * 4 + 3] = Math.round(255 * ink[i]); }
    sheets.push(sheet); boxes.push({ x, y, w, h, piece: o.piece, kind, id });
  }
  // the objects that were drawn, numbered in order
  { const re = new Map(boxes.map((b2, i) => [b2.id, i + 1])); for (let i = 0; i < N; i++) OL[i] = re.get(OL[i]) || 0; boxes.forEach((b2) => delete b2.id); }
  // a soft edge for each outline, for the hatching and shadow drawn at runtime
  const objPng = Buffer.alloc(N * 4);
  {
    // each outline snapped to the photo's edges; a pixel already another object's stays theirs
    const Lum = new Float32Array(N); for (let i = 0; i < N; i++) Lum[i] = (0.3 * full.px[i * 4] + 0.59 * full.px[i * 4 + 1] + 0.11 * full.px[i * 4 + 2]) / 255;
    const out = OL.slice(), al = new Float32Array(N), rG = Math.max(2, Math.round(W / 420));
    boxes.forEach((b, n) => {
      const id = n + 1, p = new Float32Array(b.w * b.h), I = new Float32Array(b.w * b.h);
      for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) { const i = (b.y + yy) * W + b.x + xx; p[yy * b.w + xx] = OL[i] === id ? 1 : 0; I[yy * b.w + xx] = Lum[i]; }
      const q = guided(I, p, b.w, b.h, rG, 0.0015);
      for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
        const i = (b.y + yy) * W + b.x + xx, v = q[yy * b.w + xx];
        if (OL[i] === id) { if (v < 0.4) out[i] = 0; else al[i] = ss(0.4, 0.75, v); }
        else if (!OL[i] && v > 0.6 && !out[i]) { out[i] = id; al[i] = ss(0.4, 0.75, v); }
      }
    });
    for (let i = 0; i < N; i++) { objPng[i * 4] = out[i]; objPng[i * 4 + 1] = out[i] ? Math.round(255 * al[i]) : 0; objPng[i * 4 + 3] = 255; }
  }


  const atlas = pack(boxes);
  const atlasPx = Buffer.alloc(atlas.W * Math.max(1, atlas.H) * 4);
  boxes.forEach((b, n) => {
    const { ax, ay } = atlas.at[n];
    for (let yy = 0; yy < b.h; yy++) sheets[n].copy(atlasPx, ((ay + yy) * atlas.W + ax) * 4, yy * b.w * 4, (yy + 1) * b.w * 4);
    Object.assign(b, atlas.at[n]);
  });

  // ---------- the empty room, drawn the same way ----------
  const rw = Math.round(W / 8) * 8, rh = Math.round(H / 8) * 8;
  const rgbRoom = await sharp(path.join(dir, 'room.webp')).removeAlpha().resize(rw, rh, { fit: 'fill' }).raw().toBuffer();
  const roomInkB = Buffer.from((await draw(rgbRoom, rw, rh)).map((v) => Math.round(255 * v)));
  const roomInk = await resize(roomInkB, rw, rh, 1, W, H);
  const roomPng = Buffer.alloc(N * 4);
  {
    const ink = new Float32Array(N);
    for (let i = 0; i < N; i++) ink[i] = ss(0.15, 0.8, roomInk[i] / 255);
    despeck(ink, W, H, Math.max(16, Math.round(W / 60)));
    // only the ink is kept: the room draws up from the floor with a wipe at runtime
    for (let i = 0; i < N; i++) roomPng[i * 4 + 3] = Math.round(255 * ink[i]);
  }

  await sharp(objPng, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(dir, 'objects.png'));
  await sharp(atlasPx, { raw: { width: atlas.W, height: Math.max(1, atlas.H), channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(dir, 'sketch.png'));
  await sharp(roomPng, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(dir, 'roomlines.png'));
  meta.objects = boxes;
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  console.log(`${fk}: ${boxes.length} objects drawn, ${boxes.filter((b) => b.kind === 'plant').length} of them plants (${points.length} prompts, ${kept.length} outlines, ${nLab - kept.length} filled in, ${dropped} left out as reflections or scraps, ${reflected} as reflections by depth, ${joined} parts joined)`);
}
