// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phones show each hero film as five chapter stills (scripts/build-film-frames.mjs). If a
// film is replaced without re-cutting them, phones show the old room. The script records
// which film it cut from, so a changed film fails here.
const here = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.join(here, 'app.ts'), 'utf8');
const films = [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'[^\n]*?TL:\{"total"/g)].map((m) => m[1]);

describe('phone story stills', () => {
  it('finds the films in app.ts', () => {
    expect(films.length).toBeGreaterThan(0);
  });
  it.each(films)('%s has five chapter stills cut from its current film', (film) => {
    const dir = path.join(here, '../public/trade/f', film);
    const rerun = `re-run node scripts/build-film-frames.mjs ${film}`;
    for (let i = 0; i < 5; i++) expect(existsSync(path.join(dir, 's', `${i}.webp`)), rerun).toBe(true);
    const sha = createHash('sha1').update(readFileSync(path.join(dir, 'film.mp4'))).digest('hex');
    expect(readFileSync(path.join(dir, 's', 'film.sha1'), 'utf8').trim(), rerun).toBe(sha);
  });
});
