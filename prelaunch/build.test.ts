// @vitest-environment node
// build.ts imports Vite, which needs Node's TextEncoder rather than jsdom's.
import { expect, it } from 'vitest';
import { keepsOwnPage } from './build';

it('keeps the live trade site and furniture catalog out of the prelaunch page', () => {
  expect(keepsOwnPage('/repo/trade/index.html')).toBe(true);
  expect(keepsOwnPage('C:\\repo\\trade\\index.html')).toBe(true);
  expect(keepsOwnPage('/repo/furniture/index.html')).toBe(true);
  expect(keepsOwnPage('/repo/index.html')).toBe(false);
  expect(keepsOwnPage('/repo/tradeshow/index.html')).toBe(false);
});
