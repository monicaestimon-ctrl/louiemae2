// Cuts the five chapter clips phones show for each House of Louie Mae hero film.
//
//   node scripts/build-film-frames.mjs [film-key ...]
//
// On phones the film is told as five chapters you swipe through (PhoneStory in
// trade/app.ts) instead of being scrubbed by scroll. Each chapter is its own short clip,
// cut at the chapter boundaries in the film's timeline (TL) in trade/app.ts: the plan, the
// clay model, the finished room, the furniture arriving and the room after dark. Clips are
// 4:3 centre crops at the film's full resolution (960×720), so a phone shows them sharp
// rather than a thin slice of the landscape film blown up to full height.
//
// Writes public/trade/f/<film>/s/<k>.mp4, <k>.webp (its first frame, the poster) and
// <k>-end.webp (its last frame, shown once played or when motion is reduced) for k = 0…4,
// and film.sha1 (the film they were cut from; trade/filmFrames.test.ts fails if a film
// changes without re-running this). Needs ffmpeg on PATH. Commit the output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/trade/f');
const app = readFileSync('trade/app.ts', 'utf8');
const timelines = Object.fromEntries(
  [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'[^\n]*?TL:(\{"total".*?\}\}),\n/g)].map((m) => [m[1], JSON.parse(m[2])]),
);

/** Each chapter's [start, end] in the film (seconds); keep in step with chapterClips in trade/app.ts. */
const chapterClips = (TL) => [[0, TL.ch[1]], [TL.ch[1], TL.ch[2]], [TL.ch[2], TL.ch[3]], [TL.ch[3], TL.hot[0][1]], [TL.hot[0][1], TL.total]];
const CROP = 'crop=ih*4/3:ih:(iw-ih*4/3)/2:0';
const still = (src, t, out) =>
  execFileSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', src, '-frames:v', '1', '-vf', CROP, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', out]);

const films = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(timelines);
for (const film of films) {
  const TL = timelines[film];
  if (!TL) throw new Error(`No timeline for ${film} in trade/app.ts`);
  const src = path.join(root, film, 'film.mp4');
  const out = path.join(root, film, 's');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  chapterClips(TL).forEach(([a, b], i) => {
    execFileSync('ffmpeg', [
      '-v', 'error', '-ss', a.toFixed(3), '-t', (b - a).toFixed(3), '-i', src, '-vf', CROP, '-an',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      path.join(out, `${i}.mp4`),
    ]);
    still(src, a, path.join(out, `${i}.webp`));
    still(src, Math.max(a, b - 0.08), path.join(out, `${i}-end.webp`));
  });
  writeFileSync(path.join(out, 'film.sha1'), createHash('sha1').update(readFileSync(src)).digest('hex') + '\n');
  console.log(`${film}: 5 chapter clips`);
}
