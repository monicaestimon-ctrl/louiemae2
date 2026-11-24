// The phone cut of a hero film (scripts/build-film-frames.mjs renders it, PhoneFilm in
// app.ts plays it). From the film's timeline (TL): the blueprint rises into the clay model
// (the film's own footage), then one continuous generated shot pushes down into the clay
// room as its furniture and walls take on their colour in place
// (assets/phone-transitions/<film>.mp4, from the frame at `clayAt` to the furnished room
// at `color`), then the film's own furnished room turns to night, quicker than on desktop.
// Returns the source ranges and the cut's own timeline: chapter starts, when night falls
// and its length (seconds).
export const PHONE_CLAY_SPEED = 1.5, PHONE_NIGHT_SPEED = 1.3;
// The generated shot, retimed to one constant camera pace (scripts/build-film-frames.mjs):
// PHONE_PUSH seconds of travel, then PHONE_SETTLE seconds as the camera comes to rest.
export const PHONE_PUSH = 3.6, PHONE_SETTLE = 0.4, PHONE_MORPH = PHONE_PUSH + PHONE_SETTLE;

export function phoneCut(TL, { clayAt, darkRoom = false } = {}) {
  const plan = TL.ch[1], at = clayAt ?? TL.ch[2] - 1.54, color = TL.hot[0][0] + 0.3, night = TL.ch[4];
  const morphAt = plan + (at - plan) / PHONE_CLAY_SPEED;
  const furnished = morphAt + PHONE_MORPH;
  const nightAt = furnished + (night - color);
  const total = nightAt + (TL.total - night) / PHONE_NIGHT_SPEED;
  return {
    clay: { plan, end: at },
    color: { start: color, night, end: TL.total },
    ch: [0, plan, morphAt + 0.8, morphAt + 2.4, nightAt + 0.3],
    dark: darkRoom ? morphAt + 2.0 : nightAt + (TL.dark - night) / PHONE_NIGHT_SPEED,
    total,
  };
}

/** The settings a phone cut was made with; phone.sha1 hashes the film and transition with this. */
export const phoneCutSignature = (TL, opts = {}) =>
  JSON.stringify([TL, opts.clayAt ?? null, PHONE_CLAY_SPEED, PHONE_NIGHT_SPEED, PHONE_MORPH, '720x960', 'crf26', 'even-pace']);
