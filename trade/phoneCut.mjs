// The phone cut of a hero film (scripts/build-film-frames.mjs renders it, PhoneFilm in
// app.ts plays it). From the film's timeline (TL) it keeps the blueprint rising into the
// clay model, then zooms into the same room already furnished and in colour (skipping the
// empty room and the furniture arriving piece by piece), then turns to night, quicker
// than the desktop film. Returns the two source ranges with their speeds and the cut's own
// timeline: chapter starts, when night falls and its length (seconds).
export const PHONE_CLAY_SPEED = 1.5, PHONE_HOLD_SPEED = 0.85, PHONE_NIGHT_SPEED = 1.3, PHONE_FADE = 1.2;

/** The settings a phone cut was made with; phone.sha1 hashes the film with this, so a stale cut is caught. */
export const phoneCutSignature = (TL) =>
  JSON.stringify([TL, PHONE_CLAY_SPEED, PHONE_HOLD_SPEED, PHONE_NIGHT_SPEED, PHONE_FADE, 'push-0.18', 'crf26']);

export function phoneCut(TL, darkRoom = false) {
  const plan = TL.ch[1], clayEnd = TL.ch[2] - 1.2, furnished = TL.hot[0][0], night = TL.ch[4];
  const clayLen = plan + (clayEnd - plan) / PHONE_CLAY_SPEED;
  const at = clayLen - PHONE_FADE; // the zoom into colour starts here
  const nightAt = at + (night - furnished) / PHONE_HOLD_SPEED;
  const total = nightAt + (TL.total - night) / PHONE_NIGHT_SPEED;
  return {
    clay: { plan, end: clayEnd },
    color: { start: furnished, night, end: TL.total },
    ch: [0, plan, at - 0.3, at + PHONE_FADE, nightAt + 0.6],
    dark: darkRoom ? at + PHONE_FADE / 2 : nightAt + (TL.dark - night) / PHONE_NIGHT_SPEED,
    total,
  };
}
