// Draws every piece of furniture in each hero room as its own pencil drawing.
//
//   node scripts/build-film-sketches.mjs [film-key ...]
//
// Run after build-film-layers.mjs. Two small models run here, at build time only (nothing is
// shipped to the site):
//   - SlimSAM (Xenova/slimsam-77-uniform) finds each object's exact outline: every chair, the
//     sofa, each table and lamp, prompted with a grid of points over the furniture mask.
//   - "Informative drawings" (line-art.onnx) turns each object, cut out on white paper, into a
//     clean line drawing, so every object is drawn on its own and lines never run together.
// The empty room is drawn the same way, so the whole build reads as one drawing.
//
// Writes public/trade/f/<film>/b/objects.png (R = object number, G = alpha), sketch.png (an
// atlas of every object's drawing: A = ink, R = the order its strokes are drawn in),
// roomlines.png (the empty room's drawing: A = ink) and meta.objects. Both models are fetched
// from Hugging Face on first run and cached in node_modules/.cache/film-models.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env, SamModel, AutoProcessor, RawImage } from '@huggingface/transformers';
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
      if (ok.length) cands.push({ ...ok[0], md, MW });
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
      if (inter / union > 0.55 || inter / Math.min(c.area, k.area) > 0.85) { dup = true; if (c.area > k.area * 1.15 && inter / k.area > 0.85 && c.score > k.score - 0.04) Object.assign(k, c); break; }
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
  const pad = Math.round(W / 120), sheets = [], boxes = [];
  for (let n = 0; n < objs.length; n++) {
    const id = n + 1, o = objs[n];
    const x = Math.max(0, o.x0 - pad), y = Math.max(0, o.y0 - pad), w = Math.min(W, o.x1 + 1 + pad) - x, h = Math.min(H, o.y1 + 1 + pad) - y;
    // the object alone on white paper: a softened cut, so its silhouette is drawn as one line
    const m = new Float32Array(w * h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) m[yy * w + xx] = OL[(y + yy) * W + x + xx] === id ? 1 : 0;
    const mSoft = boxBlur(m, w, h, 1);
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
    sheets.push(sheet); boxes.push({ x, y, w, h, piece: o.piece, id });
  }
  // the objects that were drawn, numbered in order
  { const re = new Map(boxes.map((b2, i) => [b2.id, i + 1])); for (let i = 0; i < N; i++) OL[i] = re.get(OL[i]) || 0; boxes.forEach((b2) => delete b2.id); }
  // a soft edge for each outline, for the hatching and shadow drawn at runtime
  const objPng = Buffer.alloc(N * 4);
  {
    const hard = new Float32Array(N); for (let i = 0; i < N; i++) hard[i] = OL[i] ? 1 : 0;
    const soft = boxBlur(hard, W, H, 1);
    for (let i = 0; i < N; i++) { objPng[i * 4] = OL[i]; objPng[i * 4 + 1] = OL[i] ? Math.round(255 * Math.min(1, soft[i] * 1.4)) : 0; objPng[i * 4 + 3] = 255; }
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
  console.log(`${fk}: ${boxes.length} objects drawn (${points.length} prompts, ${kept.length} outlines, ${nLab - kept.length} filled in)`);
}
