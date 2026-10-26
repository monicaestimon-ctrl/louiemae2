// Cuts the five chapter stills phones show for each House of Louie Mae hero film.
//
//   node scripts/build-film-frames.mjs [film-key ...]
//
// On phones the film is told as a five-chapter story you swipe through (PhoneStory in
// trade/app.ts) instead of being scrubbed by scroll. Each chapter is a resting frame read
// from the film's timeline (TL) in trade/app.ts: the finished plan, the middle of the clay
// model, the empty finished room, then the still moments when the furnished room and the
// night room hold. Stills are 3:4 centre crops, which is what a portrait
// screen shows of the 16:9 film.
//
// Writes public/trade/f/<film>/s/0.webp … 4.webp and film.sha1 (the film they were cut
// from; trade/filmFrames.test.ts fails if a film changes without re-running this).
// Needs ffmpeg on PATH. Commit the output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/trade/f');
const app = readFileSync('trade/app.ts', 'utf8');
const timelines = Object.fromEntries(
  [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'[^\n]*?TL:(\{"total".*?\}\}),\n/g)].map((m) => [m[1], JSON.parse(m[2])]),
);

/** The moment each chapter rests on (seconds). */
const chapterTimes = (TL) => [TL.ch[1] - 0.3, (TL.ch[1] + TL.ch[2]) / 2, TL.ch[3] - 0.3, TL.hot[0][0] + 0.5, TL.hot[1][0] + 0.5];

const films = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(timelines);
for (const film of films) {
  const TL = timelines[film];
  if (!TL) throw new Error(`No timeline for ${film} in trade/app.ts`);
  const src = path.join(root, film, 'film.mp4');
  const out = path.join(root, film, 's');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  chapterTimes(TL).forEach((t, i) => {
    execFileSync('ffmpeg', [
      '-v', 'error', '-ss', t.toFixed(3), '-i', src, '-frames:v', '1',
      '-vf', 'crop=ih*3/4:ih:(iw-ih*3/4)/2:0',
      '-c:v', 'libwebp', '-quality', '80', '-compression_level', '6',
      path.join(out, `${i}.webp`),
    ]);
  });
  writeFileSync(path.join(out, 'film.sha1'), createHash('sha1').update(readFileSync(src)).digest('hex') + '\n');
  console.log(`${film}: 5 chapter stills`);
}
