// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { phoneCutSignature } from './phoneCut.mjs';

// Phones play a shorter 3:4 cut of each hero film (scripts/build-film-frames.mjs,
// trade/phoneCut.mjs). If a film, its timeline or the cut changes without re-cutting it,
// phones show the old room or headlines out of step. The script records what it cut from,
// so any of those changes fails here.
const here = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.join(here, 'app.ts'), 'utf8');
const timelines = Object.fromEntries(
  [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'[^\n]*?TL:(\{"total".*?\}\}),\n/g)].map((m) => [m[1], JSON.parse(m[2])]),
);
const films = Object.keys(timelines);

describe('phone films', () => {
  it('finds the films in app.ts', () => {
    expect(films.length).toBeGreaterThan(0);
  });
  it.each(films)('%s has a phone cut of its current film', (film) => {
    const dir = path.join(here, '../public/trade/f', film);
    const rerun = `re-run node scripts/build-film-frames.mjs ${film}`;
    for (const f of ['phone.mp4', 'phone.webp']) expect(existsSync(path.join(dir, f)), rerun).toBe(true);
    const sha = createHash('sha1').update(readFileSync(path.join(dir, 'film.mp4'))).update(phoneCutSignature(timelines[film])).digest('hex');
    expect(readFileSync(path.join(dir, 'phone.sha1'), 'utf8').trim(), rerun).toBe(sha);
  });
});
