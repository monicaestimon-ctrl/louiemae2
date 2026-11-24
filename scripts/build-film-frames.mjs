// Cuts the phone version of each House of Louie Mae hero film.
//
//   node scripts/build-film-frames.mjs [film-key ...]
//
// Phones play the room film straight through as one continuous video (PhoneFilm in
// trade/app.ts) instead of scrubbing it with the scroll, and a shorter story than the
// desktop film (trade/phoneCut.mjs): the blueprint rises into the clay model, one
// continuous shot pushes down into the clay room while its furniture and walls take on
// their colour in place, then the furnished room turns to night.
//
// That middle shot doesn't exist in the films, so it is generated once per room
// (MiniMax H3 on Higgsfield, start frame = the film at phoneCut().clay.end, end frame =
// the film at phoneCut().color.start, both as this 3:4 crop) and kept in
// assets/phone-transitions/<film>.mp4, retimed here to one constant camera pace (see
// evenPace). Everything else is the film's own footage, a 3:4 centre crop, so the joins
// land on the same frames.
//
// Writes public/trade/f/<film>/phone.mp4, phone.webp (its first frame, the poster) and
// phone.sha1 (the film, transition and cut it was made from; trade/filmFrames.test.ts
// fails if any of them changes without re-running this). Needs ffmpeg. Commit the output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { phoneCut, phoneCutSignature, PHONE_CLAY_SPEED, PHONE_NIGHT_SPEED, PHONE_PUSH, PHONE_SETTLE } from '../trade/phoneCut.mjs';

const root = path.resolve('public/trade/f');
const app = readFileSync('trade/app.ts', 'utf8');
const films = Object.fromEntries(
  [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'([^\n]*?)TL:(\{"total".*?\}\}),\r?\n/g)].map((m) => {
    const clayAt = m[2].match(/phoneClayAt:([\d.]+)/);
    return [m[1], { TL: JSON.parse(m[3]), opts: { clayAt: clayAt ? +clayAt[1] : undefined, darkRoom: /darkRoom:true/.test(m[2]) } }];
  }),
);
const pace = JSON.parse(readFileSync('assets/phone-transitions/pace.json', 'utf8'));
// The generated shots ease in and out (fast start, slow stop). Pick their frames so the
// camera covers the same distance in every output frame until it comes to rest
// (travel measured by scripts/measure-transition-pace.py), then a short settle at 1x.
// Frames come from a motion-interpolated 96 fps copy so slowed stretches stay smooth.
const SRC_FPS = 24, MI_FPS = 96;
function evenPace(travel) {
  const total = travel[travel.length - 1];
  const stop = travel.findIndex((v) => v >= 0.97 * total);
  const at = (target) => {
    let i = 1;
    while (i < stop && travel[i] < target) i++;
    const a = travel[i - 1], b = travel[i];
    return (i - 1 + (b > a ? (target - a) / (b - a) : 0)) / SRC_FPS;
  };
  const times = [];
  const push = Math.round(PHONE_PUSH * 24), settle = Math.round(PHONE_SETTLE * 24);
  for (let k = 0; k < push; k++) times.push(at(((k + 1) / push) * travel[stop]));
  for (let k = 1; k <= settle; k++) times.push(Math.min(travel.length - 1, stop + k) / SRC_FPS);
  const picks = [];
  for (const t of times) picks.push(Math.max(Math.round(t * MI_FPS), (picks.at(-1) ?? -1) + 1));
  return picks;
}
const FIT = 'crop=ih*3/4:ih:(iw-ih*3/4)/2:0,scale=720:960:flags=lanczos,setsar=1';
const f = (n) => n.toFixed(3);

for (const film of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(films)) {
  if (!films[film]) throw new Error(`No timeline for ${film} in trade/app.ts`);
  const { TL, opts } = films[film];
  const dir = path.join(root, film);
  const src = path.join(dir, 'film.mp4');
  const morph = path.resolve('assets/phone-transitions', `${film}.mp4`);
  const { clay, color } = phoneCut(TL, opts);
  const graph = [
    `[0:v]trim=0:${f(clay.plan)},setpts=PTS-STARTPTS,fps=24,${FIT}[plan]`,
    `[0:v]trim=${f(clay.plan)}:${f(clay.end)},setpts=(PTS-STARTPTS)/${PHONE_CLAY_SPEED},fps=24,${FIT}[clay]`,
    `[1:v]setpts=PTS-STARTPTS,scale=720:960:flags=lanczos,setsar=1,minterpolate=fps=${MI_FPS}:mi_mode=mci:mc_mode=aobmc:vsbmc=1,` +
      `select='${evenPace(pace[film]).map((n) => `eq(n\\,${n})`).join('+')}',setpts=N/24/TB,fps=24[morph]`,
    `[0:v]trim=${f(color.start)}:${f(color.night)},setpts=PTS-STARTPTS,fps=24,${FIT}[day]`,
    `[0:v]trim=${f(color.night)}:${f(color.end)},setpts=(PTS-STARTPTS)/${PHONE_NIGHT_SPEED},fps=24,${FIT}[night]`,
    `[plan][clay][morph][day][night]concat=n=5:v=1,format=yuv420p,unsharp=5:5:0.4[v]`,
  ].join(';');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-i', morph, '-filter_complex', graph, '-map', '[v]', '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(dir, 'phone.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', FIT,
    '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', path.join(dir, 'phone.webp'),
  ]);
  const key = createHash('sha1').update(readFileSync(src)).update(readFileSync(morph)).update(JSON.stringify(pace[film])).update(phoneCutSignature(TL, opts));
  writeFileSync(path.join(dir, 'phone.sha1'), key.digest('hex') + '\n');
  console.log(`${film}: phone film, ${phoneCut(TL, opts).total.toFixed(1)} s`);
}
