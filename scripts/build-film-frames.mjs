// Cuts the phone version of each House of Louie Mae hero film.
//
//   node scripts/build-film-frames.mjs [film-key ...]
//
// Phones play the room film straight through as one continuous video (PhoneFilm in
// trade/app.ts) instead of scrubbing it with the scroll. The films are landscape, so the
// phone cut is a 3:4 centre crop at the film's own resolution, lightly sharpened, without
// audio and with the index up front so it starts playing while it downloads.
//
// Writes public/trade/f/<film>/phone.mp4, phone.webp (its first frame, the poster) and
// phone.sha1 (the film it was cut from; trade/filmFrames.test.ts fails if a film changes
// without re-running this). Needs ffmpeg on PATH. Commit the output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/trade/f');
const CROP = 'crop=ih*3/4:ih:(iw-ih*3/4)/2:0';
const films = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root).filter((d) => {
      try { return readFileSync(path.join(root, d, 'film.mp4')).length > 0; } catch { return false; }
    });
for (const film of films) {
  const dir = path.join(root, film);
  const src = path.join(dir, 'film.mp4');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-vf', `${CROP},unsharp=5:5:0.5`, '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(dir, 'phone.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', CROP,
    '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', path.join(dir, 'phone.webp'),
  ]);
  writeFileSync(path.join(dir, 'phone.sha1'), createHash('sha1').update(readFileSync(src)).digest('hex') + '\n');
  console.log(`${film}: phone film`);
}
