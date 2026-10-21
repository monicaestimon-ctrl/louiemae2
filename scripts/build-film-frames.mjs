// Cuts each House of Louie Mae hero film into the frame sequence phones scrub through.
//
//   node scripts/build-film-frames.mjs [film-key ...]
//
// iOS Safari only paints frames of a <video> that has played, so scroll-scrubbing the
// film leaves a black hero on iPhone (and Low Power Mode blocks playback outright).
// Phones draw these stills to a canvas instead: a 3:4 centre crop of every sixth frame
// (4 per second of film), which matches what a portrait screen shows of the 16:9 film.
// Needs ffmpeg on PATH. Commit the output in public/trade/f/<film>/m/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/trade/f');
const STEP = 6; // source frames per still (24 fps film → 4 stills per second)
const films = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'scenes').map((d) => d.name);

for (const film of films) {
  const out = path.join(root, film, 'm');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  execFileSync('ffmpeg', [
    '-v', 'error',
    '-i', path.join(root, film, 'film.mp4'),
    '-vf', `select='not(mod(n\\,${STEP}))',crop=ih*3/4:ih:(iw-ih*3/4)/2:0`,
    '-fps_mode', 'vfr',
    '-start_number', '0',
    '-c:v', 'libwebp', '-quality', '55', '-compression_level', '6',
    path.join(out, '%03d.webp'),
  ]);
  console.log(`${film}: ${readdirSync(out).length} frames`);
}
