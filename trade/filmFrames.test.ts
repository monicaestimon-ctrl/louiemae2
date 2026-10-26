// @vitest-environment node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phones scrub stills cut from each hero film (scripts/build-film-frames.mjs). If a film
// is replaced without re-cutting them, phones show the old room and request stills that
// don't exist. The film's timeline in app.ts sets how many stills the hero asks for.
const here = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.join(here, 'app.ts'), 'utf8');
const films = [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'[^\n]*?TL:\{"total":([\d.]+)/g)].map((m) => ({ key: m[1], total: +m[2] }));
const expected = (total: number) => Math.floor((Math.round(total * 24) - 1) / 6) + 1;

describe('hero film stills', () => {
  it('finds the films in app.ts', () => {
    expect(films.length).toBeGreaterThan(0);
  });
  it.each(films)('$key has one still per quarter second of its film', ({ key, total }) => {
    const dir = path.join(here, '../public/trade/f', key, 'm');
    expect(existsSync(dir), `${dir} is missing: run node scripts/build-film-frames.mjs ${key}`).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.webp')).length, `re-run node scripts/build-film-frames.mjs ${key}`).toBe(expected(total));
  });
});
