// Cuts the phone version of each House of Louie Mae hero film.
//
//   node scripts/build-film-frames.mjs [film-key ...]
//
// Phones play the room film straight through as one continuous video (PhoneFilm in
// trade/app.ts) instead of scrubbing it with the scroll, and a shorter story than the
// desktop film (trade/phoneCut.mjs): the blueprint rises into the clay model, the camera
// pushes into the clay room as it dissolves into the same room furnished and in colour,
// then day turns to night. The films are landscape, so the phone cut is a 3:4 centre crop
// at the film's own resolution, lightly sharpened, without audio and with the index up
// front so it starts playing while it downloads.
//
// Writes public/trade/f/<film>/phone.mp4, phone.webp (its first frame, the poster) and
// phone.sha1 (the film and cut it was made from; trade/filmFrames.test.ts fails if either
// changes without re-running this). Needs ffmpeg on PATH. Commit the output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { phoneCut, phoneCutSignature, PHONE_CLAY_SPEED, PHONE_HOLD_SPEED, PHONE_NIGHT_SPEED, PHONE_FADE } from '../trade/phoneCut.mjs';

const root = path.resolve('public/trade/f');
const app = readFileSync('trade/app.ts', 'utf8');
const timelines = Object.fromEntries(
  [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'[^\n]*?TL:(\{"total".*?\}\}),\n/g)].map((m) => [m[1], JSON.parse(m[2])]),
);
const CROP = 'crop=ih*3/4:ih:(iw-ih*3/4)/2:0';
const f = (n) => n.toFixed(3);
// a gentle push into the room (z from 1 to 1+by over the window), rendered from 2x so slow zooms don't jitter
const push = (z) => `scale=2560:1440,zoompan=z='${z}':x='iw/2-iw/zoom/2':y='ih*0.55-ih*0.55/zoom':d=1:s=1280x720:fps=24`;

const films = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(timelines);
for (const film of films) {
  const TL = timelines[film];
  if (!TL) throw new Error(`No timeline for ${film} in trade/app.ts`);
  const dir = path.join(root, film);
  const src = path.join(dir, 'film.mp4');
  const { clay, color } = phoneCut(TL);
  const clayLen = clay.plan + (clay.end - clay.plan) / PHONE_CLAY_SPEED;
  const zin = `${f(clayLen - PHONE_FADE - 0.6)}`, zlen = `${f(PHONE_FADE + 0.6)}`, settle = `${f(PHONE_FADE + 0.8)}`;
  const graph = [
    `[0:v]trim=0:${f(clay.plan)},setpts=PTS-STARTPTS[plan]`,
    `[0:v]trim=${f(clay.plan)}:${f(clay.end)},setpts=(PTS-STARTPTS)/${PHONE_CLAY_SPEED}[clay]`,
    `[0:v]trim=${f(color.start)}:${f(color.night)},setpts=(PTS-STARTPTS)/${PHONE_HOLD_SPEED}[day]`,
    `[0:v]trim=${f(color.night)}:${f(color.end)},setpts=(PTS-STARTPTS)/${PHONE_NIGHT_SPEED}[night]`,
    `[plan][clay]concat=n=2:v=1,fps=24,format=yuv420p,${push(`1+0.18*pow(min(max((it-${zin})/${zlen},0),1),2)`)}[a]`,
    `[day][night]concat=n=2:v=1,fps=24,format=yuv420p,${push(`1.10-0.10*min(it/${settle},1)*(2-min(it/${settle},1))`)}[b]`,
    `[a][b]xfade=transition=fade:duration=${PHONE_FADE}:offset=${f(clayLen - PHONE_FADE)},${CROP},unsharp=5:5:0.5[v]`,
  ].join(';');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-filter_complex', graph, '-map', '[v]', '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(dir, 'phone.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', CROP,
    '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', path.join(dir, 'phone.webp'),
  ]);
  writeFileSync(path.join(dir, 'phone.sha1'), createHash('sha1').update(readFileSync(src)).update(phoneCutSignature(TL)).digest('hex') + '\n');
  console.log(`${film}: phone film, ${phoneCut(TL).total.toFixed(1)} s`);
}
