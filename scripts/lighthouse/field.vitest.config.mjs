import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/lighthouse/field.browser.mjs'],
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
