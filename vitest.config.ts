import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest config — component / hook integration tests.
//
// Scope: tests/components/**/*.test.tsx ONLY. The hand-rolled
// pure-logic suites (tests/*.test.ts, run by `npm test` via tsx)
// stay separate — they need no DOM and run faster without one.
// Vitest owns the tests that genuinely need a renderer: React
// hooks with effect timing, components with user interaction.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/components/**/*.test.tsx'],
    setupFiles: ['tests/components/setup.ts'],
  },
});
