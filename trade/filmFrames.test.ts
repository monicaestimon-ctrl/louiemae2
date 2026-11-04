// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { phoneCutSignature } from './phoneCut.mjs';

// Phones play a shorter 3:4 cut of each hero film (scripts/build-film-frames.mjs,
// trade/phoneCut.mjs) with a generated clay-to-colour shot in the middle
// (assets/phone-transitions), retimed by its measured pace (pace.json). If a film, its
// transition, its pace, its timeline or the cut changes
// without re-cutting it, phones show the old room or headlines out of step. The script
// records what it cut from, so any of those changes fails here.
const here = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.join(here, 'app.ts'), 'utf8');
const pace = JSON.parse(readFileSync(path.join(here, '../assets/phone-transitions/pace.json'), 'utf8'));
const films = Object.fromEntries(
  [...app.matchAll(/'?([a-z-]+)'?:\{space:'[a-z]+'([^\n]*?)TL:(\{"total".*?\}\}),\r?\n/g)].map((m) => {
    const clayAt = m[2].match(/phoneClayAt:([\d.]+)/);
    return [m[1], { TL: JSON.parse(m[3]), opts: { clayAt: clayAt ? +clayAt[1] : undefined, darkRoom: /darkRoom:true/.test(m[2]) } }];
  }),
);

describe('phone films', () => {
  it('finds the films in app.ts', () => {
    expect(Object.keys(films).length).toBeGreaterThan(0);
  });
  it.each(Object.keys(films))('%s has a phone cut of its current film', (film) => {
    const dir = path.join(here, '../public/trade/f', film);
    const morph = path.join(here, '../assets/phone-transitions', `${film}.mp4`);
    const rerun = `re-run node scripts/build-film-frames.mjs ${film}`;
    for (const f of [path.join(dir, 'phone.mp4'), path.join(dir, 'phone.webp'), morph]) expect(existsSync(f), rerun).toBe(true);
    const { TL, opts } = films[film];
    const sha = createHash('sha1').update(readFileSync(path.join(dir, 'film.mp4'))).update(readFileSync(morph)).update(JSON.stringify(pace[film])).update(phoneCutSignature(TL, opts)).digest('hex');
    expect(readFileSync(path.join(dir, 'phone.sha1'), 'utf8').trim(), rerun).toBe(sha);
  });
});
