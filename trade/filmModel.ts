/* eslint-disable */
// @ts-nocheck
// The clay model raised out of the plan, painted live on scroll over the film's opening.
//
//   the plan → it gives way to the model's bare floor, every wall and piece drawn flat on it as
//   in the plan → the walls rise out of the floor into the clay model → each piece of furniture
//   rises out of its footprint, one after another from the back of the room → the clay model,
//   exactly the film's frame, where the film carries on and dives into the room.
//
// Built from the layers scripts/build-film-model.mjs cuts out of the film's clay model.

export const MODEL = {
  plan: [0, 0.14],     // the plan gives way to the flat model
  walls: [0.1, 0.46],  // the walls rise
  pieces: [0.4, 0.9],  // each piece rises, back of the room first
};

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const INK = [52, 46, 40];

/** Loads a film's model layers and returns a painter for any point u ∈ [0,1] of the raising. */
export async function loadModel(base) {
  const [meta, plan, clay, flat, walls, objs] = await Promise.all([
    fetch(base + 'model/model.json').then((r) => { if (!r.ok) throw new Error('no model'); return r.json(); }),
    img(base + 'plan.webp'), img(base + 'clay.webp'), img(base + 'model/flat.webp'), img(base + 'model/walls.webp'), img(base + 'model/mobjects.png'),
  ]);
  const W = meta.w, H = meta.h;
  const draw = (im) => { const c = canvas(W, H); c.getContext('2d').drawImage(im, 0, 0, W, H); return c; };
  const planC = draw(plan), clayC = draw(clay), flatC = draw(flat), wallC = draw(walls);
  const px = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const wallPx = px(wallC), objPx = px(draw(objs)), clayPx = px(clayC);
  // the walls in ink: how they are drawn in the plan, before they rise
  const wallInk = (() => { const c = canvas(W, H), g = c.getContext('2d'), d = g.createImageData(W, H); for (let i = 0; i < W * H; i++) { d.data[i * 4] = INK[0]; d.data[i * 4 + 1] = INK[1]; d.data[i * 4 + 2] = INK[2]; d.data[i * 4 + 3] = wallPx[i * 4 + 3]; } g.putImageData(d, 0, 0); return c; })();
  // each column's runs of wall, bottom up: a wall rises from where it stands on the floor
  const runs = [];
  for (let x = 0; x < W; x++) {
    const col = []; let top = -1;
    for (let y = 0; y <= H; y++) { const on = y < H && wallPx[(y * W + x) * 4 + 3] > 40; if (on && top < 0) top = y; if (!on && top >= 0) { if (y - top > 1) col.push([top, y]); top = -1; } }
    runs.push(col);
  }
  // every piece cut out of the clay, with its footprint in ink
  const pieces = meta.objects.map((b, n) => {
    const id = n + 1, { x, y, w, h } = b, c = canvas(w, h), ci = canvas(w, h), g = c.getContext('2d'), gi = ci.getContext('2d');
    const d = g.createImageData(w, h), di = gi.createImageData(w, h); let base = y;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const s = ((y + yy) * W + x + xx) * 4, o = (yy * w + xx) * 4;
      if (objPx[s] !== id) continue;
      const a = objPx[s + 1];
      d.data[o] = clayPx[s]; d.data[o + 1] = clayPx[s + 1]; d.data[o + 2] = clayPx[s + 2]; d.data[o + 3] = a;
      di.data[o] = INK[0]; di.data[o + 1] = INK[1]; di.data[o + 2] = INK[2]; di.data[o + 3] = a;
      if (a > 128) base = Math.max(base, y + yy);
    }
    g.putImageData(d, 0, 0); gi.putImageData(di, 0, 0);
    return { ...b, c, ink: ci, base: base + 1 };
  });
  const n = pieces.length, [p0, p1] = MODEL.pieces, len = Math.min(0.2, ((p1 - p0) * 3) / Math.max(1, n));
  pieces.forEach((p, i) => { p.t0 = p0 + (p1 - p0 - len) * (n > 1 ? i / (n - 1) : 0); });
  // the lowest a piece ever sits while flat: a footprint, as in the plan
  const FLAT = 0.05, LINE = Math.max(2, Math.round(W / 480));

  /** Paints the raising at u into a 2D context of W×H. */
  const paint = (g, u) => {
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.setTransform(1, 0, 0, 1, 0, 0);
    if (u >= 1) { g.drawImage(clayC, 0, 0); return; }
    g.drawImage(flatC, 0, 0);
    // the walls rise from the floor, in a wave from the left
    const [w0, w1] = MODEL.walls, span = (w1 - w0) * 0.7, lag = (w1 - w0) * 0.3;
    for (let x = 0; x < W; x++) {
      const col = runs[x]; if (!col.length) continue;
      const k = ss(w0 + (lag * x) / W, w0 + (lag * x) / W + span, u);
      for (const [top, bot] of col) {
        // flat, a wall is the line it stands on, drawn in ink as the plan draws it
        const h = bot - top, dh = Math.max(LINE, h * k);
        g.drawImage(wallC, x, top, 1, h, x, bot - dh, 1, dh);
        const ink = 1 - ss(0, 0.3, k);
        if (ink > 0.01) { g.globalAlpha = ink * 0.7; g.drawImage(wallInk, x, bot - 1, 1, 1, x, bot - dh, 1, dh); g.globalAlpha = 1; }
      }
    }
    // each piece rises out of its footprint, back of the room first
    for (const p of pieces) {
      const k = ss(p.t0, p.t0 + len, u), sy = FLAT + (1 - FLAT) * k;
      // footprints appear with the plan, rise in turn
      g.save(); g.translate(0, p.base); g.scale(1, sy); g.translate(0, -p.base);
      g.globalAlpha = ss(MODEL.plan[0] + 0.04, MODEL.plan[1], u);
      g.drawImage(p.c, p.x, p.y);
      const ink = 1 - ss(0, 0.45, k);
      if (ink > 0.01) { g.globalAlpha *= ink * 0.45; g.drawImage(p.ink, p.x, p.y); }
      g.restore(); g.globalAlpha = 1;
    }
    // the plan itself, giving way to the model laid out flat
    const planA = 1 - ss(...MODEL.plan, u);
    if (planA > 0) { g.globalAlpha = planA; g.drawImage(planC, 0, 0); g.globalAlpha = 1; }
    // settle onto the exact frame the film carries on from
    const end = ss(MODEL.pieces[1], 1, u);
    if (end > 0) { g.globalAlpha = end; g.drawImage(clayC, 0, 0); g.globalAlpha = 1; }
  };
  return { W, H, paint };
}
