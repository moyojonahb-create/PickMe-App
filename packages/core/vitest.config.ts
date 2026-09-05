import { defineConfig } from 'vitest/config';

/**
 * Isolated from the web app's vitest.config.ts on purpose. That config is
 * jsdom + React and scoped to the root `src/**`, so it never picks these up,
 * and this one never drags a DOM into a package whose whole point is not
 * needing one.
 *
 * Run from the repo root (which has the vitest binary installed):
 *   npx vitest run --config packages/core/vitest.config.ts
 */
export default defineConfig({
  test: {
    // Node, not jsdom. If a test only passes under jsdom, the code under test
    // has picked up a browser dependency and would fail on device.
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    root: __dirname,
  },
});
