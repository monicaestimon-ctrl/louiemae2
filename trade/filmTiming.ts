// When each painted part of the hero happens. Loaded with the painters (trade/filmBuild.ts,
// trade/filmModel.ts) rather than at startup: until they arrive, the hero plays its film as it is.
//
// Each film is told in five parts, two of them painted live over it:
//   the plan (film) → the clay model raised out of the plan, walls first, then each piece from
//   its footprint (trade/filmModel.ts) → the camera dives into the model (film) → the room,
//   still clay, finished by one sweep of light into the real thing (trade/filmBuild.ts) → the
//   furnished room, its hotspots and the night (film).

/** The painted build, as fractions of its own scroll. */
export const BUILD = {
  enter: [0, 0.16],     // the clay room comes in as the camera lands
  finish: [0.3, 0.92],  // the sweep that finishes it
};

/** The model rising out of the plan, as fractions of its own scroll. */
export const MODEL = {
  plan: [0, 0.14],     // the plan gives way to the flat model
  walls: [0.1, 0.46],  // the walls rise
  pieces: [0.4, 0.9],  // each piece rises, back of the room first
};

// How much scroll the painted parts get, in film seconds.
const MODEL_SECS = 9, BUILD_SECS = 7;
const BUILD_CH = ['Then every piece, in clay.', 'Each one rises from its place in the plan.'];

/** Scroll timeline for a film with its painted parts: segment starts, chapter starts and copy, in scroll seconds. */
export function buildTimeline(F, model) {
  const TL = F.TL, tc = TL.ch[1] + 1.15, t1 = model ? Math.min(1, TL.ch[1] * 0.4) : tc, S1 = model ? MODEL_SECS : 0;
  const te = TL.ch[2] - 0.25, tf = TL.hot[0][0] + 0.4, S2 = BUILD_SECS;
  // scroll seconds where each part starts: model, dive, build, furnished
  const a = t1, c = a + S1, d = c + (te - tc), e = d + S2;
  return {
    t1, tc, te, tf, a, c, d, e, S1, S2, total: e + TL.total - tf,
    ch: [0, model ? a : TL.ch[1], model ? a + S1 * MODEL.pieces[0] : tc, d + S2 * BUILD.finish[0], e, e + TL.ch[4] - tf],
    copy: [F.ch[0], F.ch[1], BUILD_CH, F.ch[2], F.ch[3], F.ch[4]], shop: 4,
    dark: d + S2 * (BUILD.finish[0] + BUILD.finish[1]) / 2,
  };
}
